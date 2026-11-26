'use strict';

const PAGE_SIZE = 8;
const ui = {
  problemId: undefined, language: 'cpp', code: '', contestFilter: '',
  sortKey: 'label', sortDirection: 'asc', rankSortKey: 'rank', rankSortDirection: 'asc',
  page: 1, tab: 'detail', submitting: false
};
let state = { view: 'problem', loading: true, languages: [] };
let api;
let draftTimer;
let filterTimer;
let toastTimer;

function post(message) {
  if (api) api.postMessage(message);
}

function initialize() {
  api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  window.addEventListener('message', (event) => handleMessage(event.data));
  document.addEventListener('click', (event) => onClick(event));
  document.addEventListener('input', (event) => onInput(event));
  document.addEventListener('change', (event) => onChange(event));
  post({ type: 'ready' });
  render();
}

function handleMessage(message) {
  if (!message || !message.type) return;
  switch (message.type) {
    case 'state':
      state = { ...state, ...message };
      if (state.problemId !== ui.problemId) initializeEditorState();
      if (message.activeTab) ui.tab = message.activeTab;
      render();
      return;
    case 'submission':
      state.latestSubmission = message.submission;
      ui.submitting = false;
      setToast(message.submission ? `最新状态: ${message.submission.result || message.submission.status || 'Pending'}` : '暂无提交');
      render();
      return;
    case 'favorite':
      state.favorite = Boolean(message.favorite);
      setToast(state.favorite ? '已加入收藏' : '已取消收藏');
      render();
      return;
    case 'registered':
      state.contest = { ...state.contest, registered: Boolean(message.registered) };
      setToast('已报名比赛');
      render();
      return;
    case 'submitting':
      ui.submitting = true;
      render();
      return;
    case 'submitError':
      ui.submitting = false;
      setToast(message.message || '提交失败');
      render();
      return;
    case 'draftSaved':
      setToast('草稿已保存');
      return;
    case 'copied':
      setToast('已复制到剪贴板');
      return;
    case 'error':
      state.error = message.message;
      render();
      return;
    default:
  }
}

function initializeEditorState() {
  ui.problemId = state.problemId;
  const draft = state.draft || {};
  const language = state.languages && state.languages.length ? state.languages[0].id : 'cpp';
  ui.language = draft.language || language;
  ui.code = draft.code || '';
}

// KaTeX auto-render 会在文本节点中查找公式并替换为排版后的 HTML。
// 每次 DOM 重建后都要重新调用，否则切题/切 tab 后公式会退回纯文本。
function renderMath(root) {
  if (typeof renderMathInElement !== 'function') return;
  root.querySelectorAll('.description').forEach((element) => {
    try {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        // AtCoder 输入格式说明把 \(...\) 写在 <pre> 代码块里，需放行 pre/code
        // 才能让 KaTeX 排版；样例数据块没有分隔符，不会被误渲染。
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'option']
      });
    } catch (error) {
      // 单个题面渲染失败时保留原始公式文本，不影响其他内容。
    }
  });
}

// 图片加载失败时换用 data-fallback 备用地址（扩展宿主侧抓取/内联失败后写入，
// 通常是 VJudge 图片代理），再失败则维持原样显示裂图。
function attachImageFallback(root) {
  root.querySelectorAll('img[data-fallback]').forEach((img) => {
    img.addEventListener('error', () => {
      const fallback = img.getAttribute('data-fallback');
      if (!fallback) return;
      img.removeAttribute('data-fallback');
      if (img.src !== fallback) img.src = fallback;
    });
  });
}

function setHtml(app, html) {
  app.innerHTML = html;
  renderMath(app);
  attachImageFallback(app);
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (state.loading && !hasLoadedData()) {
    setHtml(app, renderState('<div class="spinner"></div>', '正在加载 VJudge 数据…'));
    return;
  }
  if (state.error && !hasLoadedData()) {
    setHtml(app, renderState('', escapeHtml(state.error), 'error-state', 'refresh'));
    return;
  }
  if (state.view === 'problem') setHtml(app, renderProblem());
  else if (state.view === 'contest') setHtml(app, renderContest());
  else setHtml(app, renderUser());
}

function hasLoadedData() {
  if (state.view === 'problem') return Boolean(state.problem);
  if (state.view === 'contest') return Boolean(state.contest);
  return Boolean(state.user);
}

