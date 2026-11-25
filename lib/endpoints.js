'use strict';

const BASE_URL = 'https://vjudge.net/';

const PATHS = Object.freeze({
  login: '/user/login',
  logout: '/user/logout',
  session: '/user/checkLogInStatus',
  problems: '/problem/data',
  problemDetail: '/problem/{key}',
  problemSubmit: '/problem/submit/{key}',
  submissions: '/status/data',
  submissionById: '/status/dataById',
  rejudge: '/problem/rejudge/{runId}',
  contests: '/contest/data',
  contestDetail: '/contest/{id}',
  contestRank: '/contest/rank/single/{id}',
  contestRankLatest: '/contest/rank/singleLatest/{id}',
  contestLogin: '/contest/login/{id}',
  favoriteAdd: '/problem/{id}/favorite/add',
  favoriteRemove: '/problem/{id}/favorite/remove',
  userInfo: '/user/{username}'
});

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

module.exports = {
  BASE_URL,
  PATHS,
  resolveUrl,
  withQuery,
  format,
  dtParams,
  problemKey,
  problemDetailUrl,
  problemSubmitUrl,
  rejudgeUrl,
  contestUrl,
  contestRankUrl,
  favoriteUrl,
  userInfoUrl
};
