'use strict';

const vscode = require('vscode');
const { BASE_URL, PATHS, withQuery, problemDetailUrl, contestUrl } = require('./endpoints');
const { HttpClient, HttpError } = require('./http');
const {
  ParseError,
  parseProblemDetail,
  parseContests,
  parseContestDetail,
  parseProblemLinks
} = require('./parser');

function listPayload(payload, keys) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  if (!payload || typeof payload !== 'object') return { items: [], total: 0 };
  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return { items: payload[key], total: Number(payload.total || payload.recordsTotal || payload.count || payload[key].length) };
    }
  }
  if (payload.data && payload.data !== payload) return listPayload(payload.data, keys);
  return { items: [], total: Number(payload.total || payload.recordsTotal || 0) };
}

function normalizeProblem(item) {
  const value = item || {};
  return {
    ...value,
    id: String(value.id ?? value.problemId ?? value.problem_id ?? value.num ?? ''),
    title: value.title || value.name || value.problemTitle || '',
    oj: value.oj || value.origin || value.source || '',
    tags: value.tags || (value.tag ? [value.tag] : []),
    difficulty: value.difficulty ?? value.level ?? '',
    solved: Boolean(value.solved || value.ac || value.status === 'AC'),
    status: value.status || (value.solved || value.ac ? 'AC' : 'UNSOLVED')
  };
}

function normalizeSubmission(item) {
  const value = item || {};
  const result = value.result || value.status || value.verdict || 'Pending';
  return {
    ...value,
    id: String(value.id ?? value.submitId ?? value.runId ?? value.solutionId ?? ''),
    problemId: String(value.problemId ?? value.problem_id ?? value.problem ?? ''),
    result,
    status: result,
    language: value.language || value.lang || '',
    submitTime: value.submitTime || value.time || value.createdAt || ''
  };
}

class RealClient {
  constructor(options = {}) {
    if (!options.store) throw new Error('RealClient 需要 Store 实例');
    this.store = options.store;
    this.outputChannel = options.outputChannel;
    this.baseUrl = options.baseUrl || BASE_URL;
    this.sessionExpired = false;
    this.http = options.http || new HttpClient({
      baseUrl: this.baseUrl,
      outputChannel: this.outputChannel,
      isMockMode: () => this.store.isMockMode(),
      onCookiesChanged: (cookies) => this.store.saveCookies(cookies)
    });
  }

  async ready() {
    if (!this.initializing) {
      this.initializing = this.store.getCookies().then((cookies) => this.http.setCookies(cookies));
    }
    await this.initializing;
  }

  url(path, params) {
    return withQuery(path, params, this.baseUrl);
  }

  async handleSessionExpired() {
    if (this.sessionExpired) return;
    this.sessionExpired = true;
    this.http.setCookies({});
    await this.store.clearSession();
    vscode.window.showErrorMessage('登录已失效, 请重新登录');
    await vscode.commands.executeCommand('vjudge.login');
  }

