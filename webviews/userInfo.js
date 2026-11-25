'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { PATHS, withQuery } = require('../lib/endpoints');

function nonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

class UserInfoWebview {
  constructor(context, dependencies) {
    this.context = context;
    this.getClient = dependencies.getClient;
    this.store = dependencies.store;
    this.eventBus = dependencies.eventBus;
    this.ready = false;
    this.queue = [];
    this.currentUsername = undefined;
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
      .replace(/\{\{VIEW\}\}/g, 'user');
  }

  open(username) {
    this.currentUsername = String(username || '');
    if (this.panel) {
      this.panel.reveal();
      this.load();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('vjudgeUserInfo', 'VJudge 用户信息', vscode.ViewColumn.One, {
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
    this.queue.splice(0, this.queue.length).forEach((message) => {
      if (this.panel) this.panel.webview.postMessage(message);
    });
  }

  state(overrides = {}) {
    return {
      type: 'state',
      view: 'user',
      username: this.currentUsername,
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
      const user = await this.getClient().getUserInfo(this.currentUsername, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.user = user;
      this.panel.title = `${user.nickname || user.username || this.currentUsername} · VJudge`;
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
      case 'openBrowser':
        return this.openBrowser();
      case 'openUser':
        return this.open(message.data);
      default:
        this.send({ type: 'error', message: `未知消息类型: ${message.type}` });
    }
  }

  openBrowser() {
    const url = withQuery(PATHS.userInfo, { username: this.currentUsername });
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }

  handleBusEvent(event) {
    if (this.panel && ['refreshAll', 'submissionChanged'].includes(event.type)) this.load();
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

module.exports = { UserInfoWebview };
