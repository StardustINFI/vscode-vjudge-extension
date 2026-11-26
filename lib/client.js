'use strict';

const vscode = require('vscode');
const {
  BASE_URL, PATHS, CONTEST_CATEGORIES, withQuery, format, dtParams, problemKey,
  problemDetailUrl, problemDescriptionUrl, problemSubmitUrl, rejudgeUrl, contestUrl,
  contestRankUrl, favoriteUrl, userInfoUrl, groupUrl, groupSearchUrl
} = require('./endpoints');
const { HttpClient, HttpError } = require('./http');
const { inlineImages } = require('./images');
const {
  ParseError,
  parseProblemDetail,
  parseProblemDescription,
  parseContestDetail,
  parseContestProblems,
  parseUserProfile,
  parseMyGroups,
  parseGroupDetail,
  normalizeGroup,
  embeddedData,
  setCdnBaseUrl
} = require('./parser');

const PAGE_SIZE = 20;

// 这些比赛分类只在登录后才有意义。未登录时 VJudge 会把 category=mygroup
// 静默退化成全量公开比赛，因此客户端必须先确认登录态再决定是否发请求。
const PERSONAL_CONTEST_CATEGORIES = new Set([
  'mygroup', 'group', 'mine', 'participation', 'arrangement', 'favorites', 'follow'
]);

function emptyPage(page, pageSize = PAGE_SIZE) {
  const currentPage = Math.max(1, Number(page) || 1);
  return { total: 0, page: currentPage, pageSize, totalPages: 1 };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// 题目：真实字段 id / originOJ / originProb / title / source / solvedUsers / isFav / available / visibility
// VJudge 详情与提交用 "OJ-编号"，收藏用数据库数字 id，故同时保留 key 与 dbId
function normalizeProblem(item) {
  const value = item || {};
  const dbId = value.id ?? value.problemId ?? value.dbId ?? '';
  const key = value.key || (value.originOJ && value.originProb
    ? `${value.originOJ}-${value.originProb}`
    : problemKey(dbId));
  return {
    ...value,
    id: String(key || dbId || ''),
    key: String(key || ''),
    dbId: String(dbId || ''),
    title: value.title || value.name || '',
    oj: value.oj || value.originOJ || value.source || '',
    probNum: value.probNum || value.originProb || '',
    source: value.source || '',
    tags: value.tags || (value.tag ? [value.tag] : []),
    difficulty: value.difficulty ?? value.level ?? '',
    solvedUsers: safeNumber(value.solvedUsers ?? value.accepted),
    isFav: Boolean(value.isFav || value.favorite),
    available: value.available !== false,
    solved: Boolean(value.solved || value.ac || value.status === 'AC'),
    status: value.status || (value.solved || value.ac ? 'AC' : 'UNSOLVED')
  };
}

// 提交：真实字段 runId / time / userName / oj / probNum / language / status / statusType /
//       processing / memory / runtime / sourceLength / problemId / contestId
function normalizeSubmission(item) {
  const value = item || {};
  const rawResult = value.result || value.status || value.verdict || 'Pending';
  const result = normalizeVerdict(rawResult, value.statusType);
  // 优先使用 OJ-编号（供详情/提交），无 oj 时退化为原始 problemId
  const problemId = (value.oj && value.probNum ? `${value.oj}-${value.probNum}` : value.probNum)
    || value.problemId || '';
  return {
    ...value,
    id: String(value.id ?? value.runId ?? value.submitId ?? value.solutionId ?? ''),
    runId: String(value.runId ?? value.id ?? ''),
    problemId: String(problemId),
    problemTitle: value.problemTitle || value.probNum || String(problemId),
    oj: value.oj || '',
    probNum: value.probNum || '',
    userName: value.userName || value.username || '',
    result,
    status: result,
    rawResult: String(rawResult),
    statusType: value.statusType,
    processing: Boolean(value.processing),
    language: value.language || value.lang || '',
    submitTime: value.submitTime || (value.time ? new Date(safeNumber(value.time)).toISOString() : '') || value.createdAt || '',
    time: value.timeDisplay || (value.runtime ? `${Math.round(safeNumber(value.runtime))} ms` : (value.time || '')),
    memory: value.memoryDisplay || (value.memory ? `${Math.round(safeNumber(value.memory))} KB` : (value.memory || ''))
  };
}

// 将 VJudge 英文评测结果映射为视图层可识别的简短结果
function normalizeVerdict(raw, statusType) {
  const text = String(raw || '').trim();
  if (/^ac$|accepted|正确/i.test(text)) return 'AC';
  if (/^wa$|wrong|答案错误/i.test(text)) return 'WA';
  if (/^tle$|time limit|超时/i.test(text)) return 'TLE';
  if (/^mle$|memory limit/i.test(text)) return 'MLE';
  if (/^re$|runtime error|运行错误/i.test(text)) return 'RE';
  if (/^ce$|compile|compilation error|编译错误/i.test(text)) return 'CE';
  if (/^pe$|presentation/i.test(text)) return 'PE';
  if (/pending|judging|queued|waiting|running|in queue|评测中|等待/i.test(text)) return 'Pending';
  if (statusType === 0 && /accepted/i.test(text)) return 'AC';
  return text || 'Pending';
}

// 比赛：真实返回为数组 [id,title,type,beg,end,openness,contestants,manager,group,groupShort,isFav,avatar]
function normalizeContest(item) {
  const value = Array.isArray(item)
    ? {
        id: item[0], title: item[1], type: item[2], begin: item[3], end: item[4],
        openness: item[5], contestants: item[6], managerName: item[7],
        groupName: item[8], groupShortName: item[9], isFav: item[10], avatar: item[11]
      }
    : (item || {});
  const begin = safeNumber(value.begin ?? value.startTime ?? value.contestBeginTime);
  const end = safeNumber(value.end ?? value.endTime ?? value.contestEndTime);
  const now = Date.now();
  let status = value.status;
  if (!status) {
    if (begin && now < begin) status = 'upcoming';
    else if (end && now > end) status = 'ended';
    else if (begin && end) status = 'running';
    else status = 'unknown';
  }
  return {
    ...value,
    id: String(value.id ?? value.contestId ?? ''),
    title: value.title || value.contestTitle || '',
    status,
    begin,
    end,
    length: safeNumber(value.length),
    startTime: value.startTime || (begin ? new Date(begin).toLocaleString('zh-CN') : ''),
    endTime: value.endTime || (end ? new Date(end).toLocaleString('zh-CN') : ''),
    contestants: safeNumber(value.contestants),
    openness: value.openness ?? value.type,
    managerName: value.managerName || '',
    isFav: Boolean(value.isFav),
    avatar: value.avatar || value.managerAvatarUrl || '',
    url: value.url || contestUrl(value.id ?? value.contestId ?? '')
  };
}

function listPayload(payload, keys) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  if (!payload || typeof payload !== 'object') return { items: [], total: 0 };
  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return {
        items: payload[key],
        total: safeNumber(payload.total ?? payload.recordsTotal ?? payload.recordsFiltered ?? payload[key].length)
      };
    }
  }
  if (payload.data && payload.data !== payload) return listPayload(payload.data, keys);
  return { items: [], total: safeNumber(payload.total ?? payload.recordsTotal ?? payload.recordsFiltered ?? 0) };
}

