'use strict';

const BASE_URL = 'https://vjudge.net/';

const PATHS = Object.freeze({
  login: '/user/login',
  logout: '/user/logout',
  session: '/user/current',
  problems: '/problem/list',
  problemDetail: '/problem/detail',
  submit: '/problem/submit',
  submissions: '/solution/data',
  rejudge: '/solution/rejudge',
  contests: '/contest/list',
  contestDetail: '/contest/detail',
  contestProblems: '/contest/problems',
  contestRank: '/contest/rank',
  contestRegister: '/contest/register',
  favorites: '/favorite/list',
  favoriteAdd: '/favorite/add',
  favoriteRemove: '/favorite/remove',
  userInfo: '/user/info'
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

function problemDetailUrl(idOrUrl, baseUrl = BASE_URL) {
  if (/^https?:\/\//i.test(String(idOrUrl))) {
    return String(idOrUrl);
  }
  return withQuery(PATHS.problemDetail, { problemId: idOrUrl }, baseUrl);
}

function contestUrl(path, id, baseUrl = BASE_URL, extra = {}) {
  return withQuery(path, { contestId: id, ...extra }, baseUrl);
}

module.exports = {
  BASE_URL,
  PATHS,
  resolveUrl,
  withQuery,
  problemDetailUrl,
  contestUrl
};
