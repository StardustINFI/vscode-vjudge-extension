'use strict';

const vscode = require('vscode');
const { loginRequired, loginNode } = require('../lib/session');

class SubmitTree {
  constructor(getClient, eventBus) {
    this.getClient = getClient;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.requiresAuth = false; // 提交记录为公开数据，仅在允许匿名浏览时可展示
    this.loggedOut = false;
    this.items = [];
    this.loaded = false;
    this.loading = false;
    this.page = 1;
    this.subscription = eventBus.event((event) => {
      if (['submissionChanged', 'refreshAll'].includes(event.type)) this.refresh();
    });
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
        this.updatePolling(false);
        return;
      }
      this.loggedOut = false;
      const result = await client.getSubmitStatus({ page: this.page }, { signal: controller.signal });
      if (this.controller !== controller) return;
      this.items = result.submissions;
      this.loaded = true;
      this.updatePolling(this.items.some((item) => /pending|judging|queued/i.test(item.result)));
    } catch (error) {
      if (error.name !== 'AbortError' && this.controller === controller) {
        this.error = error.message;
        this.loggedOut = false;
        this.loaded = true;
        this.updatePolling(false);
      }
    } finally {
      if (this.controller === controller) {
        this.loading = false;
        this.controller = undefined;
        this.emitter.fire();
      }
    }
  }

  updatePolling(enabled) {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (enabled) {
      this.timer = setInterval(() => { if (!this.loading) this.refresh(); }, 5000);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  refresh() { return this.load(); }
  cancel() { if (this.controller) this.controller.abort(); this.updatePolling(false); }
  dispose() { this.cancel(); this.subscription.dispose(); this.emitter.dispose(); }

  icon(result) {
    if (/^AC$|accepted/i.test(result)) return ['pass-filled', 'testing.iconPassed'];
    if (/pending|judging|queued/i.test(result)) return ['watch', 'testing.iconQueued'];
    if (/WA|wrong|failed|TLE|MLE|CE|RE/i.test(result)) return ['error', 'testing.iconFailed'];
    return ['question', 'icon.foreground'];
  }

  getTreeItem(node) {
    if (node.type === 'status') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.command) item.command = node.command;
      return item;
    }
    const submission = node.submission;
    const [icon, color] = this.icon(submission.result || submission.status);
    const item = new vscode.TreeItem(`#${submission.id} ${submission.problemTitle || submission.problemId}`,
      vscode.TreeItemCollapsibleState.None);
    item.description = `${submission.result} · ${submission.language || ''}`;
    item.tooltip = `提交时间: ${submission.submitTime || '-'}\n耗时: ${submission.time || '-'}\n内存: ${submission.memory || '-'}`;
    item.contextValue = 'submission';
    item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    item.command = { command: 'vjudge.viewSubmission', title: '查看提交详情', arguments: [node] };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    if (!this.loaded && !this.loading) this.load();
    if (this.loggedOut) return [loginNode()];
    if (this.loading && !this.items.length) return [{ type: 'status', label: '正在加载提交记录…', icon: 'loading~spin' }];
    if (this.error) return [{ type: 'status', label: `加载失败: ${this.error}`, icon: 'error' }];
    if (!this.items.length) return [{ type: 'status', label: '暂无提交记录', icon: 'info' }];
    return this.items.map((submission) => ({ type: 'submission', submission }));
  }
}

module.exports = { SubmitTree };
