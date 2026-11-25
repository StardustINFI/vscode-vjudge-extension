'use strict';

const path = require('node:path');
const vscode = require('vscode');
const { groupUrl } = require('./endpoints');

class CommandManager {
  constructor(options) {
    Object.assign(this, options);
    this.fileProblems = new Map();
    this.draftTimers = new Map();
    this.webviews = {};
  }

  register() {
    const commands = {
      'vjudge.login': () => this.login(),
      'vjudge.loginWithCookie': () => this.loginWithCookie(),
      'vjudge.logout': () => this.logout(),
      'vjudge.toggleMockMode': () => this.toggleMockMode(),
      'vjudge.openProblemDetail': (value) => this.openProblemDetail(value),
      'vjudge.openContests': () => this.focus('vjudge.contests'),
      'vjudge.openContestDetail': (value) => this.openContestDetail(value),
      'vjudge.openContestRank': (value) => this.openContestRank(value),
      'vjudge.openFavorites': () => this.focus('vjudge.favorites'),
      'vjudge.openUserInfo': (value) => this.openUserInfo(value),
      'vjudge.openGroups': () => this.focus('vjudge.groups'),
      'vjudge.openContestProblems': () => this.focus('vjudge.contestProblems'),
      'vjudge.submitCurrentFile': () => this.submitCurrentFile(),
      'vjudge.submitSelection': () => this.submitSelection(),
      'vjudge.openCodeTemplate': (value) => this.newCodeFile(value),
      'vjudge.refreshAll': () => this.refreshAll(),
      'vjudge.addFavorite': (value) => this.addFavorite(value),
      'vjudge.removeFavorite': (value) => this.removeFavorite(value),
      'vjudge.newCodeFile': (value) => this.newCodeFile(value),
      'vjudge.viewSubmission': (value) => this.viewSubmission(value),
      'vjudge.rejudge': (value) => this.rejudge(value),
      'vjudge.registerContest': (value) => this.registerContest(value),
      'vjudge.filterContests': () => this.views.contest.filter(),
      'vjudge.previousContests': () => this.views.contest.previousPage(),
      'vjudge.nextContests': () => this.views.contest.nextPage(),
      'vjudge.selectContest': (value) => this.selectContest(value),
      'vjudge.selectContestGroup': (value) => this.selectContestGroup(value),
      'vjudge.toggleMyGroupContests': () => this.toggleMyGroupContests(),
      'vjudge.refreshGroups': () => this.views.group.refresh(),
      'vjudge.openGroupInBrowser': (value) => this.openGroupInBrowser(value),
      'vjudge.searchGroups': () => this.searchGroups(),
      'vjudge.searchContestProblems': () => this.views.contestProblems.search(),
      'vjudge.refreshContestProblems': () => this.views.contestProblems.refresh()
    };
    Object.entries(commands).forEach(([id, handler]) => {
      this.context.subscriptions.push(vscode.commands.registerCommand(id, async (...args) => {
        try { return await handler(...args); }
        catch (error) { this.log(`${id}: ${error.stack || error.message}`); throw error; }
      }));
    });
    this.context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => this.saveDraftLater(event.document)));
  }

  log(message) {
    if (this.outputChannel) this.outputChannel.appendLine(`[Command] ${message}`);
  }

  focus(viewId) { return vscode.commands.executeCommand(`${viewId}.focus`); }

  updateStatus() {
    const mock = this.store.isMockMode();
    const client = this.getClient();
    const logged = client && typeof client.isLoggedIn === 'function' ? client.isLoggedIn() : false;
    const username = logged && client.session ? client.session.username : '';
    this.statusBar.text = mock ? '$(beaker) VJudge Mock'
      : logged ? `$(globe) VJudge${username ? `: ${username}` : ' 已登录'}`
        : '$(globe) VJudge 未登录';
    this.statusBar.tooltip = mock
      ? 'Mock 模式：所有数据离线，禁止真实网络请求'
      : logged ? 'VJudge 真实模式 · 已登录' : 'VJudge 真实模式 · 未登录（点击可切换模式）';
    this.statusBar.show();
  }

  async refreshAll() {
    this.views.list.forEach((view) => view.cancel());
    const results = await Promise.allSettled(this.views.list.map((view) => view.refresh()));
    results.filter((result) => result.status === 'rejected').forEach((result) => this.log(result.reason));
    this.updateStatus();
  }

  async login() {
    if (this.store.isMockMode()) return this.loginWithPassword();
    const method = await vscode.window.showQuickPick([
      { label: 'Cookie 登录（推荐）', description: '从已登录的浏览器复制 Cookie，可绕过人机验证', value: 'cookie' },
      { label: '账号密码登录', description: 'VJudge 可能要求 Turnstile 人机验证', value: 'password' }
    ], { placeHolder: '选择 VJudge 登录方式' });
    if (!method) return;
    return method.value === 'cookie' ? this.loginWithCookie() : this.loginWithPassword();
  }

  async loginWithPassword() {
    const credentials = await this.store.getCredentials();
    const username = await vscode.window.showInputBox({ title: 'VJudge 登录', prompt: '用户名',
      value: credentials.username || '' });
    if (!username) return;
    const password = await vscode.window.showInputBox({ title: 'VJudge 登录', prompt: '密码', password: true });
    if (!password) return;
    try {
      const result = await this.getClient().login(username, password);
      vscode.window.showInformationMessage(`已登录 VJudge: ${result.username}`);
      await this.refreshAll();
    } catch (error) {
      vscode.window.showErrorMessage(`VJudge 登录失败: ${error.message}`);
    }
  }

  async loginWithCookie() {
    const raw = await vscode.window.showInputBox({
      title: 'VJudge Cookie 登录',
      prompt: '在浏览器登录 vjudge.net 后，从开发者工具复制 Cookie 请求头',
      placeHolder: 'JSESSIONID=xxx; JSESSlONID=yyy',
      ignoreFocusOut: true
    });
    if (!raw) return;
    const username = await vscode.window.showInputBox({
      title: 'VJudge Cookie 登录', prompt: '你的 VJudge 用户名（可选，用于侧边栏显示）'
    });
    try {
      const result = await this.getClient().loginWithCookie(raw, username || '');
      vscode.window.showInformationMessage(
        `已通过 Cookie 登录 VJudge${result.username ? `: ${result.username}` : ''}`);
      await this.refreshAll();
    } catch (error) {
      vscode.window.showErrorMessage(`VJudge 登录失败: ${error.message}`);
    }
  }

  async logout() {
    await this.getClient().logout();
    vscode.window.showInformationMessage('已退出 VJudge');
    // 退出后清空依赖账号的数据，避免残留上一用户的团队/比赛题目
    this.views.contestProblems.clearContest();
    await this.views.contest.setScope('all', '', '');
    await this.refreshAll();
  }

  async toggleMockMode() {
    if (process.env.VJUDGE_MOCK !== undefined) {
      vscode.window.showWarningMessage(
        `Mock 模式由环境变量 VJUDGE_MOCK=${process.env.VJUDGE_MOCK} 锁定。F5 调试时请改用不带 env 的 "Run VJudge Extension (Real)" 配置`);
      return;
    }
    const enabled = !this.store.isMockMode();
    await this.store.setMockMode(enabled);
    vscode.window.showInformationMessage(enabled ? 'VJudge 已切换为 Mock 离线模式' : 'VJudge 已切换为真实模式');
  }

  async availableContests() {
    if (this.views.contest.items.length) return this.views.contest.items;
    try {
      return (await this.getClient().getContests({ page: 1 })).contests || [];
    } catch {
      return [];
    }
  }

  async availableGroups() {
    if (this.views.group.items.length) return this.views.group.items;
    try {
      return await this.getClient().getMyGroups();
    } catch {
      return [];
    }
  }

  async problemFrom(value) {
    const problem = value && value.problem ? value.problem : value;
    if (problem && typeof problem === 'object' && problem.id) return problem;
    if (typeof problem === 'string' && problem) return { id: problem };
    // 回退列表改为「当前比赛的题目」，不再从全站题目列表里挑选
    if (this.views.contestProblems.items.length) {
      const selected = await vscode.window.showQuickPick(this.views.contestProblems.items.map((item) => ({
        label: `${item.label ? `[${item.label}] ` : ''}${item.id} ${item.title}`,
        description: item.oj, problem: item
      })), { placeHolder: '选择当前比赛的题目' });
      if (selected) return selected.problem;
    }
    const id = await vscode.window.showInputBox({ prompt: '输入 VJudge 题目 ID 或详情 URL' });
    return id ? { id: id.trim() } : undefined;
  }

  async contestFrom(value) {
    const contest = value && value.contest ? value.contest : value;
    if (contest && typeof contest === 'object' && (contest.id || contest.contestId)) return contest;
    if (contest && typeof contest === 'string') return { id: contest };
    const items = await this.availableContests();
    if (items.length) {
      const selected = await vscode.window.showQuickPick(items.map((item) => ({
        label: item.title, description: item.status, contest: item
      })), { placeHolder: '选择比赛' });
      if (selected) return selected.contest;
      return undefined;
    }
    const id = await vscode.window.showInputBox({ prompt: '输入 VJudge 比赛 ID' });
    return id ? { id: id.trim() } : undefined;
  }

  webview(moduleName, className) {
    if (!this.webviews[moduleName]) {
      const WebviewClass = require(`../webviews/${moduleName}`)[className];
      this.webviews[moduleName] = new WebviewClass(this.context, {
        getClient: this.getClient, store: this.store, eventBus: this.eventBus
      });
    }
    return this.webviews[moduleName];
  }

  async openProblemDetail(value) {
    const problem = await this.problemFrom(value);
    if (problem) await this.webview('problemDetail', 'ProblemDetailWebview').open(problem.id);
  }

  async openContestDetail(value) {
    const contest = await this.contestFrom(value);
    if (!contest) return;
    // 打开比赛详情时同步把侧边栏「比赛题目」切到这场比赛
    await this.selectContest(contest);
    await this.webview('contestDetail', 'ContestDetailWebview').open(contest.id);
  }

  async openContestRank(value) {
    const contest = await this.contestFrom(value);
    if (contest) await this.webview('contestDetail', 'ContestDetailWebview').openRank(contest.id);
  }

  async openUserInfo(value) {
    let username = typeof value === 'string' ? value : value && value.username;
    if (!username) {
      const session = await this.getClient().checkSession();
      username = session.username;
    }
    await this.webview('userInfo', 'UserInfoWebview').open(username);
  }

  // 选择当前比赛：驱动「比赛题目」视图，并通知其他监听者
  async selectContest(value) {
    const contest = await this.contestFrom(value);
    if (!contest) return undefined;
    const id = String(contest.contestId || contest.id);
    const payload = { contestId: id, id, title: contest.title || contest.contestTitle || id };
    await this.views.contestProblems.setContest(payload);
    this.eventBus.fire({ type: 'contestSelected', data: payload });
    return payload;
  }

  // 只看某个团队的比赛：category=group + owner=团队显示名
  async selectContestGroup(value) {
    let group = value && value.group ? value.group : (typeof value === 'string' ? undefined : value);
    if (!group || !(group.shortName || group.name)) {
      const groups = await this.availableGroups();
      if (!groups.length) {
        vscode.window.showInformationMessage('未找到团队，请先登录并在「我的团队」视图确认');
        return;
      }
      const picked = await vscode.window.showQuickPick(groups.map((item) => ({
        label: item.name, description: `${item.roleLabel} · ${item.members} 人`, group: item
      })), { placeHolder: '选择要查看比赛的团队' });
      if (!picked) return;
      group = picked.group;
    }
    const shortName = String(group.shortName || group.name);
    const name = String(group.name || group.shortName);
    await this.views.contest.setScope('group', shortName, name);
    return { shortName, name };
  }

  async toggleMyGroupContests() {
    const next = await this.views.contest.toggleMyGroup();
    vscode.window.showInformationMessage(next === 'mygroup'
      ? '比赛列表：仅显示我加入/创建团队的比赛' : '比赛列表：显示全部比赛');
    return next;
  }

  async openGroupInBrowser(value) {
    let group = value && value.group ? value.group : (typeof value === 'string' ? undefined : value);
    if (!group || !(group.shortName || group.name)) {
      const groups = await this.availableGroups();
      if (!groups.length) {
        vscode.window.showInformationMessage('未找到团队，请先登录并在「我的团队」视图确认');
        return;
      }
      const picked = await vscode.window.showQuickPick(groups.map((item) => ({
        label: item.name, description: item.shortName, group: item
      })), { placeHolder: '选择团队' });
      if (!picked) return;
      group = picked.group;
    }
    const shortName = String(group.shortName || group.name);
    const url = group.url || groupUrl(shortName);
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async searchGroups() {
    const name = await vscode.window.showInputBox({
      title: '搜索 VJudge 团队', prompt: '输入团队名称（留空可浏览推荐团队）'
    });
    if (name === undefined) return;
    try {
      const result = await this.getClient().searchGroups(name);
      if (!result.groups.length) {
        vscode.window.showInformationMessage(result.info || '没有匹配的团队');
        return;
      }
      const picked = await vscode.window.showQuickPick(result.groups.map((item) => ({
        label: item.name, description: `${item.roleLabel || ''} · ${item.members} 人`, group: item
      })), { placeHolder: '选择团队（将打开网页版）' });
      if (picked) await this.openGroupInBrowser(picked.group);
    } catch (error) {
      vscode.window.showErrorMessage(`团队搜索失败: ${error.message}`);
    }
  }

  async addFavorite(value) {
    const problem = await this.problemFrom(value);
    if (!problem) return;
    await this.getClient().addFavorite(problem.id);
    await this.views.favorite.refresh();
    this.eventBus.fire({ type: 'favoriteChanged', data: { id: problem.id, favorite: true } });
  }

  async removeFavorite(value) {
    const problem = await this.problemFrom(value);
    if (!problem) return;
    await this.getClient().removeFavorite(problem.id);
    await this.views.favorite.refresh();
    this.eventBus.fire({ type: 'favoriteChanged', data: { id: problem.id, favorite: false } });
  }

  async newCodeFile(value) {
    const problem = await this.problemFrom(value);
    if (!problem) return;
    const templates = require('../templates');
    const selected = await vscode.window.showQuickPick(templates.LANGUAGES.map((language) => ({
      label: language.label, description: language.id, language
    })), { placeHolder: '选择代码语言' });
    if (!selected) return;
    const language = selected.language;
    const content = templates.getTemplate(language.id, problem);
    const document = await vscode.workspace.openTextDocument({ language: language.languageId, content });
    await vscode.window.showTextDocument(document, { preview: false });
    this.fileProblems.set(document.uri.toString(), problem.id);
    await this.store.saveDraft(problem.id, language.id, content);
    return document;
  }

  async resolveDocumentProblem(document) {
    const mapped = this.fileProblems.get(document.uri.toString());
    if (mapped) return mapped;
    const matched = path.basename(document.fileName).match(/P\d{4}/i);
    if (matched) return matched[0].toUpperCase();
    const id = await vscode.window.showInputBox({ prompt: '输入当前文件对应的题目 ID' });
    if (id) this.fileProblems.set(document.uri.toString(), id.trim());
    return id && id.trim();
  }

  saveDraftLater(document) {
    const problemId = this.fileProblems.get(document.uri.toString());
    if (!problemId) return;
    clearTimeout(this.draftTimers.get(document.uri.toString()));
    const timer = setTimeout(async () => {
      try {
        const templates = require('../templates');
        const language = templates.languageForDocument(document.languageId);
        await this.store.saveDraft(problemId, language.id, document.getText());
      } catch (error) { this.log(`草稿保存失败: ${error.message}`); }
    }, 400);
    this.draftTimers.set(document.uri.toString(), timer);
  }

  async submit(code, document) {
    if (!code.trim()) { vscode.window.showWarningMessage('提交代码不能为空'); return; }
    const problemId = await this.resolveDocumentProblem(document);
    if (!problemId) return;
    const templates = require('../templates');
    const language = templates.languageForDocument(document.languageId);
    const result = await this.getClient().submitCode({ problemId, language: language.id, code });
    await this.store.saveDraft(problemId, language.id, code);
    this.eventBus.fire({ type: 'submissionChanged', data: result });
    vscode.window.showInformationMessage(`代码已提交${result.submitId ? `，提交 ID: ${result.submitId}` : ''}`);
    return result;
  }

  async submitCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('请先打开要提交的代码文件'); return; }
    return this.submit(editor.document.getText(), editor.document);
  }

  async submitSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) { vscode.window.showWarningMessage('请先选择要提交的代码'); return; }
    return this.submit(editor.document.getText(editor.selection), editor.document);
  }

  async viewSubmission(value) {
    const submission = value && value.submission ? value.submission : value;
    if (!submission) return;
    const document = await vscode.workspace.openTextDocument({ language: 'json',
      content: JSON.stringify(submission, null, 2) });
    await vscode.window.showTextDocument(document, { preview: true });
  }

  async rejudge(value) {
    const submission = value && value.submission ? value.submission : value;
    const id = submission && (submission.id || submission.submitId);
    if (!id) return;
    await this.getClient().rejudge(id);
    this.eventBus.fire({ type: 'submissionChanged', data: { submitId: id, status: 'Pending' } });
    await this.views.submit.refresh();
  }

  async registerContest(value) {
    const contest = await this.contestFrom(value);
    if (!contest) return;
    await this.getClient().registerContest(contest.id);
    vscode.window.showInformationMessage(`已报名比赛: ${contest.title || contest.id}`);
    await this.views.contest.refresh();
    this.eventBus.fire({ type: 'contestChanged', data: { id: contest.id, registered: true } });
  }

  dispose() {
    this.draftTimers.forEach(clearTimeout);
    Object.values(this.webviews).forEach((webview) => { if (webview.dispose) webview.dispose(); });
  }
}

module.exports = { CommandManager };
