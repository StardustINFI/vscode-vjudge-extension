'use strict';

const vscode = require('vscode');

class ProblemTree {
  constructor(getClient) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.items = [];
    this.page = 1;
    this.totalPages = 1;
    this.filters = { search: '', oj: '', tag: '', difficulty: '', solved: '' };
    this.loading = false;
    this.loaded = false;
  }

  async load() {
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.error = undefined;
    this.emitter.fire();
    try {
      const result = await this.getClient().getProblems({ page: this.page, ...this.filters }, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = result.problems;
      this.totalPages = result.totalPages || Math.max(1, Math.ceil(result.total / (result.pageSize || 50)));
      this.loaded = true;
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
        this.items = [];
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

  async search() {
    const value = await vscode.window.showInputBox({ title: '搜索 VJudge 题目', prompt: '输入题号或标题',
      value: this.filters.search });
    if (value === undefined) return;
    this.filters.search = value.trim();
    this.page = 1;
    await this.load();
  }

  async filter() {
    const pick = async (items, placeHolder, current) => {
      const selected = await vscode.window.showQuickPick(items, { placeHolder });
      if (!selected) return undefined;
      return selected.value === current ? current : selected.value;
    };
    const oj = await pick(['', 'HDU', 'POJ', 'Codeforces', 'AtCoder', 'Luogu', 'VJudge']
      .map((value) => ({ label: value || '全部 OJ', value })), '选择 OJ', this.filters.oj);
    if (oj === undefined) return;
    const tags = ['', '基础', '排序', '图论', '动态规划', '数学', '字符串', '数据结构', '搜索']
      .map((value) => ({ label: value || '全部标签', value }));
    const tag = await pick(tags, '选择标签', this.filters.tag);
    if (tag === undefined) return;
    const difficulty = await pick(['', '1', '2', '3', '4', '5']
      .map((value) => ({ label: value ? `难度 ${value}` : '全部难度', value })), '选择难度', this.filters.difficulty);
    if (difficulty === undefined) return;
    const solved = await pick([{ label: '全部状态', value: '' }, { label: '已解决', value: 'true' },
      { label: '未解决', value: 'false' }], '选择解决状态', this.filters.solved);
    if (solved === undefined) return;
    Object.assign(this.filters, { oj, tag, difficulty, solved });
    this.page = 1;
    await this.load();
  }

  async previousPage() {
    if (this.page > 1) { this.page -= 1; await this.load(); }
  }

  async nextPage() {
    if (this.page < this.totalPages) { this.page += 1; await this.load(); }
  }

  getTreeItem(node) {
    if (node.type === 'status') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    const problem = node.problem;
    const item = new vscode.TreeItem(`${problem.id} ${problem.title}`, vscode.TreeItemCollapsibleState.None);
    item.description = [problem.oj, problem.difficulty && `难度 ${problem.difficulty}`].filter(Boolean).join(' · ');
    item.tooltip = `${problem.title}\n${(problem.tags || []).join(', ')}`;
    item.contextValue = 'problem';
    item.iconPath = problem.solved
      ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('circle-outline');
    item.command = { command: 'vjudge.openProblemDetail', title: '打开题目详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载题目…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.items.length) return [{ type: 'status', label: '没有匹配的题目', icon: 'info' }];
    return this.items.map((problem) => ({ type: 'problem', problem }));
  }
}

module.exports = { ProblemTree };
