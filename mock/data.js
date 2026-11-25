'use strict';

const PROBLEM_TITLES = [
  'A+B Problem', 'A-B Problem', '最大子数组和', '两数之和', '合并区间', '二分查找',
  '快速排序', '归并排序', '拓扑排序', '最短路径', '最小生成树', '并查集',
  '最近公共祖先', '树的直径', '动态规划入门', '0/1 背包', '完全背包', '最长上升子序列',
  '最长公共子序列', '编辑距离', '矩阵快速幂', '高精度加法', '高精度乘法', '欧几里得算法',
  '扩展欧几里得', '中国剩余定理', '组合数学', '概率与期望', '字符串匹配', 'KMP 算法',
  '字典树', '后缀自动机', '滚动哈希', '栈与队列', '单调栈', '单调队列',
  '二叉搜索树', '线段树', '树状数组', '平衡树', '强连通分量', '二分图匹配',
  '最大流', '最小费用流', '计算几何', '凸包', '模拟退火', '搜索与剪枝'
];
const OJS = ['HDU', 'POJ', 'Codeforces', 'AtCoder', 'Luogu', 'VJudge'];
const TAGS = ['基础', '排序', '图论', '动态规划', '数学', '字符串', '数据结构', '搜索'];
const PROBLEMS = PROBLEM_TITLES.map((title, index) => ({
  id: `P${1001 + index}`,
  title,
  oj: OJS[index % OJS.length],
  tags: [TAGS[Math.floor(index / 6) % TAGS.length], TAGS[(index + 3) % TAGS.length]],
  difficulty: (index % 5) + 1,
  solved: index < 4 || index % 4 === 0,
  status: index < 4 || index % 4 === 0 ? 'AC' : 'UNSOLVED',
  accepted: 80 + ((index * 137) % 4200),
  submissions: 160 + ((index * 293) % 9800)
}));
const CONTESTS = [
  { id: '2001', title: 'Mock 新手入门赛', status: 'upcoming', startTime: '2026-08-01 09:00', endTime: '2026-08-01 12:00', description: '面向新手的离线模拟比赛，覆盖基础语法、排序和简单数学。' },
  { id: '2002', title: 'Mock 算法进阶赛', status: 'running', startTime: '2026-07-20 14:00', endTime: '2026-07-20 19:00', description: '综合算法训练，包含动态规划、图论与数据结构题目。' },
  { id: '2003', title: 'Mock 动态规划专项', status: 'ended', startTime: '2026-06-11 18:00', endTime: '2026-06-11 21:00', description: '背包、序列动态规划和状态设计专项训练。' },
  { id: '2004', title: 'Mock 图论挑战赛', status: 'running', startTime: '2026-07-21 08:30', endTime: '2026-07-21 13:30', description: '最短路、生成树、连通分量及网络流综合练习。' },
  { id: '2005', title: 'Mock 冬季训练营', status: 'upcoming', startTime: '2026-12-15 09:00', endTime: '2026-12-15 16:00', description: '六小时团队模拟训练，适合赛前协作与复盘。' },
  { id: '2006', title: 'Mock 春季邀请赛', status: 'ended', startTime: '2026-04-05 10:00', endTime: '2026-04-05 15:00', description: '覆盖全部知识点的邀请制模拟赛，提供完整离线榜单。' }
];
const INITIAL_SUBMISSIONS = [
  { id: '9001', problemId: 'P1001', result: 'AC', language: 'C++', submitTime: '2026-07-21 10:01:00', time: '12 ms', memory: '1.2 MB' },
  { id: '9002', problemId: 'P1004', result: 'WA', language: 'Python', submitTime: '2026-07-21 10:04:00', time: '35 ms', memory: '4.8 MB' },
  { id: '9003', problemId: 'P1010', result: 'Pending', language: 'Java', submitTime: '2026-07-21 10:08:00', time: '-', memory: '-' },
  { id: '9004', problemId: 'P1016', result: 'TLE', language: 'C++', submitTime: '2026-07-21 10:12:00', time: '2000 ms', memory: '8.4 MB' },
  { id: '9005', problemId: 'P1018', result: 'AC', language: 'C++', submitTime: '2026-07-21 10:18:00', time: '48 ms', memory: '3.1 MB' },
  { id: '9006', problemId: 'P1030', result: 'CE', language: 'Java', submitTime: '2026-07-21 10:25:00', time: '-', memory: '-' },
  { id: '9007', problemId: 'P1038', result: 'Pending', language: 'Python', submitTime: '2026-07-21 10:31:00', time: '-', memory: '-' }
];

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
function abortError() {
  const error = new Error('Mock 请求已取消');
  error.name = 'AbortError';
  return error;
}
function checkAbort(options) {
  if (options && options.signal && options.signal.aborted) throw abortError();
}
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function booleanFilter(value) {
  if (value === true || value === 'true' || value === 'AC' || value === 'ac') return true;
  if (value === false || value === 'false' || value === 'UNSOLVED') return false;
  return undefined;
}