// 记录题目 OJ-编号 与数据库 id 的映射，供收藏接口使用
function rememberProblemIds(map, items) {
  items.forEach((item) => {
    if (item && item.key && item.dbId) map.set(String(item.key), String(item.dbId));
  });
}

// 比赛题目的 pid 是数据库数字 id；登记后从比赛题目节点收藏才能调用 /problem/{id}/favorite/*
function rememberContestProblemIds(map, items) {
  (items || []).forEach((item) => {
    const dbId = item && (item.dbId || item.pid);
    if (item && item.key && dbId) map.set(String(item.key), String(dbId));
  });
}

// 记录题目 OJ-编号 -> descKey 列表（题面正文接口用）。
// 题目 meta 来自比赛 dataJson 的 descBriefs / enabledDescKeys。
function rememberProblemDescKeys(map, items) {
  (items || []).forEach((item) => {
    if (!item || !item.key) return;
    const keys = [];
    (item.descBriefs || []).forEach((brief) => {
      if (brief && brief.key) keys.push({ key: brief.key, lang: brief.lang || brief.statementKey || '', type: brief.type });
    });
    (item.enabledDescKeys || []).forEach((key) => {
      if (key && !keys.some((entry) => String(entry.key) === String(key))) {
        keys.push({ key, lang: '', type: '' });
      }
    });
    if (keys.length) map.set(String(item.key), keys);
  });
}

// 选择最合适的 descKey：中文(main/official) 优先，其次任意中文，再取第一个。
function chooseDescKey(entries) {
  if (!Array.isArray(entries) || !entries.length) return undefined;
  const isChinese = (e) => /^(zh|zh-CN|zh_CN|cn)/i.test(String(e.lang || ''));
  const mainZh = entries.find((e) => isChinese(e) && /^(main|official)$/i.test(String(e.type || '')));
  if (mainZh) return mainZh.key;
  const anyZh = entries.find(isChinese);
  if (anyZh) return anyZh.key;
  return entries[0].key;
}

// VJudge 未登录时 /problem/data 返回 recordsTotal=9999999 这一哨兵值，不能当成真实总数
function saneTotal(total, fallback) {
  const value = safeNumber(total, fallback);
  return Number.isFinite(value) && value >= 0 && value < 9999999 ? value : fallback;
}

function pageResult(items, total, page, pageSize) {
  const currentPage = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || PAGE_SIZE);
  const safeTotal = saneTotal(total, items.length);
  return {
    items,
    total: safeTotal,
    page: currentPage,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(safeTotal / size))
  };
}

// /user/checkLogInStatus 的 Content-Type 是 application/json，响应体是 JSON 布尔值 true/false。
// 旧实现只按字符串 "true"/"false" 判断，导致已登录被误判为未登录并触发"登录已失效"。
function parseLoginFlag(data) {
  if (typeof data === 'boolean') return data;
  if (typeof data === 'number') return data === 1;
  if (typeof data === 'string') {
    const text = data.trim().toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0' || text === '') return false;
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'boolean') return parsed;
      if (parsed && typeof parsed === 'object') return parseLoginFlag(parsed);
    } catch { /* 非 JSON 文本按未登录处理 */ }
    return false;
  }
  if (data && typeof data === 'object') {
    return Boolean(data.loggedIn ?? data.authenticated ?? data.login ?? data.success ?? false);
  }
  return false;
}