function renderState(icon, text, className = '', action) {
  return `<section class="card state ${className}">
    ${icon}
    <div><p>${text}</p>${action ? `<button data-action="${action}">重试</button>` : ''}</div>
  </section>`;
}

function toolbar(title, subtitle, actions) {
  return `<header class="toolbar">
    <div class="toolbar-main">
      <h1 class="toolbar-title">${escapeHtml(title)}</h1>
      <div class="toolbar-subtitle">${subtitle}</div>
    </div>
    <div class="actions">${actions}</div>
  </header>`;
}

function badge(text, className = '') {
  return `<span class="badge ${className}">${escapeHtml(text)}</span>`;
}

function statusBadge(submission) {
  if (!submission) return badge('暂无提交');
  const result = submission.result || submission.status || 'Pending';
  return badge(result, statusClass(result));
}

function statusClass(result) {
  if (/^AC$|accepted/i.test(result)) return 'ac';
  if (/pending|judging|queued/i.test(result)) return 'pending';
  return 'wa';
}

function renderProblem() {
  const problem = state.problem || {};
  const metadata = [
    problem.oj && `OJ: ${escapeHtml(problem.oj)}`,
    problem.difficulty && `难度: ${escapeHtml(String(problem.difficulty))}`,
    problem.timeLimit && `时间: ${escapeHtml(problem.timeLimit)}`,
    problem.memoryLimit && `内存: ${escapeHtml(problem.memoryLimit)}`
  ].filter(Boolean).join(' · ');
  const actions = [
    `<button class="primary" data-action="submit" ${ui.submitting ? 'disabled' : ''}>${ui.submitting ? '提交中…' : '提交'}</button>`,
    `<button class="favorite ${state.favorite ? 'active' : ''}" data-action="favorite">${state.favorite ? '取消收藏' : '收藏'}</button>`,
    '<button data-action="openBrowser">网页版</button>',
    '<button data-action="refresh">刷新</button>'
  ].join('');
  const samples = (problem.samples || []).map((sample, index) => `<div class="card sample">
    <div class="sample-block">
      <h3>输入</h3>
      <pre>${escapeHtml(sample.input)}</pre>
      <div class="sample-actions">
        <button data-action="copy" data-index="${index}" data-kind="input">复制输入</button>
      </div>
    </div>
    <div class="sample-block">
      <h3>输出</h3>
      <pre>${escapeHtml(sample.output)}</pre>
      <div class="sample-actions">
        <button data-action="copy" data-index="${index}" data-kind="output">复制输出</button>
      </div>
    </div>
  </div>`).join('');
  return `${toolbar(problem.title || state.problemId || '题目详情', `${metadata}${state.mockMode ? ' · ' : ''}${state.mockMode ? badge('Mock 模式', 'mock') : ''}`, actions)}
  <section class="card"><h2>题目描述</h2><div class="description">${problem.html || ''}</div></section>
  ${samples ? `<section class="card samples"><h2>样例</h2>${samples}</section>` : ''}
  <section class="card editor"><div class="editor-header"><h2>代码提交</h2>
    <label for="language">语言</label><select id="language">${languageOptions()}</select></div>
    <textarea id="code" class="code-input" spellcheck="false" aria-label="提交代码">${escapeHtml(ui.code)}</textarea>
  </section>
  <footer class="footer"><span>${escapeHtml(state.user ? state.user.nickname || state.user.username : '未登录')}</span>${statusBadge(state.latestSubmission)}</footer>`;
}

function languageOptions() {
  const languages = state.languages && state.languages.length ? state.languages : [{ id: 'cpp', label: 'C++' }];
  return languages.map((language) => `<option value="${escapeHtml(language.id)}" ${language.id === ui.language ? 'selected' : ''}>${escapeHtml(language.label || language.id)}</option>`).join('');
}

