'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { problemDetailUrl } = require('../lib/endpoints');
const templates = require('../templates');

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

class ProblemDetailWebview {
  constructor(context, dependencies) {
    this.context = context;
    this.getClient = dependencies.getClient;
    this.store = dependencies.store;
    this.eventBus = dependencies.eventBus;
    this.ready = false;
    this.queue = [];
    this.currentProblemId = undefined;
    this.subscription = this.eventBus.event((event) => this.handleBusEvent(event));
  }

  resourceRoot() {
    return vscode.Uri.joinPath(this.context.extensionUri, 'resources');
  }

  buildHtml() {
    const root = this.resourceRoot();
    const cssUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.css'));
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.js'));
    const currentNonce = nonce();
    const template = fs.readFileSync(path.join(__dirname, '..', 'resources', 'webview.html'), 'utf8');
    const csp = `default-src 'none'; img-src ${this.panel.webview.cspSource} https: data:; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${currentNonce}';`;
    return template
      .replace(/\{\{CSP\}\}/g, csp)
      .replace(/\{\{CSS_URI\}\}/g, cssUri)
      .replace(/\{\{SCRIPT_URI\}\}/g, scriptUri)
      .replace(/\{\{NONCE\}\}/g, currentNonce)
      .replace(/\{\{VIEW\}\}/g, 'problem');
  }

