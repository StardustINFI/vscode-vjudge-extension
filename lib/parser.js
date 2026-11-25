'use strict';

const { BASE_URL, resolveUrl, groupUrl, problemDetailUrl } = require('./endpoints');

class ParseError extends Error {
  constructor(message, raw = '') {
    super(message);
    this.name = 'ParseError';
    this.raw = String(raw);
  }
}

function decodeEntities(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[entity.toLowerCase()] || match;
  });
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
    .trim());
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeProblemHtml(html, baseUrl = BASE_URL) {
  let clean = String(html || '');
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  clean = clean.replace(/<script\b[^>]*\/?\s*>/gi, '');
  clean = clean.replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, '');
  clean = clean.replace(/<(?:iframe|object|embed|base)\b[^>]*\/?\s*>/gi, '');
  clean = clean.replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/(\s+(?:href|src|formaction)\s*=\s*)(["']?)\s*javascript:[\s\S]*?\2/gi, '$1$2#$2');
  clean = clean.replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi, '');
  return `<base href="${escapeAttribute(resolveUrl(baseUrl))}">${clean}`;
}

function extractContainer(html, names) {
  const source = String(html || '');
  const opening = /<(div|article|section|main)\b[^>]*>/gi;
  let match;
  while ((match = opening.exec(source))) {
    const tag = match[1];
    const attributes = match[0];
    const idOrClass = attributes.match(/\s(?:id|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const tokens = idOrClass ? (idOrClass[1] || idOrClass[2] || idOrClass[3] || '').split(/\s+/) : [];
    if (!tokens.some((token) => names.includes(token.toLowerCase()))) {
      continue;
    }
    const contentStart = opening.lastIndex;
    const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    tags.lastIndex = contentStart;
    let depth = 1;
    let nested;
    while ((nested = tags.exec(source))) {
      if (/^<\//.test(nested[0])) {
        depth -= 1;
      } else if (!/\/>$/.test(nested[0])) {
        depth += 1;
      }
      if (depth === 0) {
        return source.slice(contentStart, nested.index);
      }
    }
  }
  return undefined;
}

function bodyHtml(html) {
  const body = String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return body ? body[1] : String(html || '');
}

function pageTitle(html) {
  const heading = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const title = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return stripHtml(heading ? heading[1] : title ? title[1] : '');
}

function extractSamples(html) {
  const blocks = [];
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi;
  let match;
  while ((match = pre.exec(String(html || '')))) {
    blocks.push(stripHtml(match[1]));
  }
  const samples = [];
  for (let index = 0; index < blocks.length; index += 2) {
    samples.push({ input: blocks[index], output: blocks[index + 1] || '' });
  }
  return samples;
}

function parseProblemDetail(html, idOrUrl = '') {
  if (typeof html !== 'string' || !html.trim()) {
    throw new ParseError('题目详情响应为空', html);
  }
  const content = extractContainer(html, [
    'problem-description', 'problem-content', 'problem-detail', 'problem-body',
    'problem-statement', 'description', 'content'
  ]) || bodyHtml(html);
  if (!stripHtml(content) && !/<(?:img|pre|table)\b/i.test(content)) {
    throw new ParseError('未找到题目正文', html);
  }
  return {
    id: String(idOrUrl),
    title: pageTitle(html),
    html: sanitizeProblemHtml(content),
    samples: extractSamples(content),
    sourceUrl: /^https?:\/\//i.test(String(idOrUrl)) ? String(idOrUrl) : resolveUrl(BASE_URL)
  };
}

function linkDetails(anchor) {
  const href = anchor.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const text = anchor.match(/>([\s\S]*?)<\/a\s*>/i);
  return {
    href: decodeEntities(href ? href[1] || href[2] || href[3] || '' : ''),
    title: stripHtml(text ? text[1] : '')
  };
}

function contestIdFromHref(href) {
  const match = String(href).match(/\/contest\/(\d+)(?:[/?#]|$)/i)
    || String(href).match(/[?&]contestId=(\d+)/i);
  return match ? match[1] : undefined;
}

function contestStatus(text) {
  if (/进行中|\brunning\b|\bstarted\b/i.test(text)) return 'running';
  if (/未开始|即将开始|\bupcoming\b|\bpending\b/i.test(text)) return 'upcoming';
  if (/已结束|\bended\b|\bfinished\b/i.test(text)) return 'ended';
  return 'unknown';
}

function parseContests(html) {
  if (typeof html !== 'string') {
    throw new ParseError('比赛列表不是 HTML', html);
  }
  const contests = [];
  const seen = new Set();
  const rows = String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) || [];
  rows.forEach((row) => {
    const anchor = row.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/i);
    if (!anchor) return;
    const link = linkDetails(anchor[0]);
    const id = contestIdFromHref(link.href);
    if (!id || seen.has(id)) return;
    const cells = (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]\s*>/gi) || []).map(stripHtml);
    seen.add(id);
    contests.push({
      id,
      title: link.title || cells[1] || `Contest ${id}`,
      url: resolveUrl(link.href),
      status: contestStatus(row),
      startTime: cells.find((cell) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell)) || '',
      endTime: cells.filter((cell) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell))[1] || '',
      columns: cells
    });
  });
  return contests;
}