// 登录接口 401 时返回 {"i18nKey":"user.auth.error.invalid_credentials","trustable":false}
function authErrorMessage(data, status) {
  const payload = data && typeof data === 'object' ? data : {};
  const key = String(payload.i18nKey
    || (payload.error && (payload.error.i18nKey || payload.error.message))
    || payload.message || payload.error || '');
  if (/human_verification|captcha|turnstile|verification_failed/i.test(key)) {
    return 'VJudge 需要人机验证，插件无法自动完成。请在网页端登录后改用「Cookie 登录」';
  }
  if (/invalid_credentials|wrong_password|password|incorrect/i.test(key)) return '用户名或密码错误';
  if (/disabled|locked|banned|forbidden/i.test(key)) return '账号被禁用或锁定';
  if (/not_login|unauthorized|login_required/i.test(key)) return '请先登录 VJudge';
  if (key) return `请求被拒绝: ${key}${status ? ` (HTTP ${status})` : ''}`;
  return `请求被拒绝${status ? ` (HTTP ${status})` : ''}，请检查登录状态`;
}

function authError(error) {
  const friendly = new Error(authErrorMessage(error && error.data, error && error.status));
  friendly.name = 'AuthError';
  friendly.status = error && error.status;
  return friendly;
}

// 解析从浏览器 DevTools 复制的 Cookie 请求头，也支持 JSON 对象
function parseCookieText(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return Object.fromEntries(Object.entries(parsed || {})
        .filter(([key, value]) => key && typeof value === 'string')
        .map(([key, value]) => [String(key).trim(), value]));
    } catch { return {}; }
  }
  const ignored = /^(path|domain|expires|max-age|secure|httponly|samesite|priority|partitioned)$/i;
  const cookies = {};
  text.replace(/^cookie:\s*/i, '').split(/[;\n]/).forEach((part) => {
    const pair = String(part).trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) return;
    const key = pair.slice(0, separator).trim();
    if (!key || ignored.test(key)) return;
    cookies[key] = pair.slice(separator + 1).trim();
  });
  return cookies;
}

class RealClient {
  constructor(options = {}) {
    if (!options.store) throw new Error('RealClient 需要 Store 实例');
    this.store = options.store;
    this.outputChannel = options.outputChannel;
    this.baseUrl = options.baseUrl || BASE_URL;
    // 会话状态缓存：checked 表示是否已向服务端确认过登录态
    this.session = { loggedIn: false, username: undefined, checked: false };
    this.sessionPromise = undefined;
    this.expiryNotified = false;
    this.problemIds = new Map(); // key -> 数据库数字 id，用于收藏接口
    this.problemDescKeys = new Map(); // key -> descKey 数组，用于题面正文接口
    this.contestSolved = new Map(); // contestId -> Set(已 AC 的题目 key)，供比赛题目状态显示
    this.groups = undefined; // 我的团队缓存，供比赛范围过滤复用
    this.http = options.http || new HttpClient({
      baseUrl: this.baseUrl,
      outputChannel: this.outputChannel,
      isMockMode: () => this.store.isMockMode(),
      onCookiesChanged: (cookies) => this.store.saveCookies(cookies)
    });
  }

  async ready() {
    if (!this.initializing) {
      this.initializing = this.store.getCookies()
        .then((cookies) => this.http.setCookies(cookies))
        // VJudge 题面图片用 CDN_BASE_URL/ 占位符，真实域名由 /util/cfg 下发。
        // 抓到后同步给 parser，失败则沿用内置默认值（cdn.vjudge.net.cn）。
        .then(() => this.loadCdnConfig())
        .catch(() => undefined);
    }
    await this.initializing;
  }

  async loadCdnConfig() {
    try {
      const response = await this.http.request('/util/cfg', {
        suppressNetworkToast: true,
        skipSessionHandling: true,
        timeout: 8000
      });
      const cfg = response && response.data;
      if (cfg && typeof cfg.cdnBaseUrl === 'string') setCdnBaseUrl(cfg.cdnBaseUrl);
    } catch {
      // 配置接口不可达不影响主流程，parser 使用默认 CDN 域名。
    }
  }

  url(path, params) {
    return withQuery(path, params, this.baseUrl);
  }

  // 只有"此前确实处于登录态"才叫失效；未登录时访问受限接口不得误报
  async hadLoginState() {
    if (this.session.loggedIn) return true;
    try {
      const current = this.store.getCurrentUser ? await this.store.getCurrentUser() : undefined;
      return Boolean(current && current.username);
    } catch {
      return false;
    }
  }

  async handleSessionExpired() {
    if (this.expiryNotified || !(await this.hadLoginState())) return;
    this.expiryNotified = true;
    this.session = { loggedIn: false, username: undefined, checked: true };
    this.http.setCookies({});
    if (this.store.clearSession) await this.store.clearSession();
    const action = await vscode.window.showErrorMessage('登录已失效, 请重新登录', '重新登录');
    if (action === '重新登录') await vscode.commands.executeCommand('vjudge.login');
  }

  isLoggedIn() {
    return this.session.checked && this.session.loggedIn;
  }

  requiresLogin() {
    return true;
  }

  allowsAnonymousBrowsing() {
    return Boolean(this.store.allowsAnonymousBrowsing && this.store.allowsAnonymousBrowsing());
  }

