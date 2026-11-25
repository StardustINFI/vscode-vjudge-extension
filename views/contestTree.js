'use strict';

const vscode = require('vscode');

const STATUS_LABELS = { upcoming: '未开始', running: '进行中', ended: '已结束', unknown: '未知状态' };

class ContestTree {
  constructor(getClient) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.items = [];
    this.loaded = false;
    this.loading = false;
    this.page = 1;
    this.totalPages = 1;
    this.status = '';
  }

  async load() {
    if (this.controller) this.controller.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.error = undefined;
    this.emitter.fire();
    try {
      const result = await this.getClient().getContests({ page: this.page, status: this.status }, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = result.contests;
      this.totalPages = result.totalPages || Math.max(1, Math.ceil(result.total / (result.pageSize || 50)));
      this.loaded = true;
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
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

  async filter() {
    const selected = await vscode.window.showQuickPick([
      { label: '全部比赛', value: '' }, { label: '未开始', value: 'upcoming' },
      { label: '进行中', value: 'running' }, { label: '已结束', value: 'ended' }
    ], { placeHolder: '筛选比赛状态' });
    if (!selected) return;
    this.status = selected.value;
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
    const contest = node.contest;
    const status = contest.status || 'unknown';
    const icons = { upcoming: 'calendar', running: 'play', ended: 'check' };
    const colors = { upcoming: 'charts.yellow', running: 'testing.iconPassed', ended: 'descriptionForeground' };
    const item = new vscode.TreeItem(contest.title, vscode.TreeItemCollapsibleState.None);
    item.description = STATUS_LABELS[status];
    item.tooltip = `${contest.title}\n开始: ${contest.startTime || '-'}\n结束: ${contest.endTime || '-'}`;
    item.contextValue = 'contest';
    item.iconPath = new vscode.ThemeIcon(icons[status] || 'calendar', new vscode.ThemeColor(colors[status] || 'icon.foreground'));
    item.command = { command: 'vjudge.openContestDetail', title: '打开比赛详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载比赛…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.items.length) return [{ type: 'status', label: '没有匹配的比赛', icon: 'info' }];
    return this.items.map((contest) => ({ type: 'contest', contest }));
  }
}

module.exports = { ContestTree, STATUS_LABELS };