class MockClient {
  constructor(options = {}) {
    this.store = options.store;
    this.loggedIn = true;
    this.currentUser = { username: 'mock_user', nickname: 'Mock 用户' };
    this.favorites = new Set(['P1001', 'P1007', 'P1016']);
    this.registeredContests = new Set(['2002']);
    this.submissions = INITIAL_SUBMISSIONS.map((item) => ({ ...item, status: item.result, _pollCount: 0 }));
    this.nextSubmitId = 9100;
  }

  async reply(value, options) {
    checkAbort(options);
    await Promise.resolve();
    checkAbort(options);
    return clone(value);
  }

  requireLogin() {
    if (!this.loggedIn) throw new Error('请先登录');
  }

  problem(id) {
    return PROBLEMS.find((item) => item.id === String(id));
  }

  contest(id) {
    return CONTESTS.find((item) => item.id === String(id));
  }

  publicSubmission(item) {
    return {
      id: item.id, submitId: item.id, problemId: item.problemId,
      problemTitle: (this.problem(item.problemId) || {}).title || item.problemId,
      result: item.result, status: item.status, language: item.language,
      submitTime: item.submitTime, time: item.time, memory: item.memory, code: item.code || ''
    };
  }

  // Mock 模式为离线演示，不做登录门控，始终允许浏览内置数据
  requiresLogin() { return false; }

  isLoggedIn() { return true; }

  async ensureSession() {
    return { loggedIn: true, username: this.currentUser && this.currentUser.username, checked: true };
  }

  allowsAnonymousBrowsing() { return true; }

  async loginWithCookie(cookieText, username = '') {
    if (!String(cookieText || '').trim()) throw new Error('请粘贴 Cookie 内容');
    const name = username || 'mock-user';
    this.loggedIn = true;
    this.currentUser = { username: name, nickname: `${name}（Mock）` };
    if (this.store) await this.store.setCurrentUser(this.currentUser);
    return this.reply({ success: true, username: name });
  }

  async login(user, pass) {
    if (!user || !pass) throw new Error('用户名和密码不能为空');
    this.loggedIn = true;
    this.currentUser = { username: user, nickname: `${user}（Mock）` };
    if (this.store) {
      await this.store.saveCredentials(user, pass);
      await this.store.setCurrentUser(this.currentUser);
    }
    return this.reply({ success: true, username: user, user: this.currentUser });
  }

  async logout() {
    this.loggedIn = false;
    this.currentUser = undefined;
    if (this.store) await this.store.clearCredentials();
    return this.reply({ success: true });
  }

  async checkSession(options = {}) {
    return this.reply({ loggedIn: this.loggedIn, username: this.currentUser && this.currentUser.username,
      data: { user: this.currentUser } }, options);
  }