  // 并发的视图刷新共用同一次会话检查，避免重复请求
  async ensureSession() {
    if (this.session.checked) return this.session;
    if (!this.sessionPromise) {
      this.sessionPromise = this.checkSession()
        .then(() => this.session)
        .finally(() => { this.sessionPromise = undefined; });
    }
    return this.sessionPromise;
  }

  async request(path, options = {}) {
    await this.ready();
    try {
      return await this.http.request(path, options);
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'MOCK_NETWORK_BLOCKED') throw error;
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        if (!options.skipSessionHandling) await this.handleSessionExpired();
        throw authError(error);
      }
      if (error instanceof SyntaxError) {
        this.parseFailure(error, error.rawText || '');
      }
      const message = error && error.message ? error.message : String(error);
      this.log(`请求失败 ${options.method || 'GET'} ${path}: ${message}`);
      if (!options.suppressNetworkToast) {
        vscode.window.showErrorMessage(`网络请求失败: ${message}, 请检查网络或代理设置`);
      }
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
      this.parseFailure(new Error('接口未返回有效 JSON'), response.rawText || response.data);
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

  // 把正文里的远程图片内联为 data URI，绕过 Webview 网络/防盗链问题。
  // 抓取失败时保留原 URL，不阻塞主流程。
  async enrichHtml(detail) {
    if (!detail || typeof detail.html !== 'string' || !detail.html) return detail;
    try {
      detail.html = await inlineImages(detail.html);
    } catch (error) {
      this.log(`图片内联失败: ${error.message}`);
    }
    return detail;
  }

