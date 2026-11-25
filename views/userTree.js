'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

class UserTree {
  constructor(getClient) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.requiresAuth = true;
    this.loggedOut = false;
    this.loaded = false;
    this.loading = false;
  }

  async load() {
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.error = undefined;
    this.emitter.fire();
    try {
      const client = this.getClient();
      if (await loginRequired(client, this.requiresAuth)) {
        if (this.controller !== controller) return;
        this.user = undefined;
        this.loggedOut = true;
        this.loaded = true;
        return;
      }
      this.loggedOut = false;
      const session = await client.checkSession({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.user = session.loggedIn
        ? await client.getUserInfo(session.username, { signal: controller.signal })
        : undefined;
      if (this.controller !== controller) return;
      this.loaded = true;
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
        this.loggedOut = false;
        this.loaded = true;
      }
    } finally {
      if (this.controller === controller) {
        this.loading = false;
        this.controller = undefined;
        this.emitter.fire();
      }
    }
  }

  refresh() { return this.load(); }
  cancel() { if (this.controller) this.controller.abort(); }
  dispose() { this.cancel(); this.emitter.dispose(); }

  getTreeItem(node) {
    if (node.type === 'status') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.command) item.command = node.command;
      return item;
    }
    const user = node.user;
    const item = new vscode.TreeItem(user.nickname || user.username, vscode.TreeItemCollapsibleState.None);
    item.description = `解题数: ${user.solvedCount ?? user.solved ?? 0}`;
    item.tooltip = `${user.username}\n提交数: ${user.submissionCount ?? '-'}\n排名: ${user.rank ?? '-'}`;
    item.contextValue = 'user';
    item.iconPath = new vscode.ThemeIcon('account', new vscode.ThemeColor('charts.blue'));
    item.command = { command: 'vjudge.openUserInfo', title: '查看用户信息', arguments: [user.username] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loggedOut) return [loginNode()];
    if (this.loading) return [{ type: 'status', label: '正在加载用户信息…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.user) return [{ type: 'status', label: '未登录，点击登录', icon: 'account',
      command: { command: 'vjudge.login', title: '登录' } }];
    return [{ type: 'user', user: this.user }];
  }
}

module.exports = { UserTree };
