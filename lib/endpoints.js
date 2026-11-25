'use strict';

const BASE_URL = 'https://vjudge.net/';

const PATHS = Object.freeze({
  login: '/user/login',
  logout: '/user/logout',
  session: '/user/checkLogInStatus',
  problems: '/problem/data',
  problemDetail: '/problem/{key}',
  problemDescription: '/problem/description/{descKey}',
  problemSubmit: '/problem/submit/{key}',
  submissions: '/status/data',
  submissionById: '/status/dataById',
  rejudge: '/problem/rejudge/{runId}',
  contests: '/contest/data',
  contestDetail: '/contest/{id}',
  contestRank: '/contest/rank/single/{id}',
  contestRankLatest: '/contest/rank/singleLatest/{id}',
  contestLogin: '/contest/login/{id}',
  contestParticipation: '/contest/{id}/participation',
  favoriteAdd: '/problem/{id}/favorite/add',
  favoriteRemove: '/problem/{id}/favorite/remove',
  userInfo: '/user/{username}',
  groups: '/group',
  groupDetail: '/group/{shortName}',
  groupSearch: '/group/search'
});

// /contest/data 的 category 取值来自 VJudge 比赛列表页 data-category 属性。
// all=全部，mygroup=我加入/创建的团队的所有比赛，group=指定团队，mine=我创建的。
const CONTEST_CATEGORIES = Object.freeze([
  'all', 'public', 'mine', 'participation', 'arrangement', 'mygroup',
  'favorites', 'follow', 'group', 'classical', 'practice', 'replay'
]);

function resolveUrl(pathOrUrl, baseUrl = BASE_URL) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(String(pathOrUrl).replace(/^\//, ''), base).toString();
}

function withQuery(pathOrUrl, params = {}, baseUrl = BASE_URL) {
  const url = new URL(resolveUrl(pathOrUrl, baseUrl));
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function format(template, values) {
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (match, key) => (
    values[key] === undefined || values[key] === null ? match : encodeURIComponent(String(values[key]))
  ));
}

// VJudge 所有列表接口均为 DataTables 服务端处理：draw / start / length / sortDir / sortCol
function dtParams({ page = 1, pageSize = 20, sortCol, sortDir = 'desc', ...rest } = {}) {
  const currentPage = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  return {
    draw: currentPage,
    start: (currentPage - 1) * size,
    length: size,
    ...(sortCol === undefined ? {} : { sortCol, sortDir }),
    ...rest
  };
}

// 题目标识：VJudge 采用 "OJ-编号"，例如 HDU-1000
function problemKey(value) {
  const raw = decodeURIComponent(String(value || ''));
  const query = raw.match(/[?&](?:problemId|probNum)=([^&#]+)/i);
  if (query) return query[1];
  const pathMatch = raw.match(/\/problem\/([^/?#]+)/i);
  if (pathMatch) return pathMatch[1];
  return raw;
}

function problemDetailUrl(idOrUrl, baseUrl = BASE_URL) {
  if (/^https?:\/\//i.test(String(idOrUrl))) {
    return String(idOrUrl);
  }
  return resolveUrl(format(PATHS.problemDetail, { key: problemKey(idOrUrl) }), baseUrl);
}

// 题面正文接口：VJudge 题目/比赛题的正文不在详情页 dataJson，
// 而在 /problem/description/{descKey} 返回的 data-json-container 中。
function problemDescriptionUrl(descKey, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.problemDescription, { descKey }), baseUrl);
}

function problemSubmitUrl(problemId, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.problemSubmit, { key: problemKey(problemId) }), baseUrl);
}

function rejudgeUrl(runId, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.rejudge, { runId }), baseUrl);
}

function contestUrl(id, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.contestDetail, { id }), baseUrl);
}

function contestRankUrl(id, baseUrl = BASE_URL, latest = false) {
  return resolveUrl(format(latest ? PATHS.contestRankLatest : PATHS.contestRank, { id }), baseUrl);
}

function favoriteUrl(id, add, baseUrl = BASE_URL) {
  return resolveUrl(format(add ? PATHS.favoriteAdd : PATHS.favoriteRemove, { id }), baseUrl);
}

function userInfoUrl(username, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.userInfo, { username }), baseUrl);
}

function groupUrl(shortName, baseUrl = BASE_URL) {
  return resolveUrl(format(PATHS.groupDetail, { shortName }), baseUrl);
}

function groupSearchUrl(baseUrl = BASE_URL) {
  return resolveUrl(PATHS.groupSearch, baseUrl);
}

module.exports = {
  BASE_URL,
  PATHS,
  CONTEST_CATEGORIES,
  resolveUrl,
  withQuery,
  format,
  dtParams,
  problemKey,
  problemDetailUrl,
  problemDescriptionUrl,
  problemSubmitUrl,
  rejudgeUrl,
  contestUrl,
  contestRankUrl,
  favoriteUrl,
  userInfoUrl,
  groupUrl,
  groupSearchUrl
};