  async request(path, options = {}) {
    await this.ready();
    try {
      return await this.http.request(path, options);
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'MOCK_NETWORK_BLOCKED') throw error;
      if (error instanceof HttpError && [401, 403].includes(error.status) && !options.skipSessionHandling) {
        await this.handleSessionExpired();
        throw error;
      }
      if (error instanceof SyntaxError) {
        this.parseFailure(error, '');
      }
      const message = error && error.message ? error.message : String(error);
      this.log(`请求失败 ${options.method || 'GET'} ${path}: ${message}`);
      vscode.window.showErrorMessage(`网络请求失败: ${message}, 请检查网络或代理设置`);
      throw error;
    }
  }

  log(message) {
    if (this.outputChannel) this.outputChannel.appendLine(`[VJudge] ${message}`);
  }

  parseFailure(error, raw) {
    this.log(`数据解析异常: ${error.message}`);
    this.log(`原始响应前500字符: ${String(raw || '').slice(0, 500)}`);
    vscode.window.showErrorMessage('数据解析异常, 请反馈');
    throw error instanceof ParseError ? error : new ParseError(error.message, raw);
  }

  json(response) {
    if (typeof response.data === 'string' || response.data === null || response.data === undefined) {
      this.parseFailure(new ParseError('接口未返回有效 JSON', response.rawText || response.data), response.rawText || response.data);
    }
    return response.data;
  }

  html(response, parser, args = []) {
    try {
      return parser(response.data, ...args);
    } catch (error) {
      return this.parseFailure(error, response.rawText || response.data);
    }
  }

  async login(user, pass) {
    const response = await this.request(this.url(PATHS.login), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ username: user, password: pass }).toString(),
      skipSessionHandling: true
    });
    const data = response.data;
    if ((data && typeof data === 'object' && (data.success === false || data.error))
      || (typeof data === 'string' && /(?:incorrect|login failed|wrong password|登录失败|密码错误)/i.test(data))) {
      throw new Error(typeof data === 'object' ? data.error || '用户名或密码错误' : '用户名或密码错误');
    }
    await this.store.saveCredentials(user, pass);
    await this.store.setCurrentUser({ username: user });
    await this.store.saveCookies(this.http.getCookies());
    this.sessionExpired = false;
    return { success: true, username: user, user: data && data.user ? data.user : { username: user } };
  }

  async logout() {
    try {
      const response = await this.request(this.url(PATHS.logout), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: '',
        skipSessionHandling: true
      });
      return response.data;
    } finally {
      this.http.setCookies({});
      await this.store.clearCredentials();
      this.sessionExpired = false;
    }
  }

  async checkSession() {
    const response = await this.request(this.url(PATHS.session));
    const data = response.data;
    const loggedIn = data && typeof data === 'object'
      ? Boolean(data.loggedIn ?? data.authenticated ?? data.login ?? data.success ?? true)
      : !/(?:login form|未登录|请登录)/i.test(String(data));
    if (!loggedIn) await this.handleSessionExpired();
    const username = data && typeof data === 'object'
      ? data.username || (data.user && data.user.username) : undefined;
    return { loggedIn, username, data };
  }

  async getProblems({ page = 1, search = '', oj = '', tag = '', difficulty = '', solved = '' } = {}, options = {}) {
    const response = await this.request(this.url(PATHS.problems, {
      page, search, oj, tag, difficulty, solved, start: (page - 1) * 50, length: 50
    }), options);
    const result = listPayload(this.json(response), ['problems', 'rows', 'records', 'items']);
    return { problems: result.items.map(normalizeProblem), total: result.total, page };
  }

  async getProblemDetail(idOrUrl, options = {}) {
    const response = await this.request(problemDetailUrl(idOrUrl, this.baseUrl), options);
    return this.html(response, parseProblemDetail, [idOrUrl]);
  }

  async submitCode({ problemId, language, code }, options = {}) {
    const response = await this.request(this.url(PATHS.submit), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ problemId, language, code }).toString()
    });
    const data = response.data;
    const submitId = data && typeof data === 'object'
      ? data.submitId || data.runId || data.solutionId || data.id
      : String(data).match(/(?:submitId|runId|solutionId)["'\s:=]+(\d+)/i)?.[1];
    const submission = { submitId: submitId ? String(submitId) : '', problemId, status: 'Pending' };
    await this.store.setLastSubmission(problemId, submission);
    return { ...submission, data };
  }

  async getSubmitStatus({ page = 1, problemId = '', status = '' } = {}, options = {}) {
    const response = await this.request(this.url(PATHS.submissions, {
      page, problemId, status, start: (page - 1) * 50, length: 50
    }), options);
    const result = listPayload(this.json(response), ['submissions', 'solutions', 'rows', 'records', 'items']);
    return { submissions: result.items.map(normalizeSubmission), total: result.total, page };
  }

  async rejudge(submitId, options = {}) {
    const response = await this.request(this.url(PATHS.rejudge), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ submitId }).toString()
    });
    return response.data;
  }

  async getContests({ page = 1, status = '' } = {}, options = {}) {
    const response = await this.request(this.url(PATHS.contests, { page, status }), options);
    const contests = this.html(response, parseContests);
    return { contests, total: contests.length, page };
  }

  async getContestDetail(id, options = {}) {
    const response = await this.request(contestUrl(PATHS.contestDetail, id, this.baseUrl), options);
    return this.html(response, parseContestDetail, [id]);
  }

  async getContestProblems(id, options = {}) {
    const response = await this.request(contestUrl(PATHS.contestProblems, id, this.baseUrl), options);
    if (typeof response.data === 'string') return this.html(response, parseProblemLinks);
    return listPayload(this.json(response), ['problems', 'rows', 'items']).items.map(normalizeProblem);
  }

  async getContestRank(id, options = {}) {
    const response = await this.request(contestUrl(PATHS.contestRank, id, this.baseUrl), options);
    return this.json(response);
  }

  async registerContest(id, options = {}) {
    const response = await this.request(this.url(PATHS.contestRegister), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ contestId: id }).toString()
    });
    return response.data;
  }

  async getFavorites(options = {}) {
    const response = await this.request(this.url(PATHS.favorites), options);
    if (typeof response.data === 'string') return this.html(response, parseProblemLinks);
    return listPayload(this.json(response), ['favorites', 'problems', 'rows', 'items']).items.map(normalizeProblem);
  }

  async addFavorite(id) {
    const response = await this.request(this.url(PATHS.favoriteAdd), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ problemId: id }).toString()
    });
    return response.data;
  }

  async removeFavorite(id) {
    const response = await this.request(this.url(PATHS.favoriteRemove), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ problemId: id }).toString()
    });
    return response.data;
  }

  async getUserInfo(username, options = {}) {
    const response = await this.request(this.url(PATHS.userInfo, { username }), options);
    return this.json(response);
  }
}

module.exports = { RealClient, normalizeProblem, normalizeSubmission, listPayload };
