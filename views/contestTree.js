'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

const STATUS_LABELS = { upcoming: '未开始', running: '进行中', ended: '已结束', unknown: '未知状态' };
const SCOPE_LABELS = {
  all: '全部比赛', public: '公开比赛', mine: '我创建的比赛', participation: '我参与的比赛',
  arrangement: '我组织的比赛', mygroup: '仅我的团队比赛', favorites: '我收藏的比赛',
  follow: '我关注的比赛', classical: '经典比赛', practice: '练习赛', replay: '重现赛'
};
// 这些范围的数据与当前账号绑定，未登录时必须先登录
const PERSONAL_SCOPES = new Set([
  'mygroup', 'group', 'mine', 'participation', 'arrangement', 'favorites', 'follow'
]);

class ContestTree {
  constructor(getClient, groupsProvider, eventBus) {
    this.getClient = getClient;
    this.groupsProvider = groupsProvider;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.loggedOut = false;
    this.items = [];
    this.loaded = false;
    this.loading = false;
    this.page = 1;
    this.totalPages = 1;
    this.status = '';
    // 比赛范围：all=全部，mygroup=我加入/创建团队的比赛，group=指定团队
    this.category = 'all';
    this.group = '';
    this.groupName = '';
    this.subscription = eventBus ? eventBus.event((event) => {
      if (event.type === 'groupSelected' && event.data) {
        this.setScope('group', event.data.shortName || '', event.data.name || '').catch(() => undefined);
      }
      if (event.type === 'refreshAll') this.refresh();
    }) : undefined;
  }

  // 个人范围在未登录时必须门控，避免上游把 category=mygroup 退化成全量公开比赛
  get requiresAuth() {
    return PERSONAL_SCOPES.has(this.category);
  }

  scopeLabel() {
    if (this.category === 'group') return `团队: ${this.groupName || this.group}`;
    return SCOPE_LABELS[this.category] || this.category;
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
      const result = await client.getContests({
        page: this.page, status: this.status, category: this.category,
        group: this.group, groupName: this.groupName
      }, { signal: controller.signal });
      if (this.controller !== controller) return;
      if (result.needsLogin) {
        this.items = [];
        this.loggedOut = true;
        this.loaded = true;
        return;
      }
      this.items = result.contests;
      this.totalPages = result.totalPages || Math.max(1, Math.ceil(result.total / (result.pageSize || 20)));
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

  async groups() {
    if (this.groupsProvider && this.groupsProvider.items.length) return this.groupsProvider.items;
    try {
      return await this.getClient().getMyGroups();
    } catch {
      return [];
    }
  }

  async setScope(category, group = '', groupName = '') {
    this.category = category;
    this.group = group;
    this.groupName = groupName;
    this.page = 1;
    return this.load();
  }

  async toggleMyGroup() {
    const next = this.category === 'mygroup' ? 'all' : 'mygroup';
    await this.setScope(next, '', '');
    return next;
  }

  async filter() {
    const scopes = [
      { label: '全部比赛', value: 'all', description: 'VJudge 全站公开比赛' },
      { label: '仅我的团队比赛', value: 'mygroup', description: '只显示我加入/创建团队的比赛' },
      { label: '指定团队的比赛', value: 'group', description: '选择某个团队，只看它的比赛' },
      { label: '我创建的比赛', value: 'mine', description: 'category=mine' },
      { label: '我参与的比赛', value: 'participation', description: 'category=participation' },
      { label: '我收藏的比赛', value: 'favorites', description: 'category=favorites' }
    ];
    const scope = await vscode.window.showQuickPick(scopes, {
      placeHolder: `选择比赛范围（当前: ${this.scopeLabel()}）`
    });
    if (!scope) return;
    let group = '';
    let groupName = '';
    if (scope.value === 'group') {
      const groups = await this.groups();
      if (!groups.length) {
        vscode.window.showInformationMessage('没有可用的团队，请先登录并在「我的团队」视图确认');
        return;
      }
      const picked = await vscode.window.showQuickPick(groups.map((item) => ({
        label: item.name, description: `${item.roleLabel} · ${item.members} 人`, group: item
      })), { placeHolder: '选择团队' });
      if (!picked) return;
      group = picked.group.shortName;
      groupName = picked.group.name;
    }
    const status = await vscode.window.showQuickPick([
      { label: '全部状态', value: '' }, { label: '未开始', value: 'upcoming' },
      { label: '进行中', value: 'running' }, { label: '已结束', value: 'ended' }
    ], { placeHolder: '筛选比赛状态' });
    if (!status) return;
    this.status = status.value;
    await this.setScope(scope.value, group, groupName);
  }

  async previousPage() {
    if (this.page > 1) { this.page -= 1; await this.load(); }
  }

  async nextPage() {
    if (this.page < this.totalPages) { this.page += 1; await this.load(); }
  }

  getTreeItem(node) {
    if (node.type === 'status' || node.type === 'scope') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.command) item.command = node.command;
      return item;
    }
    const contest = node.contest;
    const status = contest.status || 'unknown';
    const icons = { upcoming: 'calendar', running: 'play', ended: 'check' };
    const colors = { upcoming: 'charts.yellow', running: 'testing.iconPassed', ended: 'descriptionForeground' };
    const item = new vscode.TreeItem(contest.title, vscode.TreeItemCollapsibleState.None);
    item.description = [STATUS_LABELS[status], contest.groupName].filter(Boolean).join(' · ');
    item.tooltip = `${contest.title}\n范围: ${this.scopeLabel()}\n开始: ${contest.startTime || '-'}\n结束: ${contest.endTime || '-'}`;
    item.contextValue = 'contest';
    item.iconPath = new vscode.ThemeIcon(icons[status] || 'calendar',
      new vscode.ThemeColor(colors[status] || 'icon.foreground'));
    item.command = { command: 'vjudge.openContestDetail', title: '打开比赛详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loggedOut) return [loginNode()];
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载比赛…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    const header = {
      type: 'scope',
      label: `范围: ${this.scopeLabel()}${this.status ? ` · ${STATUS_LABELS[this.status]}` : ''}`,
      icon: 'filter',
      command: { command: 'vjudge.filterContests', title: '筛选比赛范围' }
    };
    if (!this.items.length) {
      return [header, { type: 'status', label: '该范围内没有比赛', icon: 'info' }];
    }
    return [header, ...this.items.map((contest) => ({ type: 'contest', contest }))];
  }
}

module.exports = { ContestTree, STATUS_LABELS, SCOPE_LABELS };