  async getProblems({ page = 1, search = '', oj = '', tag = '', difficulty = '', solved = '' } = {}, options = {}) {
    const keyword = String(search).toLowerCase();
    const solvedFilter = booleanFilter(solved);
    const filtered = PROBLEMS.filter((item) => (!keyword || `${item.id} ${item.title}`.toLowerCase().includes(keyword))
      && (!oj || item.oj.toLowerCase() === String(oj).toLowerCase())
      && (!tag || item.tags.includes(tag))
      && (difficulty === '' || item.difficulty === Number(difficulty))
      && (solvedFilter === undefined || item.solved === solvedFilter));
    const pageSize = 12;
    const currentPage = Math.max(1, Number(page) || 1);
    return this.reply({ problems: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
      total: filtered.length, page: currentPage, pageSize, totalPages: Math.ceil(filtered.length / pageSize) }, options);
  }

  async getProblemDetail(idOrUrl, options = {}) {
    const raw = decodeURIComponent(String(idOrUrl));
    const match = raw.match(/[?&]problemId=([^&#]+)/) || raw.match(/P\d{4}/i);
    const item = this.problem(match ? match[1] || match[0] : raw);
    if (!item) throw new Error(`Mock 题目不存在: ${idOrUrl}`);
    const index = Number(item.id.slice(1)) - 1000;
    const input = `${index} ${index + 1}`;
    const output = String(index * 2 + 1);
    const html = `<base href="https://vjudge.net/"><article class="problem"><h1>${escapeHtml(item.title)}</h1>`
      + `<section><h2>题目描述</h2><p>这是 ${escapeHtml(item.title)} 的离线 Mock 题目。请根据给定数据设计正确算法，并关注边界情况。</p></section>`
      + '<section><h2>输入格式</h2><p>输入包含两个整数 a 和 b，数值范围满足常规整型运算要求。</p></section>'
      + '<section><h2>输出格式</h2><p>输出计算结果，每组数据占一行。</p></section>'
      + `<section><h2>样例输入</h2><pre>${input}</pre><h2>样例输出</h2><pre>${output}</pre></section>`
      + '<section><h2>提示</h2><p>Mock 数据仅用于插件离线开发，不需要访问 VJudge。</p></section></article>';
    return this.reply({ ...item, html, samples: [{ input, output }], timeLimit: '1000 ms', memoryLimit: '256 MB',
      sourceUrl: `https://vjudge.net/problem/detail?problemId=${item.id}` }, options);
  }

  async submitCode({ problemId, language, code }, options = {}) {
    this.requireLogin();
    if (!this.problem(problemId)) throw new Error(`Mock 题目不存在: ${problemId}`);
    if (!code || !String(code).trim()) throw new Error('提交代码不能为空');
    const item = { id: String(this.nextSubmitId++), problemId: String(problemId), result: 'Pending', status: 'Pending',
      language: language || 'C++', submitTime: new Date().toISOString(), time: '-', memory: '-', code: String(code), _pollCount: 0 };
    this.submissions.unshift(item);
    const submission = this.publicSubmission(item);
    if (this.store) await this.store.setLastSubmission(problemId, submission);
    return this.reply({ ...submission, data: { success: true, mock: true } }, options);
  }

  advanceSubmissions() {
    this.submissions.forEach((item) => {
      if (item.result !== 'Pending') return;
      item._pollCount += 1;
      if (item._pollCount >= 2) {
        item.result = Number(item.id) % 3 === 0 ? 'WA' : 'AC';
        item.status = item.result;
        item.time = item.result === 'AC' ? '24 ms' : '31 ms';
        item.memory = '2.4 MB';
      }
    });
  }

  async getSubmitStatus({ page = 1, problemId = '', status = '' } = {}, options = {}) {
    this.advanceSubmissions();
    const filtered = this.submissions.filter((item) => (!problemId || item.problemId === String(problemId))
      && (!status || item.result.toLowerCase() === String(status).toLowerCase()));
    const pageSize = 5;
    const currentPage = Math.max(1, Number(page) || 1);
    const items = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((item) => this.publicSubmission(item));
    return this.reply({ submissions: items, total: filtered.length, page: currentPage, pageSize,
      totalPages: Math.ceil(filtered.length / pageSize) }, options);
  }

  async rejudge(submitId) {
    this.requireLogin();
    const item = this.submissions.find((submission) => submission.id === String(submitId));
    if (!item) throw new Error(`Mock 提交不存在: ${submitId}`);
    item.result = 'Pending'; item.status = 'Pending'; item.time = '-'; item.memory = '-'; item._pollCount = 0;
    return this.reply({ success: true, submission: this.publicSubmission(item) });
  }

  async getContests({ page = 1, status = '' } = {}, options = {}) {
    const filtered = CONTESTS.filter((item) => !status || item.status === status);
    const pageSize = 3;
    const currentPage = Math.max(1, Number(page) || 1);
    return this.reply({ contests: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
      total: filtered.length, page: currentPage, pageSize, totalPages: Math.ceil(filtered.length / pageSize) }, options);
  }

  async getContestDetail(id, options = {}) {
    const item = this.contest(id);
    if (!item) throw new Error(`Mock 比赛不存在: ${id}`);
    const html = `<base href="https://vjudge.net/"><article><h1>${escapeHtml(item.title)}</h1>`
      + `<p>${escapeHtml(item.description)}</p><p>开始时间：${item.startTime}<br>结束时间：${item.endTime}</p></article>`;
    return this.reply({ ...item, html, registered: this.registeredContests.has(item.id) }, options);
  }

  async getContestProblems(id, options = {}) {
    const contestIndex = CONTESTS.findIndex((item) => item.id === String(id));
    if (contestIndex < 0) throw new Error(`Mock 比赛不存在: ${id}`);
    const start = contestIndex * 6;
    const problems = Array.from({ length: 6 }, (_, index) => ({ ...PROBLEMS[(start + index) % PROBLEMS.length],
      label: String.fromCharCode(65 + index) }));
    return this.reply(problems, options);
  }

  async getContestRank(id, options = {}) {
    const item = this.contest(id);
    if (!item) throw new Error(`Mock 比赛不存在: ${id}`);
    const users = ['alice', 'bob', 'carol', 'david', 'erin', 'frank', 'grace', 'heidi'];
    const rankings = users.map((username, index) => ({
      rank: index + 1, username, solved: 6 - Math.floor(index / 2), penalty: 120 + index * 47,
      score: 600 - index * 35,
      problems: Object.fromEntries(Array.from({ length: 6 }, (_, problemIndex) => {
        const ac = problemIndex < 6 - Math.floor(index / 2);
        return [String.fromCharCode(65 + problemIndex), { status: ac ? 'AC' : '', tries: ac ? 1 + (index % 2) : index % 3,
          time: ac ? 20 + problemIndex * 17 + index * 3 : 0 }];
      }))
    }));
    return this.reply({ contestId: item.id, contestTitle: item.title, rankings }, options);
  }

  async registerContest(id) {
    this.requireLogin();
    if (!this.contest(id)) throw new Error(`Mock 比赛不存在: ${id}`);
    this.registeredContests.add(String(id));
    return this.reply({ success: true, registered: true, contestId: String(id) });
  }

  async getFavorites(options = {}) {
    return this.reply(PROBLEMS.filter((item) => this.favorites.has(item.id)), options);
  }

  async addFavorite(id) {
    if (!this.problem(id)) throw new Error(`Mock 题目不存在: ${id}`);
    this.favorites.add(String(id));
    return this.reply({ success: true, favorite: true, id: String(id) });
  }

  async removeFavorite(id) {
    this.favorites.delete(String(id));
    return this.reply({ success: true, favorite: false, id: String(id) });
  }

  async getUserInfo(username) {
    const name = username || (this.currentUser && this.currentUser.username) || 'mock_user';
    const solvedCount = PROBLEMS.filter((item) => item.solved).length;
    return this.reply({ username: name, nickname: this.currentUser && name === this.currentUser.username
      ? this.currentUser.nickname : `${name}（Mock）`, avatar: '', solvedCount,
      submissionCount: this.submissions.length, acceptRate: '68.4%', rank: 42,
      registeredContests: Array.from(this.registeredContests), mock: true });
  }
}

module.exports = { MockClient, PROBLEMS, CONTESTS, INITIAL_SUBMISSIONS };