function renderContest() {
  const contest = state.contest || {};
  const subtitle = [contest.status && escapeHtml(contest.status), contest.startTime && `开始: ${escapeHtml(contest.startTime)}`,
    contest.endTime && `结束: ${escapeHtml(contest.endTime)}`, state.mockMode ? badge('Mock 模式', 'mock') : ''].filter(Boolean).join(' · ');
  const actions = [
    '<button data-action="refresh">刷新</button>',
    '<button data-action="openBrowser">网页版</button>',
    contest.status === 'upcoming' ? `<button class="primary" data-action="register" ${contest.registered ? 'disabled' : ''}>${contest.registered ? '已报名' : '报名'}</button>` : ''
  ].join('');
  const tabs = `<nav class="tabs" role="tablist">
    <button data-action="tab" data-tab="detail" aria-selected="${ui.tab === 'detail'}">详情</button>
    <button data-action="tab" data-tab="problems" aria-selected="${ui.tab === 'problems'}">题目</button>
    <button data-action="tab" data-tab="rank" aria-selected="${ui.tab === 'rank'}">榜单</button>
  </nav>`;
  let content;
  if (ui.tab === 'detail') {
    content = `<section class="card"><div class="description">${contest.html || ''}</div></section>`;
  } else if (ui.tab === 'problems') {
    content = renderContestProblems();
  } else {
    content = renderContestRank();
  }
  return `${toolbar(contest.title || state.contestId || '比赛详情', subtitle, actions)}${tabs}${content}
  <footer class="footer"><span>${escapeHtml(state.user ? state.user.nickname || state.user.username : '未登录')}</span>${badge(contest.registered ? '已报名' : '未报名')}</footer>`;
}

function renderContestProblems() {
  const filtered = filterProblems(state.problems || [], ui.contestFilter);
  const sorted = sortItems(filtered, ui.sortKey, ui.sortDirection);
  const paged = paginate(sorted, ui.page, PAGE_SIZE);
  const headers = [
    ['label', '编号'], ['id', '题号'], ['title', '标题'], ['difficulty', '难度'], ['solved', '状态']
  ].map(([key, label]) => `<th><button data-action="sort" data-key="${key}">${label}${ui.sortKey === key ? (ui.sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`).join('');
  const rows = paged.map((problem) => `<tr>
    <td>${escapeHtml(problem.label || '')}</td><td>${escapeHtml(problem.id)}</td>
    <td>${escapeHtml(problem.title)}</td><td>${escapeHtml(String(problem.difficulty ?? '-'))}</td>
    <td>${badge(problem.solved ? 'AC' : '未解决', problem.solved ? 'ac' : '')}</td>
    <td class="button-cell"><button data-action="openProblem" data-problem="${escapeHtml(problem.id)}">打开</button></td>
  </tr>`).join('');
  return `<section class="card">
    <div class="editor-header"><h2>比赛题目</h2><input id="contest-filter" class="filter" value="${escapeHtml(ui.contestFilter)}" placeholder="搜索题号或标题"></div>
    <div class="table-wrap"><table><thead><tr>${headers}<th class="button-cell"></th></tr></thead><tbody>${rows || '<tr><td colspan="6">暂无题目</td></tr>'}</tbody></table></div>
    ${pagination(sorted)}
  </section>`;
}

function renderContestRank() {
  const rankings = (state.rank && (state.rank.rankings || state.rank.rows)) || [];
  const sorted = sortItems(rankings, ui.rankSortKey, ui.rankSortDirection);
  const penaltyText = (item) => {
    const minutes = item.penaltyMinutes;
    if (typeof minutes === 'number') return String(minutes);
    return String(item.penalty ?? '-');
  };
  const rows = sorted.map((item) => `<tr>
    <td>${escapeHtml(String(item.rank ?? '-'))}</td>
    <td>${escapeHtml(item.nickname || item.displayName || item.username || '')}</td>
    <td>${escapeHtml(String(item.solved ?? '-'))}</td><td>${escapeHtml(penaltyText(item))}</td>
    <td>${escapeHtml(String(item.score ?? '-'))}</td>
  </tr>`).join('');
  return `<section class="card"><h2>榜单</h2><div class="table-wrap"><table>
    <thead><tr><th><button data-action="rankSort" data-key="rank">排名</button></th>
    <th>用户</th><th><button data-action="rankSort" data-key="solved">解题</button></th>
    <th><button data-action="rankSort" data-key="penalty">罚时</button></th><th>得分</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">暂无榜单数据</td></tr>'}</tbody>
  </table></div></section>`;
}

