'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

// 比赛题目：不再展示全站题目列表，只展示当前选中比赛里的题目。
// 题目来自 GET /contest/{id} 内联 dataJson 的 problems 数组。
class ContestProblemTree {
  constructor(getClient, eventBus) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.requiresAuth = false;
    this.loggedOut = false;
    this.contest = undefined;
    this.items = [];
    this.keyword = '';
    this.loaded = false;
    this.loading = false;
    this.subscription = eventBus ? eventBus.event((event) => {
      if (event.type === 'contestSelected' && event.data) {
        const id = String(event.data.contestId || event.data.id || '');
        // 命令已直接调用 setContest 时，事件会重复到达，这里做去重
        if (this.contest && String(this.contest.id) === id && this.loaded) return;
        this.setContest(event.data).catch(() => undefined);
      }
      if (event.type === 'refreshAll') this.refresh();
    }) : undefined;
  }

  // 由命令或事件驱动切换当前比赛
  async setContest(contest) {
    const id = contest && (contest.contestId || contest.id);
    if (!id) return;
    this.contest = { id: String(id), title: String(contest.title || contest.contestTitle || id) };
    this.keyword = '';
    return this.load();
  }

  clearContest() {
    if (this.controller) this.controller.abort();
    this.contest = undefined;
    this.items = [];
    this.loaded = true;
    this.loading = false;
    this.emitter.fire();
  }

  async load() {
    if (this.controller) this.controller.abort();
    if (!this.contest) {
      this.items = [];
      this.loaded = true;
      this.loading = false;
      this.emitter.fire();
      return;
    }
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
      const problems = await client.getContestProblems(this.contest.id, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = Array.isArray(problems) ? problems : [];
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
  dispose() {
    this.cancel();
    if (this.subscription) this.subscription.dispose();
    this.emitter.dispose();
  }

  async search() {
    const value = await vscode.window.showInputBox({
      title: '筛选当前比赛题目', prompt: '输入题号、标题或 OJ', value: this.keyword
    });
    if (value === undefined) return;
    this.keyword = value.trim();
    this.emitter.fire();
  }

  visibleItems() {
    const keyword = this.keyword.toLowerCase();
    if (!keyword) return this.items;
    return this.items.filter((problem) => [problem.label, problem.id, problem.title, problem.oj]
      .filter(Boolean).join(' ').toLowerCase().includes(keyword));
  }

  getTreeItem(node) {
    if (node.type === 'status' || node.type === 'scope') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.command) item.command = node.command;
      return item;
    }
    const problem = node.problem;
    const item = new vscode.TreeItem(`${problem.label ? `[${problem.label}] ` : ''}${problem.id} ${problem.title}`,
      vscode.TreeItemCollapsibleState.None);
    item.description = [problem.oj, problem.difficulty && `难度 ${problem.difficulty}`].filter(Boolean).join(' · ');
    item.tooltip = `${problem.title}\n${problem.id}${problem.oj ? ` · ${problem.oj}` : ''}`;
    item.contextValue = 'problem';
    item.iconPath = problem.solved
      ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('circle-outline');
    item.command = { command: 'vjudge.openProblemDetail', title: '打开题目详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading && this.contest) this.load();
    if (this.loggedOut) return [loginNode()];
    if (!this.contest) {
      return [
        { type: 'status', label: '请先选择一场比赛', icon: 'info',
          command: { command: 'vjudge.selectContest', title: '选择比赛' } },
        { type: 'status', label: '在比赛列表中点击比赛，或使用上方按钮选择', icon: 'arrow-right' }
      ];
    }
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载比赛题目…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    const header = { type: 'scope', label: `当前比赛: ${this.contest.title}`, icon: 'calendar',
      command: { command: 'vjudge.selectContest', title: '切换比赛' } };
    const items = this.visibleItems();
    if (!items.length) {
      return [header, { type: 'status', label: this.keyword ? '没有匹配的题目' : '该比赛暂无题目', icon: 'info' }];
    }
    return [header, ...items.map((problem) => ({ type: 'problem', problem }))];
  }
}

module.exports = { ContestProblemTree };
