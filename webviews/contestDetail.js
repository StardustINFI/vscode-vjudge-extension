'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { PATHS, contestUrl } = require('../lib/endpoints');

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

class ContestDetailWebview {
  constructor(context, dependencies) {
    this.context = context;
    this.getClient = dependencies.getClient;
    this.store = dependencies.store;
    this.eventBus = dependencies.eventBus;
    this.ready = false;
    this.queue = [];
    this.currentContestId = undefined;
    this.activeTab = 'detail';
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
      .replace(/\{\{VIEW\}\}/g, 'contest');
  }

  open(contestId, tab = 'detail') {
    const id = String(contestId);
    const changed = this.currentContestId !== id;
    this.currentContestId = id;
    this.activeTab = tab;
    if (changed) {
      this.contest = undefined;
      this.problems = undefined;
      this.rank = undefined;
      this.user = undefined;
    }
    if (this.panel) {
      this.panel.reveal();
      if (changed || tab === 'rank') this.load();
      else this.send(this.state());
      return;
    }
    this.panel = vscode.window.createWebviewPanel('vjudgeContestDetail', 'VJudge 比赛详情', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.resourceRoot()]
    });
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => this.handleDispose());
    this.load();
  }

  openRank(contestId) {
    return this.open(contestId, 'rank');
  }

  send(message) {
    if (this.panel && this.ready) {
      this.panel.webview.postMessage(message);
      return;
    }
    this.queue.push(message);
  }

  flushQueue() {
    this.queue.splice(0, this.queue.length).forEach((message) => {
      if (this.panel) this.panel.webview.postMessage(message);
    });
  }

  state(overrides = {}) {
    return {
      type: 'state',
      view: 'contest',
      contestId: this.currentContestId,
      contest: this.contest,
      problems: this.problems,
      rank: this.rank,
      activeTab: this.activeTab,
      user: this.user,
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
      const contest = await this.getClient().getContestDetail(this.currentContestId, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.contest = contest;
      this.problems = await this.getClient().getContestProblems(this.currentContestId, { signal: controller.signal });
      if (this.controller !== controller) return;
      const session = await this.getClient().checkSession({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.user = session.loggedIn ? await this.getClient().getUserInfo(session.username, { signal: controller.signal }) : undefined;
      if (this.controller !== controller) return;
      this.panel.title = `${contest.title || this.currentContestId} · VJudge`;
      this.send(this.state());
      if (this.activeTab === 'rank' && !this.rank) await this.loadRank(controller);
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

  async loadRank(controller = this.controller) {
    try {
      const rank = await this.getClient().getContestRank(this.currentContestId, controller ? { signal: controller.signal } : {});
      if (!controller || this.controller === controller) {
        this.rank = rank;
        this.send(this.state({ activeTab: 'rank' }));
      }
    } catch (error) {
      if (error.name !== 'AbortError' && (!controller || this.controller === controller)) {
        this.error = error.message;
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
        this.rank = undefined;
        await this.load();
        return;
      case 'tab':
        this.activeTab = message.data === 'rank' ? 'rank' : 'detail';
        if (this.activeTab === 'rank' && !this.rank) await this.loadRank();
        else this.send(this.state());
        return;
      case 'register':
        return this.registerContest();
      case 'openBrowser':
        return this.openBrowser();
      case 'openProblem':
        return vscode.commands.executeCommand('vjudge.openProblemDetail', message.data);
      default:
        this.send({ type: 'error', message: `未知消息类型: ${message.type}` });
    }
  }

  async registerContest() {
    try {
      const result = await this.getClient().registerContest(this.currentContestId);
      this.contest = { ...this.contest, registered: result.registered !== false };
      this.eventBus.fire({ type: 'contestChanged', data: { id: this.currentContestId, registered: true } });
      this.send({ type: 'registered', registered: this.contest.registered });
    } catch (error) {
      this.send({ type: 'error', message: error.message });
    }
  }

  openBrowser() {
    const url = this.contest && this.contest.url
      ? this.contest.url
      : contestUrl(PATHS.contestDetail, this.currentContestId);
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }

  handleBusEvent(event) {
    if (!this.panel) return;
    if (event.type === 'refreshAll') this.load();
    if (event.type === 'contestChanged' && event.data && String(event.data.id) === String(this.currentContestId)) {
      this.contest = { ...this.contest, registered: Boolean(event.data.registered) };
      this.send({ type: 'registered', registered: this.contest.registered });
    }
  }

  handleDispose() {
    if (this.controller) this.controller.abort();
    this.panel = undefined;
    this.ready = false;
    this.queue = [];
  }

  dispose() {
    if (this.panel) this.panel.dispose();
    if (this.controller) this.controller.abort();
    this.subscription.dispose();
  }
}

module.exports = { ContestDetailWebview };
