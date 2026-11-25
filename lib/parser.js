'use strict';

const { BASE_URL, resolveUrl } = require('./endpoints');

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
    'problem-description', 'problem-content', 'problem-detail', 'description', 'content'
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
  const content = extractContainer(html, ['contest-detail', 'contest-description', 'description', 'content'])
    || bodyHtml(html);
  return {
    id: String(id),
    title: pageTitle(html),
    html: sanitizeProblemHtml(content),
    status: contestStatus(content)
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

module.exports = {
  ParseError,
  decodeEntities,
  stripHtml,
  sanitizeProblemHtml,
  parseProblemDetail,
  parseContests,
  parseContestDetail,
  parseProblemLinks,
  extractSamples
};