function renderUser() {
  const user = state.user || {};
  const name = user.nickname || user.username || '?';
  const initial = name.slice(0, 1).toUpperCase();
  const avatarSrc = user.avatar || user.avatarUrl || '';
  const avatar = avatarSrc
    ? `<img class="avatar-img" src="${escapeHtml(avatarSrc)}" alt="" referrerpolicy="no-referrer">`
    : escapeHtml(initial);
  const secondary = user.displayName && user.displayName !== (user.username || '')
    ? user.displayName : (user.username || '');
  const stats = [
    ['解题数', user.solvedCount ?? user.solved ?? 0], ['尝试数', user.attemptedCount ?? '-'],
    ['通过率', user.acceptRate || '-'], ['排名', user.rank ?? '-']
  ];
  const facts = (user.facts || []).map((fact) => `<div class="profile-fact-item"><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join('');
  return `${toolbar(user.nickname || user.username || '用户信息', escapeHtml(user.username || state.username || ''), '<button data-action="refresh">刷新</button><button data-action="openBrowser">网页版</button>')}
  <section class="card profile"><div class="avatar">${avatar}</div>
    <div><h2 class="profile-name">${escapeHtml(user.nickname || user.username || '未知用户')}</h2>
    <div class="metadata">${secondary ? `<span>${escapeHtml(secondary)}</span>` : ''}${state.mockMode ? badge('Mock 模式', 'mock') : ''}</div></div>
  </section>
  ${facts ? `<section class="card"><dl class="facts-grid">${facts}</dl></section>` : ''}
  <section class="card stats">${stats.map(([label, value]) => `<div class="stat"><div class="stat-value">${escapeHtml(String(value))}</div><div class="stat-label">${label}</div></div>`).join('')}</section>`;
}

function pagination(items) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  return `<div class="pagination">
    <button data-action="page" data-page="${ui.page - 1}" ${ui.page <= 1 ? 'disabled' : ''}>上一页</button>
    <span>${ui.page} / ${totalPages} · 共 ${items.length} 题</span>
    <button data-action="page" data-page="${ui.page + 1}" ${ui.page >= totalPages ? 'disabled' : ''}>下一页</button>
  </div>`;
}

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'submit') post({ type: 'submit', data: { language: ui.language, code: ui.code } });
  if (action === 'favorite') post({ type: 'favorite', data: { favorite: !state.favorite } });
  if (action === 'refresh') post({ type: 'refresh' });
  if (action === 'openBrowser') post({ type: 'openBrowser' });
  if (action === 'register') post({ type: 'register' });
  if (action === 'tab') { ui.tab = target.dataset.tab; post({ type: 'tab', data: ui.tab }); render(); }
  if (action === 'openProblem') post({ type: 'openProblem', data: target.dataset.problem });
  if (action === 'sort') { toggleSort(target.dataset.key, 'sortKey', 'sortDirection'); render(); }
  if (action === 'rankSort') { toggleSort(target.dataset.key, 'rankSortKey', 'rankSortDirection'); render(); }
  if (action === 'page') { ui.page = Number(target.dataset.page); render(); }
  if (action === 'copy') copySample(Number(target.dataset.index), target.dataset.kind);
}

function toggleSort(key, keyField, directionField) {
  if (ui[keyField] === key) ui[directionField] = ui[directionField] === 'asc' ? 'desc' : 'asc';
  else { ui[keyField] = key; ui[directionField] = 'asc'; }
  ui.page = 1;
}

function copySample(index, kind) {
  const sample = state.problem && state.problem.samples && state.problem.samples[index];
  if (!sample) return;
  post({ type: 'copy', data: { text: kind === 'output' ? sample.output : sample.input, sample: index, kind } });
}

function onInput(event) {
  if (event.target.id === 'code') {
    ui.code = event.target.value;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => post({ type: 'saveDraft', data: { language: ui.language, code: ui.code } }), 500);
  }
  if (event.target.id === 'contest-filter') {
    clearTimeout(filterTimer);
    const value = event.target.value;
    filterTimer = setTimeout(() => {
      ui.contestFilter = value;
      ui.page = 1;
      render();
    }, 250);
  }
}

function onChange(event) {
  if (event.target.id === 'language') ui.language = event.target.value;
}

function setToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function filterProblems(items, query) {
  const keyword = String(query || '').trim().toLowerCase();
  if (!keyword) return (items || []).slice();
  return (items || []).filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(keyword));
}

function sortItems(items, key, direction = 'asc') {
  return (items || []).slice().sort((left, right) => {
    const a = left[key]; const b = right[key];
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;
    const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'zh-CN');
    return direction === 'desc' ? -result : result;
  });
}

function paginate(items, page = 1, size = PAGE_SIZE) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (items || []).slice((currentPage - 1) * size, currentPage * size);
}

if (typeof document !== 'undefined' && document.getElementById('app')) initialize();

if (typeof module !== 'undefined') {
  module.exports = { escapeHtml, filterProblems, sortItems, paginate, statusClass, statusBadge, renderMath };
}
