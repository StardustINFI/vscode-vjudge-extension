'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

class FavoriteTree {
  constructor(getClient) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.requiresAuth = true;
    this.loggedOut = false;
    this.items = [];
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
        this.items = [];
        this.loggedOut = true;
        this.loaded = true;
        return;
      }
      this.loggedOut = false;
      const items = await client.getFavorites({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = items;
      this.loaded = true;
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
        this.items = [];
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
    const problem = node.problem;
    const item = new vscode.TreeItem(`${problem.id} ${problem.title}`, vscode.TreeItemCollapsibleState.None);
    item.description = problem.oj || '';
    item.tooltip = problem.title;
    item.contextValue = 'favorite';
    item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
    item.command = { command: 'vjudge.openProblemDetail', title: '打开题目详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loggedOut) return [loginNode()];
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载收藏…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.items.length) return [{ type: 'status', label: '暂无收藏题目', icon: 'star-empty' }];
    return this.items.map((problem) => ({ type: 'problem', problem }));
  }
}

module.exports = { FavoriteTree };