  open(problemId) {
    this.currentProblemId = String(problemId);
    if (this.panel) {
      this.panel.reveal();
      this.load();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('vjudgeProblemDetail', 'VJudge 题目详情', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.resourceRoot()]
    });
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => this.handleDispose());
    this.load();
  }

  send(message) {
    if (this.panel && this.ready) {
      this.panel.webview.postMessage(message);
      return;
    }
    this.queue.push(message);
  }

  flushQueue() {
    const messages = this.queue.splice(0, this.queue.length);
    messages.forEach((message) => {
      if (this.panel) this.panel.webview.postMessage(message);
    });
  }

  state(overrides = {}) {
    return {
      type: 'state',
      view: 'problem',
      problemId: this.currentProblemId,
      problem: this.problem,
      favorite: this.favorite,
      latestSubmission: this.latestSubmission,
      user: this.user,
      draft: this.currentProblemId ? this.store.getDraft(this.currentProblemId) : undefined,
      languages: templates.LANGUAGES,
      mockMode: this.store.isMockMode(),
      loading: this.loading,
      error: this.error,
      ...overrides
    };
  }

  async load() {
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.error = undefined;
    this.send(this.state());
    try {
      const problem = await this.getClient().getProblemDetail(this.currentProblemId, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.problem = problem;
      const session = await this.getClient().checkSession({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.user = session.loggedIn ? await this.getClient().getUserInfo(session.username, { signal: controller.signal }) : undefined;
      if (this.controller !== controller) return;
      const favorites = await this.getClient().getFavorites({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.favorite = favorites.some((item) => String(item.id) === String(this.currentProblemId));
      // 只取当前登录用户在该题的提交；未登录时不展示任何人的提交，
      // 避免把全站他人的 AC 误当成"我的最新提交"。
      const submissions = session.loggedIn
        ? await this.getClient().getSubmitStatus({ problemId: this.currentProblemId, username: session.username }, { signal: controller.signal })
        : { submissions: [] };
      if (this.controller !== controller) return;
      this.latestSubmission = submissions.submissions[0];
      this.updatePolling(this.latestSubmission && /pending|judging|queued/i.test(this.latestSubmission.result));
      this.panel.title = `${problem.title || this.currentProblemId} · VJudge`;
      this.send(this.state());
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
        this.send(this.state());
      }
    } finally {
      if (this.controller === controller) {
        this.loading = false;
        this.controller = undefined;
        this.send(this.state());
      }
    }
  }

  async handleMessage(message) {
    if (!message || !message.type) return;
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.flushQueue();
        return;
      case 'refresh':
        await this.load();
        return;
      case 'submit':
        return this.submit(message.data || {});
      case 'favorite':
        return this.toggleFavorite(Boolean(message.data && message.data.favorite));
      case 'copy':
        return this.copyToClipboard(message.data);
      case 'openBrowser':
        return this.openBrowser();
      case 'saveDraft':
        return this.saveDraft(message.data || {});
      case 'openProblem':
        return vscode.commands.executeCommand('vjudge.openProblemDetail', message.data);
      default:
        this.send({ type: 'error', message: `未知消息类型: ${message.type}` });
    }
  }

  async submit(data) {
    if (!this.currentProblemId) return;
    const language = data.language;
    const code = data.code;
    if (!language || !code || !String(code).trim()) {
      this.send({ type: 'submitError', message: '请选择语言并输入代码' });
      return;
    }
    this.send({ type: 'submitting' });
    try {
      const submission = await this.getClient().submitCode({
        problemId: this.currentProblemId, language, code
      });
      this.latestSubmission = submission;
      await this.store.setLastSubmission(this.currentProblemId, submission);
      await this.store.saveDraft(this.currentProblemId, language, code);
      this.eventBus.fire({ type: 'submissionChanged', data: submission });
      this.send({ type: 'submission', submission });
      this.updatePolling(true);
    } catch (error) {
      this.send({ type: 'submitError', message: error.message });
    }
  }

  async toggleFavorite(favorite) {
    try {
      if (favorite) await this.getClient().addFavorite(this.currentProblemId);
      else await this.getClient().removeFavorite(this.currentProblemId);
      this.favorite = favorite;
      this.eventBus.fire({ type: 'favoriteChanged', data: { id: this.currentProblemId, favorite } });
      this.send({ type: 'favorite', favorite });
    } catch (error) {
      this.send({ type: 'error', message: error.message });
    }
  }

  async copyToClipboard(data) {
    const value = data && data.text !== undefined ? data.text : '';
    if (!value) return;
    await vscode.env.clipboard.writeText(String(value));
    this.send({ type: 'copied', sample: data.sample });
  }

  openBrowser() {
    const url = this.problem && this.problem.sourceUrl ? this.problem.sourceUrl
      : problemDetailUrl(this.currentProblemId);
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async saveDraft(data) {
    if (!this.currentProblemId) return;
    await this.store.saveDraft(this.currentProblemId, data.language, data.code);
    this.send({ type: 'draftSaved', problemId: this.currentProblemId });
  }

  updatePolling(enabled) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (enabled && this.panel) {
      this.timer = setInterval(() => this.pollLatest(), 3000);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  async pollLatest() {
    if (this.polling || !this.panel) return;
    this.polling = true;
    try {
      const username = this.user && (this.user.username || this.user.nickname);
      const result = await this.getClient().getSubmitStatus({ problemId: this.currentProblemId, username: username || '' });
      this.latestSubmission = result.submissions[0];
      const pending = this.latestSubmission && /pending|judging|queued/i.test(this.latestSubmission.result);
      this.send({ type: 'submission', submission: this.latestSubmission });
      if (!pending) this.updatePolling(false);
    } catch {
      this.updatePolling(false);
    } finally {
      this.polling = false;
    }
  }

  handleBusEvent(event) {
    if (!this.panel) return;
    if (event.type === 'refreshAll') this.load();
    if (event.type === 'favoriteChanged' && event.data && String(event.data.id) === String(this.currentProblemId)) {
      this.favorite = Boolean(event.data.favorite);
      this.send({ type: 'favorite', favorite: this.favorite });
    }
    if (event.type === 'submissionChanged' && this.currentProblemId) {
      const submission = event.data;
      if (!submission || !submission.problemId || String(submission.problemId) === String(this.currentProblemId)) {
        this.latestSubmission = submission || this.latestSubmission;
        this.send({ type: 'submission', submission: this.latestSubmission });
        this.updatePolling(true);
      }
    }
  }

  handleDispose() {
    this.updatePolling(false);
    if (this.controller) this.controller.abort();
    this.panel = undefined;
    this.ready = false;
    this.queue = [];
  }

  dispose() {
    if (this.panel) this.panel.dispose();
    this.updatePolling(false);
    if (this.controller) this.controller.abort();
    this.subscription.dispose();
  }
}

module.exports = { ProblemDetailWebview };