function parseContestDetail(html, id) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new ParseError('比赛详情响应为空', html);
  }
  // /contest/{id} 把完整信息放在 <textarea name="dataJson"> 中，优先用它
  const embedded = parseContestData(html, id);
  const content = (embedded && embedded.description)
    || extractContainer(html, ['contest-detail', 'contest-description', 'description', 'content'])
    || bodyHtml(html);
  const status = embedded
    ? (embedded.ended ? 'ended' : embedded.started ? 'running' : 'upcoming')
    : contestStatus(content);
  return {
    id: String((embedded && embedded.id) || id),
    title: (embedded && embedded.title) || pageTitle(html),
    html: sanitizeProblemHtml(content),
    status,
    begin: embedded ? embedded.begin : 0,
    end: embedded ? embedded.end : 0,
    startTime: embedded && embedded.begin ? new Date(embedded.begin).toLocaleString('zh-CN') : '',
    endTime: embedded && embedded.end ? new Date(embedded.end).toLocaleString('zh-CN') : '',
    managerName: embedded ? embedded.managerName : '',
    fav: embedded ? embedded.fav : false,
    problems: embedded ? embedded.problems : []
  };
}

// 解析用户资料页：真实页面含 #user_avatar、.profile-username、.profile-stat-strip
function parseUserProfile(html, username = '') {
  if (typeof html !== 'string' || !html.trim()) {
    throw new ParseError('用户资料响应为空', html);
  }
  const source = String(html);
  const avatarMatch = source.match(/<img\b[^>]*id=["']user_avatar["'][^>]*>/i)
    || source.match(/<img\b[^>]*class=["'][^"']*avatar[^"']*["'][^>]*>/i);
  const avatarUrl = avatarMatch ? (avatarMatch[0].match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || [])[1] || '' : '';
  const nameMatch = source.match(/<[^>]*class=["'][^"']*profile-username[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const nickname = nameMatch ? stripHtml(nameMatch[1]) : (titleMatch ? stripHtml(titleMatch[1]).replace(/\s*[-–|]\s*Virtual Judge.*$/i, '').trim() : '');

  // 解题数：从 .profile-stat-strip.problem-solve 或包含 "Solved" 的统计块提取
  let solvedCount = 0;
  const statMatch = source.match(/<[^>]*class=["'][^"']*problem-solve[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|dl|section)\s*>/i)
    || source.match(/([\s\S]{0,200}Solved[\s\S]{0,200})/i);
  if (statMatch) {
    const numbers = stripHtml(statMatch[1]).match(/\d[\d,]*/g);
    if (numbers && numbers.length) solvedCount = Number(numbers[0].replace(/,/g, ''));
  }
  return {
    username: nickname || username,
    nickname: nickname || username,
    avatar: avatarUrl ? decodeEntities(avatarUrl) : '',
    avatarUrl: avatarUrl ? decodeEntities(avatarUrl) : '',
    solvedCount,
    submissionCount: 0,
    acceptRate: '',
    rank: 0
  };
}

function problemIdFromHref(href) {
  const value = String(href);
  const match = value.match(/[?&]problemId=([^&#/]+)/i)
    || value.match(/\/problem\/([^/?&#]+)(?:[/?#]|$)/i);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function parseProblemLinks(html) {
  if (typeof html !== 'string') {
    throw new ParseError('题目列表不是 HTML', html);
  }
  const problems = [];
  const seen = new Set();
  const anchors = String(html).match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) || [];
  anchors.forEach((anchor) => {
    const link = linkDetails(anchor);
    const id = problemIdFromHref(link.href);
    if (!id || seen.has(id)) return;
    seen.add(id);
    problems.push({ id, title: link.title || id, url: resolveUrl(link.href) });
  });
  return problems;
}

// ---------------------------------------------------------------------------
// 团队(group) 与比赛页面的内联数据
// VJudge 把初始数据放在 <textarea name="dataJson"> 里，比从渲染后的 HTML
// 正则抓取更稳定：/group、/group/{shortName}、/contest/{id} 都采用这一形式。
// ---------------------------------------------------------------------------

function embeddedData(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new ParseError('页面响应为空', html);
  }
  const match = String(html).match(/<textarea\b[^>]*name=["']dataJson["'][^>]*>([\s\S]*?)<\/textarea\s*>/i);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(decodeEntities(match[1].trim()));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch (error) {
    throw new ParseError(`页面内联数据解析失败: ${error.message}`, html);
  }
}

// 团队卡片 myRole：0=非成员，1=管理员，2=负责人（创建者）
const GROUP_ROLES = Object.freeze({ 0: '访客', 1: '管理员', 2: '负责人' });

function normalizeGroup(item) {
  const value = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
  const role = Number(value.myRole) || 0;
  const shortName = String(value.shortName || value.short || '');
  return {
    ...value,
    id: String(value.id ?? ''),
    shortName,
    name: String(value.name || shortName || ''),
    brief: String(value.brief || ''),
    leaderName: String(value.leaderName || ''),
    members: Number(value.members ?? value.memberCount) || 0,
    myRole: role,
    roleLabel: GROUP_ROLES[role] || (role > 0 ? '成员' : '访客'),
    isPublic: Boolean(value.isPublic ?? value.pblc),
    logoUrl: String(value.logoUrl || ''),
    scheduledContests: Number(value.scheduledContests) || 0,
    runningContests: Number(value.runningContests) || 0,
    endedContests: Number(value.endedContests) || 0,
    summaryContestId: value.summaryContestId ?? '',
    url: groupUrl(shortName || value.id || '')
  };
}

// GET /group -> { myGroups: [...], newGroupCards: [...], invitationGroups: [...] }
function parseMyGroups(html) {
  const data = embeddedData(html);
  if (!data) throw new ParseError('未找到团队列表数据', html);
  const groups = Array.isArray(data.myGroups) ? data.myGroups : [];
  return groups.map(normalizeGroup).filter((group) => group.shortName || group.id);
}

// GET /group/{shortName} -> { id, shortName, name, brief, pblc, memberBriefs, contests, intro }
function parseGroupDetail(html, shortName = '') {
  const data = embeddedData(html);
  if (!data) throw new ParseError('未找到团队详情数据', html);
  const group = normalizeGroup({ ...data, shortName: data.shortName || shortName, isPublic: data.pblc });
  const memberBriefs = (Array.isArray(data.memberBriefs) ? data.memberBriefs : []).map((member) => {
    const value = member || {};
    return {
      id: String(value.id ?? value.userId ?? ''),
      username: String(value.username || ''),
      nickName: String(value.nickName || value.username || ''),
      role: Number(value.role) || 0,
      joinTime: Number(value.joinTime) || 0
    };
  });
  // 团队详情里的 contests 是数组行：[id, title, ?, begin, end, ...]，字段含义上游未文档化，
  // 只取确定可用的前几列，其余保留在 raw 中。
  const contests = (Array.isArray(data.contests) ? data.contests : []).map((row) => (
    Array.isArray(row)
      ? { id: String(row[0] ?? ''), title: String(row[1] ?? ''), begin: Number(row[3]) || 0,
          end: Number(row[4]) || 0, raw: row }
      : { id: String(row.id ?? row.contestId ?? ''), title: String(row.title ?? ''),
          begin: Number(row.begin) || 0, end: Number(row.end) || 0, raw: row }
  ));
  return {
    ...group,
    secretId: String(data.secretId || ''),
    joinPolicy: Number(data.joinPolicy) || 0,
    arrangeContestPolicy: Number(data.arrangeContestPolicy) || 0,
    intro: data.intro || { format: 'MD', content: '' },
    memberBriefs,
    contests
  };
}

// GET /contest/{id} 的内联 dataJson：包含 description 与完整的 problems 数组
function parseContestData(html, id = '') {
  const data = embeddedData(html);
  if (!data) return undefined;
  const problems = (Array.isArray(data.problems) ? data.problems : [])
    .map((item, index) => normalizeContestProblem(item, index));
  const description = data.description && typeof data.description.content === 'string'
    ? data.description.content : '';
  return {
    id: String(data.id ?? id),
    title: String(data.title || ''),
    type: Number(data.type) || 0,
    openness: Number(data.openness) || 0,
    begin: Number(data.begin) || 0,
    end: Number(data.end) || 0,
    started: Boolean(data.started),
    ended: Boolean(data.ended),
    managerName: String(data.managerName || ''),
    groupOwned: Boolean(data.groupOwned),
    fav: Boolean(data.fav),
    description,
    problems,
    raw: data
  };
}

// 比赛题目：pid 是数据库 id，oj + probNum 组成 VJudge 的 "OJ-编号"，num 是比赛内题号 A/B/C
function normalizeContestProblem(item, index = 0) {
  const value = (item && typeof item === 'object') ? item : {};
  const oj = String(value.oj || '');
  const probNum = String(value.probNum ?? '');
  const key = [oj, probNum].filter(Boolean).join('-');
  return {
    ...value,
    id: key || String(value.pid ?? index),
    key,
    dbId: String(value.pid ?? ''),
    oj,
    probNum,
    label: String(value.num || String.fromCharCode(65 + (index % 26))),
    title: String(value.title || key || ''),
    difficulty: value.difficulty ?? '',
    solved: Boolean(value.solved || value.ac),
    status: value.status || 'UNSOLVED',
    url: key ? problemDetailUrl(key) : ''
  };
}

// 优先使用内联 dataJson 的 problems；上游改版时回退到 HTML 中的 /problem/ 链接
function parseContestProblems(html) {
  const data = parseContestData(html);
  if (data && data.problems.length) return data.problems;
  if (typeof html !== 'string') {
    throw new ParseError('比赛题目列表不是 HTML', html);
  }
  const links = parseProblemLinks(html);
  return links.map((item, index) => {
    const normalized = normalizeContestProblem({
      ...item,
      num: item.num || item.label || String.fromCharCode(65 + (index % 26))
    }, index);
    // 回退路径拿到的是 /problem/ 链接里的 OJ-编号，必须保留，不能被 pid 覆盖
    return {
      ...normalized,
      id: item.id || normalized.id,
      key: item.id || normalized.key,
      title: normalized.title || item.title || item.id,
      url: item.url || (item.id ? problemDetailUrl(item.id) : '')
    };
  });
}

module.exports = {
  ParseError,
  decodeEntities,
  stripHtml,
  sanitizeProblemHtml,
  parseProblemDetail,
  parseContests,
  parseContestDetail,
  parseProblemLinks,
  parseUserProfile,
  extractSamples,
  embeddedData,
  GROUP_ROLES,
  normalizeGroup,
  parseMyGroups,
  parseGroupDetail,
  parseContestData,
  normalizeContestProblem,
  parseContestProblems
};
