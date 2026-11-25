'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

// 我的团队：数据来自 GET /group 页面内联 dataJson 的 myGroups，
// myRole=2 表示由当前用户创建（负责人），myRole=1 表示加入并担任管理员。
class GroupTree {
  constructor(getClient, eventBus) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.requiresAuth = true;
    this.loggedOut = false;
    this.items = [];
    this.loaded = false;
    this.loading = false;
    this.subscription = eventBus ? eventBus.event((event) => {
      if (event.type === 'refreshAll') this.refresh();
    }) : undefined;
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
      const groups = await client.getMyGroups({ signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = Array.isArray(groups) ? groups : [];
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

  async detailNodes(group) {
    const nodes = [
      { type: 'status', label: `角色: ${group.roleLabel}`, icon: 'account' },
      { type: 'status', label: `成员: ${group.members} 人`, icon: 'people' },
      { type: 'status', label: `负责人: ${group.leaderName || '-'}`, icon: 'person' },
      { type: 'status', label: `公开性: ${group.isPublic ? '公开团队' : '私有团队'}`, icon: group.isPublic ? 'globe' : 'lock' },
      { type: 'status', label: `比赛: 未开始 ${group.scheduledContests} / 进行中 ${group.runningContests} / 已结束 ${group.endedContests}`, icon: 'calendar' },
      { type: 'status', label: group.brief || '暂无简介', icon: 'info' }
    ];
    // 展开时再取团队详情，补充成员名单与团队比赛数量；私有团队或网络失败时静默降级
    try {
      const detail = await this.getClient().getGroupDetail(group.shortName);
      const members = (detail.memberBriefs || []).slice(0, 12)
        .map((member) => member.nickName || member.username).filter(Boolean);
      if (members.length) nodes.push({ type: 'status', label: `成员名单: ${members.join('、')}`, icon: 'people' });
      if (detail.contests && detail.contests.length) {
        nodes.push({ type: 'status', label: `团队比赛: ${detail.contests.length} 场`, icon: 'trophy' });
      }
    } catch { /* 卡片信息已足够，详情不可用时不额外报错 */ }
    return nodes;
  }

  getTreeItem(node) {
    if (node.type === 'status') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.command) item.command = node.command;
      return item;
    }
    const group = node.group;
    const owner = group.myRole === 2;
    const item = new vscode.TreeItem(`${owner ? '★ ' : ''}${group.name}`,
      vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${group.roleLabel} · ${group.members} 人`;
    item.tooltip = `${group.name} (${group.shortName})\n${group.roleLabel} · ${group.members} 人\n${group.brief || ''}`;
    item.contextValue = 'group';
    item.iconPath = new vscode.ThemeIcon(owner ? 'star-full' : 'organization',
      new vscode.ThemeColor(owner ? 'charts.yellow' : 'charts.blue'));
    item.command = { command: 'vjudge.selectContestGroup', title: '只看该团队的比赛', arguments: [node] };
    return item;
  }

  async getChildren(element) {
    if (element && element.type === 'group') return this.detailNodes(element.group);
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loggedOut) return [loginNode()];
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载我的团队…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.items.length) {
      return [{ type: 'status', label: '暂无已加入或创建的团队', icon: 'info',
        command: { command: 'vjudge.searchGroups', title: '搜索 VJudge 团队' } }];
    }
    return this.items.map((group) => ({ type: 'group', group }));
  }
}

module.exports = { GroupTree };