  async login(user, pass) {
    // POST /user/login，表单 username / password / token（token 为 Turnstile 人机验证，插件无法自动完成）
    const response = await this.request(resolve(this.baseUrl, PATHS.login), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ username: user, password: pass, token: '' }).toString(),
      skipSessionHandling: true,
      suppressNetworkToast: true
    });
    const data = response.data;
    if (data && typeof data === 'object' && (data.error || data.success === false || data.i18nKey)) {
      throw new Error(authErrorMessage(data, response.status));
    }
    if (typeof data === 'string' && /(?:incorrect|login failed|wrong password|登录失败|密码错误)/i.test(data)) {
      throw new Error('用户名或密码错误');
    }
    // 关键：HTTP 200 不代表登录成功，必须用会话接口真正验证
    const session = await this.checkSession();
    if (!session.loggedIn) {
      throw new Error('登录未生效：VJudge 可能要求人机验证。请在网页端登录后改用「Cookie 登录」');
    }
    await this.store.saveCredentials(user, pass);
    await this.store.setCurrentUser({ username: user, nickname: user });
    await this.store.saveCookies(this.http.getCookies());
    this.expiryNotified = false;
    this.groups = undefined;
    return { success: true, username: user, user: { username: user } };
  }

  // 网页端已登录时，直接导入 Cookie 即可，绕过 Turnstile 人机验证
  async loginWithCookie(cookieText, username = '') {
    const cookies = parseCookieText(cookieText);
    if (!Object.keys(cookies).length) {
      throw new Error('未解析到有效 Cookie，请粘贴形如 JSESSIONID=xxx; JSESSlONID=yyy 的内容');
    }
    // ready() 首次执行会用 SecretStorage 里的旧 Cookie 覆盖，必须先完成初始化
    await this.ready();
    this.http.setCookies(cookies);
    const session = await this.checkSession();
    if (!session.loggedIn) {
      this.http.setCookies({});
      throw new Error('Cookie 无效或已过期，请在 vjudge.net 登录后重新复制 Cookie');
    }
    const name = username || session.username || '';
    await this.store.setCurrentUser({ username: name, nickname: name });
    await this.store.saveCookies(this.http.getCookies());
    this.expiryNotified = false;
    this.groups = undefined;
    return { success: true, username: name };
  }

  async logout() {
    try {
      const response = await this.request(resolve(this.baseUrl, PATHS.logout), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: '',
        skipSessionHandling: true
      });
      return response.data;
    } finally {
      this.http.setCookies({});
      await this.store.clearCredentials();
      this.session = { loggedIn: false, username: undefined, checked: true };
      this.expiryNotified = false;
      this.groups = undefined;
    }
  }

  // 纯查询：只报告服务端登录态，绝不弹窗、清 Cookie 或自动触发登录命令
  async checkSession(options = {}) {
    // GET /user/checkLogInStatus -> application/json，响应体为 JSON 布尔值 true / false
    const response = await this.request(resolve(this.baseUrl, PATHS.session), {
      ...options,
      skipSessionHandling: true,
      suppressNetworkToast: true
    });
    const data = response.data;
    const loggedIn = parseLoginFlag(data);
    let username = data && typeof data === 'object'
      ? (data.username || (data.user && data.user.username)) : undefined;
    if (!username && this.store.getCurrentUser) {
      const current = await this.store.getCurrentUser();
      username = current && current.username;
    }
    this.session = { loggedIn, username, checked: true };
    if (loggedIn) this.expiryNotified = false;
    else this.groups = undefined;
    return { loggedIn, username, data };
  }

  async getProblems({ page = 1, search = '', oj = '', tag = '', difficulty = '', solved = '' } = {}, options = {}) {
    // GET /problem/data?draw&start&length&sortDir&sortCol&OJId&probNum&title&source&category
    const params = dtParams({
      page,
      pageSize: PAGE_SIZE,
      sortCol: 6,
      sortDir: 'desc',
      OJId: oj || 'All',
      probNum: '',
      title: search || '',
      source: '',
      category: solved === true || solved === 'AC' ? 'solved'
        : solved === false || solved === 'UNSOLVED' ? 'attempted' : 'all'
    });
    const response = await this.request(this.url(PATHS.problems, params), options);
    const payload = this.json(response);
    const result = listPayload(payload, ['data', 'problems', 'rows', 'records', 'items']);
    const problems = result.items.map(normalizeProblem);
    rememberProblemIds(this.problemIds, problems);
    const paged = pageResult(problems, payload.recordsFiltered ?? payload.recordsTotal ?? result.total, page, PAGE_SIZE);
    return { problems: paged.items, total: paged.total, page: paged.page, pageSize: paged.pageSize, totalPages: paged.totalPages };
  }

  // 供命令层在从比赛题目节点打开题目时，主动登记题面 descKey。
  rememberProblem(problem) {
    if (!problem || typeof problem !== 'object') return;
    rememberProblemDescKeys(this.problemDescKeys, [problem]);
    rememberContestProblemIds(this.problemIds, [problem]);
  }

  // GET /problem/description/{descKey} -> 题面正文页（data-json-container）
  // descKey 来自题目 meta 的 descBriefs/enabledDescKeys；若调用方直接给出 descKey 可用。
  async getProblemDescription(idOrUrl, descKey, options = {}) {
    const key = descKey || chooseDescKey(this.problemDescKeys.get(String(problemKey(idOrUrl))));
    if (!key) return undefined;
    const response = await this.request(problemDescriptionUrl(key, this.baseUrl), options);
    const detail = this.html(response, parseProblemDescription, [this.baseUrl]);
    if (detail && detail.parseError) return undefined;
    await this.enrichHtml(detail);
    return { ...detail, descKey: String(key) };
  }

  async getProblemDetail(idOrUrl, options = {}) {
    // GET /problem/{OJ-编号}  -> HTML 页面（题面正文在此页常常为空，见下）
    const response = await this.request(problemDetailUrl(idOrUrl, this.baseUrl), options);
    const detail = this.html(response, parseProblemDetail, [problemKey(idOrUrl)]);
    const key = String(problemKey(idOrUrl));
    // VJudge 的真实题面正文在 /problem/description/{descKey}，不在详情页内联数据。
    // 若详情页未拿到正文、且我们已登记 descKey，则调用正文接口补全。
    if ((!detail.html || detail.descriptionMissing) && this.problemDescKeys.has(key)) {
      try {
        const desc = await this.getProblemDescription(key, undefined, options);
        if (desc && desc.html) {
          detail.html = desc.html;
          detail.samples = desc.samples && desc.samples.length ? desc.samples : detail.samples;
          detail.lang = desc.lang;
          detail.descriptionMissing = false;
          detail.descKey = desc.descKey;
        }
      } catch (error) {
        this.log(`题面正文获取失败 (${key}): ${error.message}`);
      }
    }
    await this.enrichHtml(detail);
    return {
      ...detail,
      id: key,
      key,
      sourceUrl: /^https?:\/\//i.test(String(idOrUrl)) ? String(idOrUrl) : problemDetailUrl(idOrUrl, this.baseUrl)
    };
  }

  async submitCode({ problemId, language, code }, options = {}) {
    // POST /problem/submit/{OJ-编号}  form: method/language/source/open/token
    const response = await this.request(problemSubmitUrl(problemId, this.baseUrl), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({
        method: '1',
        language: language || 'C++',
        source: String(code),
        open: '0',
        token: ''
      }).toString()
    });
    const data = response.data;
    const submitId = data && typeof data === 'object'
      ? data.runId || data.submitId || data.solutionId || data.id
      : String(data || '').match(/(?:runId|submitId|solutionId)["'\s:=]+(\d+)/i)?.[1];
    const submission = { submitId: submitId ? String(submitId) : '', problemId: String(problemId), status: 'Pending' };
    await this.store.setLastSubmission(problemId, submission);
    return { ...submission, data };
  }

  async getSubmitStatus({ page = 1, problemId = '', status = '', username = '' } = {}, options = {}) {
    // GET /status/data?draw&start&length&un&OJId&probNum&res&language
    const key = problemId ? problemKey(problemId) : '';
    const oj = key && key.includes('-') ? key.split('-')[0] : 'All';
    const probNum = key && key.includes('-') ? key.slice(key.indexOf('-') + 1) : key;
    const res = status && !/^(all|pending)$/i.test(status) ? status : '';
    // un 缺省时回退到当前登录用户，避免把全站他人的 AC 当成"我的提交"
    let un = username;
    if (!un && this.store && this.store.getCurrentUser) {
      const current = await this.store.getCurrentUser();
      un = current && current.username ? current.username : '';
    }
    const params = dtParams({ page, pageSize: PAGE_SIZE, un: un || '', OJId: oj || 'All', probNum, res, language: '' });
    const response = await this.request(this.url(PATHS.submissions, params), options);
    const payload = this.json(response);
    const result = listPayload(payload, ['data', 'submissions', 'solutions', 'rows', 'records', 'items']);
    let submissions = result.items.map(normalizeSubmission);
    if (/^pending$/i.test(status)) {
      submissions = submissions.filter((item) => /pending/i.test(item.result));
    }
    const paged = pageResult(submissions, payload.recordsFiltered ?? payload.recordsTotal ?? result.total, page, PAGE_SIZE);
    return {
      submissions: paged.items, total: paged.total, page: paged.page,
      pageSize: paged.pageSize, totalPages: paged.totalPages
    };
  }

  async getSubmissionDetail(runIds, options = {}) {
    // POST /status/dataById  form: runIds[]  -> { [runId]: {...} }
    const ids = Array.isArray(runIds) ? runIds : [runIds];
    const form = new URLSearchParams();
    ids.forEach((id) => form.append('runIds', String(id)));
    const response = await this.request(resolve(this.baseUrl, PATHS.submissionById), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form.toString()
    });
    const data = this.json(response);
    return Object.entries(data || {}).reduce((acc, [key, value]) => {
      acc[key] = normalizeSubmission(value);
      return acc;
    }, {});
  }

  async rejudge(submitId, options = {}) {
    // POST /problem/rejudge/{runId}
    const response = await this.request(rejudgeUrl(submitId, this.baseUrl), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: ''
    });
    return response.data;
  }

  async getContests({ page = 1, status = '', category = 'all', group = '', groupName = '' } = {}, options = {}) {
    // GET /contest/data?draw&start&length&sortDir&sortCol&category&running&title&owner&openness
    // category 由比赛列表页的 data-category 决定：all / mygroup / group / mine / ...
    const scope = CONTEST_CATEGORIES.includes(category) ? category : 'all';
    if (PERSONAL_CONTEST_CATEGORIES.has(scope)) {
      const session = await this.ensureSession();
      // 未登录时 VJudge 会把 category=mygroup 静默退化成全量公开比赛，必须拦在发请求之前
      if (!session.loggedIn) {
        return { contests: [], needsLogin: true, category: scope, group, ...emptyPage(page, PAGE_SIZE) };
      }
    }
    const running = status === 'running' ? '1' : status === 'upcoming' ? '2' : status === 'ended' ? '3' : '0';
    const params = dtParams({
      page, pageSize: PAGE_SIZE, sortCol: 0, sortDir: 'desc',
      category: scope, running, title: '', openness: '-1',
      owner: scope === 'group' ? (groupName || group || '') : ''
    });
    const response = await this.request(this.url(PATHS.contests, params), options);
    const payload = this.json(response);
    const result = listPayload(payload, ['data', 'contests', 'rows', 'records', 'items']);
    let contests = result.items.map(normalizeContest);
    if (status && ['running', 'upcoming', 'ended'].includes(status)) {
      contests = contests.filter((item) => item.status === status);
    }
    // 指定团队时按短名/团队名二次过滤：服务端的 owner 是团队显示名，这里做一次兜底，
    // 只有在上游确实返回了团队信息时才启用，避免误把没有团队字段的公开比赛全部滤掉。
    if (group && scope === 'group') {
      const named = contests.filter((item) => item.groupName || item.groupShortName);
      if (named.length) {
        contests = contests.filter((item) => (
          (item.groupShortName && String(item.groupShortName) === String(group))
          || (item.groupName && String(item.groupName) === String(groupName || group))
        ));
      }
    }
    const paged = pageResult(contests, payload.recordsFiltered ?? payload.recordsTotal ?? result.total, page, PAGE_SIZE);
    return {
      contests: paged.items, total: paged.total, page: paged.page,
      pageSize: paged.pageSize, totalPages: paged.totalPages, category: scope, group
    };
  }

  async getMyGroups(options = {}) {
    // GET /group -> HTML 内嵌 dataJson: { myGroups, newGroupCards, invitationGroups }
    const response = await this.request(this.url(PATHS.groups), options);
    const groups = this.html(response, parseMyGroups);
    this.groups = groups;
    return groups;
  }

  async getGroupDetail(shortName, options = {}) {
    // GET /group/{shortName} -> HTML 内嵌 dataJson: name / memberBriefs / contests
    const name = String(shortName || '').replace(/^\/+/, '');
    if (!name) throw new Error('缺少团队 shortName');
    const response = await this.request(groupUrl(name, this.baseUrl), options);
    return this.html(response, parseGroupDetail, [name]);
  }

  async searchGroups(name, options = {}) {
    // POST /group/search  form: name -> { info, cards: [...] }
    const response = await this.request(groupSearchUrl(this.baseUrl), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ name: String(name || '') }).toString()
    });
    const payload = this.json(response);
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    return { groups: cards.map(normalizeGroup), info: payload.info || '' };
  }

  async getGroupContests(shortName, options = {}) {
    // 便捷方法：以团队显示名作为 owner，只取该团队的比赛
    const groups = this.groups || await this.getMyGroups(options);
    const group = groups.find((item) => item.shortName === shortName || item.name === shortName);
    const groupName = group ? group.name : shortName;
    return this.getContests({ page: 1, category: 'group', group: shortName, groupName }, options);
  }

  async getContestDetail(id, options = {}) {
    // GET /contest/{id} -> HTML，内联 dataJson 含 description、begin/end 与 problems
    const response = await this.request(contestUrl(id, this.baseUrl), options);
    const detail = this.html(response, parseContestDetail, [id]);
    let data;
    try { data = embeddedData(response.data); } catch { data = undefined; }
    // 报名状态来自 participation.currentName（当前参与者名称，用户或团队）；
    // participation 本身是配置对象，不能用 registered 字段或 Boolean(obj) 判断。
    const participation = data && data.participation;
    const registered = Boolean(participation && (participation.currentName || participation.currentTeamId));
    const participationInfo = participation ? {
      enabled: Boolean(participation.enabled),
      canChange: Boolean(participation.canChange),
      currentName: String(participation.currentName || ''),
      currentType: String(participation.currentType || 'user'),
      currentTeamId: String(participation.currentTeamId || '0')
    } : undefined;
    rememberContestProblemIds(this.problemIds, detail.problems);
    rememberProblemDescKeys(this.problemDescKeys, detail.problems);
    try {
      const rankResponse = await this.request(contestRankUrl(id, this.baseUrl), options);
      const rank = rankResponse.data;
      if (rank && typeof rank === 'object') {
        detail.length = safeNumber(rank.length);
        if (!detail.title && rank.title) detail.title = rank.title;
        // 只在页面内联数据缺失时才用榜单补全时间，避免覆盖已解析好的展示文本
        if (!detail.begin && safeNumber(rank.begin)) {
          detail.begin = safeNumber(rank.begin);
          detail.end = detail.begin + safeNumber(rank.length);
          detail.startTime = new Date(detail.begin).toLocaleString('zh-CN');
          detail.endTime = detail.end ? new Date(detail.end).toLocaleString('zh-CN') : '';
        }
        // 从榜单 submissions 聚合当前用户已 AC 的题目，标记到 problems.solved
        await this.applySolvedFromRank(id, detail.problems, rank);
      }
    } catch (error) {
      this.log(`比赛 ${id} 榜单元信息获取失败: ${error.message}`);
    }
    await this.enrichHtml(detail);
    return { ...detail, id: String(id), registered, participation: participationInfo, url: contestUrl(id, this.baseUrl) };
  }

  async getContestProblems(id, options = {}) {
    // 优先读取 /contest/{id} 内联 dataJson 的 problems（含 OJ-编号 与题号 A/B/C），
    // 上游改版时回退到 HTML 中的 /problem/ 链接。
    const response = await this.request(contestUrl(id, this.baseUrl), options);
    const problems = this.html(response, parseContestProblems);
    rememberContestProblemIds(this.problemIds, problems);
    rememberProblemDescKeys(this.problemDescKeys, problems);
    try {
      const rankResponse = await this.request(contestRankUrl(id, this.baseUrl), options);
      if (rankResponse.data && typeof rankResponse.data === 'object') {
        await this.applySolvedFromRank(id, problems, rankResponse.data);
      }
    } catch (error) {
      this.log(`比赛 ${id} 题目状态聚合失败: ${error.message}`);
    }
    return problems;
  }

  // 从榜单 submissions 聚合当前用户已 AC 的题目，写入 problems[i].solved。
  // submissions 行: [userId, problemIndex(0-based, 对应 problems 顺序), success(0/1), timeMs, score, fullScore]
  async applySolvedFromRank(contestId, problems, rank) {
    if (!Array.isArray(problems) || !rank || !Array.isArray(rank.submissions)) return;
    const participants = rank.participants || {};
    // 找当前用户 userId：优先 session 用户名，其次 store 当前用户，按 name/nickname 匹配
    let currentName = this.session && this.session.username;
    if (!currentName && this.store && this.store.getCurrentUser) {
      const current = await this.store.getCurrentUser();
      currentName = current && (current.username || current.nickname);
    }
    let currentUserId;
    if (currentName) {
      const needle = String(currentName).toLowerCase();
      Object.entries(participants).some(([uid, p]) => {
        const value = p || {};
        const names = [value.name, value.userName, value.username, value.nickname].filter(Boolean).map((n) => String(n).toLowerCase());
        if (names.includes(needle)) { currentUserId = String(uid); return true; }
        return false;
      });
    }
    if (!currentUserId) {
      this.contestSolved.set(String(contestId), new Set());
      return;
    }
    const solvedIdx = new Set();
    rank.submissions.forEach((row) => {
      if (Array.isArray(row) && String(row[0]) === currentUserId && safeNumber(row[2]) === 1) {
        solvedIdx.add(safeNumber(row[1]));
      }
    });
    this.contestSolved.set(String(contestId), solvedIdx);
    problems.forEach((problem, index) => {
      problem.solved = solvedIdx.has(index);
    });
  }

  async getContestRank(id, options = {}) {
    // GET /contest/rank/single/{id}
    //   participants: { userId: { type, name, nickname, image, members } }
    //   submissions:  [[userId, problemIndex, success(0/1), timeMs, score, fullScore], ...]
    // 统计并不在 participants 里，必须从 submissions 聚合得出。
    const response = await this.request(contestRankUrl(id, this.baseUrl), options);
    const data = this.json(response);
    const participants = data.participants || {};

    // 按用户聚合：记录成功题目集合、首次成功时间（罚时）与得分。
    const stats = new Map();
    (Array.isArray(data.submissions) ? data.submissions : []).forEach((row) => {
      if (!Array.isArray(row) || row.length < 4) return;
      const userId = String(row[0]);
      const problemIndex = String(row[1]);
      const success = safeNumber(row[2]) === 1;
      const timeMs = safeNumber(row[3]);
      const score = safeNumber(row[4]);
      if (!stats.has(userId)) {
        stats.set(userId, { solvedSet: new Set(), penaltyMs: 0, score: 0, firstSuccess: new Map() });
      }
      const entry = stats.get(userId);
      if (success) {
        if (!entry.firstSuccess.has(problemIndex) || timeMs < entry.firstSuccess.get(problemIndex)) {
          entry.firstSuccess.set(problemIndex, timeMs);
        }
        entry.solvedSet.add(problemIndex);
        entry.score += score;
      }
    });
    // 罚时 = 各题首次成功时间之和（负值表示赛前提交，按 0 计）
    stats.forEach((entry) => {
      entry.firstSuccess.forEach((ms) => { entry.penaltyMs += Math.max(0, ms); });
    });

    const rankings = Object.entries(participants).map(([participantId, participant]) => {
      const value = participant || {};
      const entry = stats.get(String(participantId)) || { solvedSet: new Set(), penaltyMs: 0, score: 0 };
      // 用户名优先用登录名 name，其次 username/userName；昵称用 nickname。
      const username = value.name || value.userName || value.username || value.user || participantId;
      return {
        rank: 0,
        username: String(username),
        nickname: String(value.nickname || ''),
        displayName: String(value.nickname || username),
        avatar: value.image || value.avatar || '',
        participantId: String(participantId),
        userType: value.type || 'user',
        solved: entry.solvedSet.size,
        penalty: entry.penaltyMs,
        penaltyMinutes: Math.round(entry.penaltyMs / 60000),
        score: entry.score,
        problems: entry.firstSuccess ? Object.fromEntries(entry.firstSuccess) : {}
      };
    }).sort((a, b) => (b.solved - a.solved) || (a.penalty - b.penalty) || (b.score - a.score));
    rankings.forEach((item, index) => { item.rank = index + 1; });
    return { contestId: String(id), contestTitle: data.title || '', rankings, submissions: data.submissions || [] };
  }

  async registerContest(id, teamId = '0', options = {}) {
    // POST /contest/{id}/participation  form: teamId（0 = 以个人身份报名）
    // 只有私密比赛才需要 /contest/login/{id} 的访问码，公开报名走 participation。
    const response = await this.request(resolve(this.baseUrl, format(PATHS.contestParticipation, { id })), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ teamId: String(teamId || '0') }).toString()
    });
    const data = response.data;
    if (data && typeof data === 'object' && data.error) {
      throw new Error(data.error.message || data.error.i18nKey || '比赛报名失败');
    }
    return { success: true, registered: true, contestId: String(id), data };
  }

  async getFavorites(options = {}) {
    // GET /problem/data?...&category=favorites
    const params = dtParams({ page: 1, pageSize: 100, sortCol: 6, sortDir: 'desc', category: 'favorites', OJId: 'All' });
    const response = await this.request(this.url(PATHS.problems, params), options);
    const payload = this.json(response);
    const result = listPayload(payload, ['data', 'favorites', 'problems', 'rows', 'items']);
    const favorites = result.items.map(normalizeProblem);
    rememberProblemIds(this.problemIds, favorites);
    return favorites;
  }

  favoriteId(id) {
    const key = String(id);
    return this.problemIds.get(key) || (String(id).includes('-') ? undefined : key) || key;
  }

  async addFavorite(id, options = {}) {
    // POST /problem/{数据库id}/favorite/add
    const favoriteId = this.favoriteId(id);
    const response = await this.request(favoriteUrl(favoriteId, true, this.baseUrl), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: ''
    });
    return this.favoriteResult(response.data, id, true);
  }

  async removeFavorite(id, options = {}) {
    // POST /problem/{数据库id}/favorite/remove
    const favoriteId = this.favoriteId(id);
    const response = await this.request(favoriteUrl(favoriteId, false, this.baseUrl), {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: ''
    });
    return this.favoriteResult(response.data, id, false);
  }

  favoriteResult(data, id, favorite) {
    if (data && typeof data === 'object' && data.error) {
      throw new Error(data.error.message || data.error.i18nKey || '收藏操作失败');
    }
    return { success: true, favorite, id: String(id), data };
  }

  async getUserInfo(username, options = {}) {
    // GET /user/{username} -> HTML 用户资料页
    const name = username || (await this.store.getCurrentUser() || {}).username;
    const response = await this.request(userInfoUrl(name || '', this.baseUrl), options);
    const profile = this.html(response, parseUserProfile, [name]);
    let solvedCount = profile.solvedCount;
    if (!solvedCount) {
      try {
        // GET /user/solveDetail2/{username} -> [[oj, probNum, status], ...]
        const detailResponse = await this.request(
          resolve(this.baseUrl, format('/user/solveDetail2/{username}', { username: name || '' })),
          options
        );
        if (Array.isArray(detailResponse.data)) {
          solvedCount = detailResponse.data.filter((row) => safeNumber(row && row[2]) > 0).length;
        }
      } catch (error) {
        this.log(`用户 ${name} 解题详情获取失败: ${error.message}`);
      }
    }
    return { ...profile, username: profile.username || name, solvedCount: safeNumber(solvedCount) };
  }
}

function resolve(baseUrl, path) {
  return withQuery(path, {}, baseUrl);
}

module.exports = {
  RealClient,
  normalizeProblem,
  normalizeSubmission,
  normalizeContest,
  normalizeVerdict,
  listPayload
};
