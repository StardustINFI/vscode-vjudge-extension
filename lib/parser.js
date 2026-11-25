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

// 把内嵌 JSON 从一段 HTML 中解析出来。data-json-container 是题面正文接口
// /problem/description/{descKey} 使用的 class；dataJson 是页面级内联数据。
function embeddedJsonByClass(html, className) {
  const escaped = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<textarea\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/textarea\\s*>`, 'i');
  const match = String(html || '').match(pattern);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(decodeEntities(match[1].trim()));
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch (error) {
    throw new ParseError(`内联数据解析失败: ${error.message}`, html);
  }
}

// 极简 Markdown -> HTML（零依赖）。题面正文里以标题、加粗、列表、代码块、
// 行内代码和数学公式为主。LaTeX 片段先隔离再还原，避免 Markdown 的 * 与
// HTML 实体转义破坏公式；还原后由 Webview 中的 KaTeX 负责排版。
function escapeMathText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtml(text) {
  const mathBlocks = [];
  // 只保护独占整行的行间公式；行内的 $（例如折叠框标题）交给 inlineMarkdown，
  // 否则会把容器起始行拆断，导致 ::: 折叠框无法识别。
  let source = String(text || '').replace(/^[ \t]*\$\$[\s\S]*?\$\$[ \t]*$/gm, (block) => {
    mathBlocks.push(escapeMathText(block.trim()));
    return `\u0002${mathBlocks.length - 1}\u0002`;
  });
  // 图片/链接的 ]( 与 URL、闭合 ) 被换行拆开时收拢成一行，
  // 避免块解析按行处理时把链接截断成纯文本。
  source = source.replace(/\]\([ \t]*[\r\n]+[ \t]*/g, '](');
  source = source.replace(/\]\(([^)\r\n]+)[\r\n]+[ \t]*\)/g, ']($1)');
  // VJudge 折叠标记 [open:N]/[end:N] 不属于正文，直接剥掉。
  source = source.replace(/\[(?:open|end):\d+\]\s*/g, '');
  return parseBlocks(source.split(/\r?\n/))
    .replace(/\u0002(\d+)\u0002/g, (_, index) => mathBlocks[Number(index)]);
}

function inlineMarkdown(text) {
  const store = [];
  const keep = (html) => {
    store.push(html);
    return `\u0003${store.length - 1}\u0003`;
  };
  let value = String(text || '');
  // VJudge 折叠标记 [open:N]/[end:N] 只是折叠区域锚点，正文里不应显示。
  value = value.replace(/\[(?:open|end):\d+\]\s*/g, '');
  // 先保护公式（含折叠框标题里的 $$...$$）、转义字符、行内代码与链接，
  // 避免后续 Markdown 符号和 HTML 实体转义破坏 LaTeX 或 URL。
  value = value.replace(/\$\$[^$]*\$\$|\$[^$\r\n]*\$/g, (fragment) => keep(escapeMathText(fragment)));
  value = value.replace(/\\(.)/g, (_, ch) => keep(escapeHtmlLite(ch)));
  value = value.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtmlLite(code)}</code>`));
  // 自动链接先于 HTML 标签保护，避免 <https://...> 被当成标签吞掉。
  value = value.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi,
    (_, url) => keep(`<a href="${safeUrl(url)}">${escapeHtmlLite(url)}</a>`));
  // 保留 HTML 标签本身（VJudge 题面常有 HTML/Markdown 混排），
  // 避免 <p>/<b> 等被转义成可见文本。
  value = value.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\/?>/g, (tag) => keep(tag));
  // 图片/链接地址支持 <url> 形式与含一层括号的 URL，避免正则在第一个 ) 处截断。
  // 图片额外支持洛谷/VJudge 尺寸后缀 =宽x高（像素或百分比，任一可空），
  // 与 VJudge 前端 markdown-it 图片规则一致，输出 width/height 属性。
  const linkTarget = String.raw`(\s*(?:<([^<>]+)>|((?:[^()\s]|\([^()]*\))+))(?:\s+["']([^"']*)["'])?\s*\))`;
  const imgTarget = String.raw`(\s*(?:<([^<>]+)>|((?:[^()\s]|\([^()]*\))+))(?:\s+["']([^"']*)["'])?(?:\s+=\s*(\d*%?)x(\d*%?))?\s*\))`;
  value = value.replace(new RegExp(String.raw`!\[([^\]]*)\]\(` + imgTarget), (match, alt, _whole, angleUrl, plainUrl, title, width, height) => {
    const url = angleUrl || plainUrl;
    const size = `${width ? ` width="${escapeAttribute(width)}"` : ''}${height ? ` height="${escapeAttribute(height)}"` : ''}`;
    return keep(`<img src="${safeUrl(url)}" alt="${escapeAttribute(alt || '')}"${title ? ` title="${escapeAttribute(title)}"` : ''}${size} referrerpolicy="no-referrer">`);
  });
  value = value.replace(new RegExp(String.raw`\[([^\]]+)\]\(` + linkTarget), (match, label, _whole, angleUrl, plainUrl, title) => {
    const url = angleUrl || plainUrl;
    return keep(`<a href="${safeUrl(url)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${label}</a>`);
  });
  value = escapeHtmlLite(value);
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  value = value.replace(/_([^_]+)_/g, '<em>$1</em>');
  return value.replace(/\u0003(\d+)\u0003/g, (_, index) => store[Number(index)]);
}

function escapeHtmlLite(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 链接/图片地址只允许常见安全协议，其余一律降级为 #。
// 协议相对地址（//host/...）升级为 https；洛谷图床旧 http 链接统一升级 https。
function safeUrl(value) {
  let url = decodeEntities(String(value || '').trim());
  if (/^\s*(?:javascript|vbscript|data|file):/i.test(url)) return '#';
  if (/^\/\//.test(url)) url = `https:${url}`;
  if (/^http:\/\/(?:cdn\.|www\.)?luogu\.com\.cn\//i.test(url)) url = `https://${url.slice(7)}`;
  return escapeAttribute(url);
}

const FOLD_KINDS = ['info', 'success', 'warning', 'error'];

function isContainerKind(kind) {
  const value = String(kind || '').toLowerCase();
  return FOLD_KINDS.includes(value) || value === 'align' || value === 'epigraph';
}

function splitTableRow(line) {
  return String(line).trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTableAlign(line) {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return left ? 'left' : '';
  });
}

// 洛谷表格合并：^ 向上合并单元格，< 向左合并单元格。
function renderTable(header, aligns, rows, tuack) {
  const grid = [header, ...rows].map((row) => row.map((content) => ({ content, rowspan: 1, colspan: 1, skip: false })));
  const findCell = (row, col) => {
    let r = row;
    let c = col;
    while (r >= 0 && c >= 0 && grid[r] && grid[r][c] && grid[r][c].skip) {
      if (c > 0) c -= 1; else r -= 1;
    }
    return grid[r] && grid[r][c];
  };
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.skip) return;
      const text = cell.content.trim();
      if (text === '^' && r > 0) {
        const target = findCell(r - 1, c);
        if (target) { target.rowspan += 1; cell.skip = true; }
      } else if (text === '<' && c > 0) {
        const target = findCell(r, c - 1);
        if (target) { target.colspan += 1; cell.skip = true; }
      }
    });
  });
  const renderRow = (row, tag) => `<tr>${row.map((cell, index) => {
    if (cell.skip) return '';
    const align = aligns[index] ? ` style="text-align:${aligns[index]}"` : '';
    const span = [
      cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
      cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''
    ].join('');
    return `<${tag}${span}${align}>${inlineMarkdown(cell.content)}</${tag}>`;
  }).join('')}</tr>`;
  const head = renderRow(grid[0], 'th');
  const body = grid.slice(1).map((row) => renderRow(row, 'td')).join('');
  return `<table class="${tuack ? 'lg-table-tuack' : 'lg-table'}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderContainer(kind, title, options, body) {
  if (kind === 'align') {
    const align = /(?:^|\s)center(?:\s|$)/.test(options) ? 'center' : 'right';
    return `<div class="lg-align lg-align-${align}">${body}</div>`;
  }
  if (kind === 'epigraph') {
    const by = title ? `<div class="lg-epigraph-by">${inlineMarkdown(title)}</div>` : '';
    return `<blockquote class="lg-epigraph">${body}${by}</blockquote>`;
  }
  const fold = FOLD_KINDS.includes(kind) ? kind : 'info';
  const open = /(?:^|\s)open(?:\s|$)/.test(options) ? ' open' : '';
  const summary = `<summary>${title ? inlineMarkdown(title) : ''}</summary>`;
  return `<details class="lg-fold lg-fold-${fold}"${open}>${summary}<div class="lg-fold-body">${body}</div></details>`;
}

function isBlockStart(line) {
  const source = String(line || '');
  const trimmed = source.trim();
  if (!trimmed) return true;
  if (/^(`{3,}|~{3,})/.test(trimmed)) return true;
  if (/^:{3,}/.test(trimmed)) return true;
  if (/^::cute-table\{/.test(trimmed)) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(source)) return true;
  if (/^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:_\s*){3,}$/.test(source)) return true;
  if (trimmed.includes('|')) return true;
  if (/\u0002\d+\u0002/.test(trimmed)) return true;
  // 以 HTML 标签开头的行按裸 HTML 块处理，不并入 Markdown 段落。
  if (/^<[a-zA-Z!\/]/.test(trimmed)) return true;
  return false;
}

// 洛谷方言块解析器：容器可嵌套（外层比内层多一个冒号），表格、引用、
// 列表、代码块与段落都在这里按块切分后递归处理。
function parseBlocks(lines) {
  const out = [];
  let i = 0;
  let tuackNext = false;
  while (i < lines.length) {
    const line = String(lines[i] || '').replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) { i += 1; continue; }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const count = fenceMatch[1].length;
      const params = fenceMatch[2].trim().split(/\s+/).filter(Boolean);
      const lang = params[0] || 'cpp';
      const options = params.slice(1);
      const closing = new RegExp(`^\\s*${marker === '`' ? '`' : '~'}{${count},}\\s*$`);
      const body = [];
      i += 1;
      while (i < lines.length && !closing.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      const classes = ['lg-code'];
      if (options.includes('line-numbers')) classes.push('lg-code-numbers');
      const highlight = options.find((option) => /^lines=\d+-\d+$/.test(option));
      out.push(`<pre class="${classes.join(' ')}"${highlight ? ` data-highlight="${escapeAttribute(highlight)}"` : ''}><code class="language-${escapeAttribute(lang)}">${escapeHtmlLite(body.join('\n'))}</code></pre>`);
      continue;
    }

    const containerMatch = trimmed.match(/^(:{3,})([a-z]+)?(?:\[([^\]]*)\])?(?:\{([^}]*)\})?$/i);
    if (containerMatch && isContainerKind(containerMatch[2])) {
      const fence = containerMatch[1];
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== fence) end += 1;
      out.push(renderContainer(
        String(containerMatch[2] || '').toLowerCase(),
        containerMatch[3] || '',
        containerMatch[4] || '',
        parseBlocks(lines.slice(i + 1, end))
      ));
      i = Math.min(end + 1, lines.length);
      continue;
    }

    if (/^::cute-table\{tuack\}\s*$/.test(trimmed)) { tuackNext = true; i += 1; continue; }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const aligns = parseTableAlign(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && splitTableRow(lines[i]).length > 1) {
        rows.push(splitTableRow(lines[i])); i += 1;
      }
      out.push(renderTable(header, aligns, rows, tuackNext));
      tuackNext = false;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      out.push('<hr>'); i += 1; continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1;
      }
      out.push(`<blockquote>${parseBlocks(quote)}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      let hasTask = false;
      while (i < lines.length) {
        const item = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!item) break;
        let content = item[3];
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          hasTask = true;
          content = `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${inlineMarkdown(task[2])}`;
        } else {
          content = inlineMarkdown(content);
        }
        items.push(`<li>${content}</li>`); i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${hasTask ? ' class="lg-task"' : ''}>${items.join('')}</${tag}>`);
      continue;
    }

    // 裸 HTML 行：结构保留，只转文本节点里的行内 Markdown（含 ![](url) 图片）。
    if (/^<[a-zA-Z!\/]/.test(trimmed)) {
      out.push(inlineMarkdownInHtml(line));
      i += 1;
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]); i += 1;
    }
    if (!paragraph.length) { paragraph.push(lines[i]); i += 1; }
    // 洛谷段落内普通换行合并为空格；行末两个空格或反斜杠才产生 <br>。
    const parts = paragraph.map((text, index) => {
      const hardBreak = / {2,}$|\\$/.test(text);
      const clean = text.replace(/ {2,}$|\\$/, '');
      const suffix = hardBreak ? '<br>' : (index < paragraph.length - 1 ? ' ' : '');
      return inlineMarkdown(clean) + suffix;
    });
    out.push(`<p>${parts.join('')}</p>`);
  }
  return out.join('\n');
}

// 解析 /problem/description/{descKey} 返回的题面正文。
// 返回 sanitize 后的 HTML + 样例；data.sections 每项含 title 与 value{format,content}。
function parseProblemDescription(html, baseUrl = BASE_URL) {
  const data = embeddedJsonByClass(html, 'data-json-container');
  if (!data || !Array.isArray(data.sections)) {
    throw new ParseError('未找到题面正文数据', html);
  }
  const parts = data.sections.map((section) => {
    const value = section && section.value;
    const format = value && value.format;
    const content = value && typeof value.content === 'string' ? value.content : '';
    const title = section && section.title ? String(section.title) : '';
    const body = renderDescriptionHtml(content, format);
    const heading = title && !/^description$/i.test(title)
      ? `<h3>${escapeHtmlLite(title)}</h3>` : '';
    return `${heading}${body}`;
  }).filter(Boolean).join('\n');
  if (!hasContent(parts)) {
    throw new ParseError('题面正文为空', html);
  }
  return {
    lang: String(data.lang || ''),
    html: sanitizeProblemHtml(parts, baseUrl),
    samples: extractSamples(parts)
  };
}

// 常见 HTML 标签：用于嗅探一段正文是 HTML 还是 Markdown。
const HTML_TAG_RE = /<\/?(?:p|div|br|img|a|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|h[1-6]|pre|code|span|blockquote|hr|details|summary|section|article|font|center|dl|dt|dd|sub|sup|u|s|del|kbd|figure|figcaption|input|label|button)\b/i;

// 明确的 Markdown 结构（链接、标题、加粗、代码块、行间公式）。
// 出现这些结构时按 Markdown 渲染，即使 format 标成 HTML——
// VJudge 比赛描述存在“格式选 HTML 但正文是 Markdown”的情况。
function looksLikeMarkdown(text) {
  const value = String(text || '');
  return /\[[^\]\n]+\]\([^)\s]+\)/.test(value)
    || /(^|\n)#{1,6}\s/.test(value)
    || /\*\*[^*\n]+\*\*/.test(value)
    || /(^|\n)\s*```/.test(value)
    || /\$\$[\s\S]+?\$\$/.test(value);
}

// HTML 结构原样保留、只渲染文本节点里的行内 Markdown（图片/链接/加粗/代码等）。
// VJudge 的 Luogu 题面常把 ![](url) 等 Markdown 写在 HTML 标签内部，
// 直通 HTML 会让图片语法变成可见文本，必须在文本节点里转成 <img>。
function inlineMarkdownInHtml(html) {
  return String(html).split(/(<[^>]+>)/).map((part) => {
    if (!part) return '';
    return (part.startsWith('<') && part.endsWith('>')) ? part : inlineMarkdown(part);
  }).join('');
}

// 把 dataJson 里的描述正文渲染为 HTML：format 显式 MD 或内容像 Markdown 时
// 走 markdownToHtml；HTML 内容保留结构并渲染文本节点里的行内 Markdown；
// 纯文本走 Markdown 段落。
function renderDescriptionHtml(content, format) {
  const text = String(content || '');
  if (!text.trim()) return '';
  if (/^(?:md|markdown|text|plain)$/i.test(String(format || '')) || looksLikeMarkdown(text)) {
    return markdownToHtml(text);
  }
  return HTML_TAG_RE.test(text) ? inlineMarkdownInHtml(text) : markdownToHtml(text);
}

// 从 VJudge 内联 dataJson 中提取题面/描述正文并渲染为 HTML。
// VJudge 统一的渲染组件接收 { content, format }：content 可能直接是字符串，
// 也可能是 { format, content } 对象；比赛页已确认这一结构，题目页同源。
function descriptionFromData(data) {
  if (!data || typeof data !== 'object') return '';
  const desc = data.description ?? data.statement ?? data.content ?? data.body ?? data.text;
  if (typeof desc === 'string') return renderDescriptionHtml(desc, data.format);
  if (desc && typeof desc === 'object' && typeof desc.content === 'string') {
    return renderDescriptionHtml(desc.content, desc.format);
  }
  return '';
}

// 判断一段正文是否含有实际可读内容（文字、图片、代码、表格）。
function hasContent(html) {
  const text = stripHtml(html).trim();
  if (text) return true;
  return /<(?:img|pre|table|svg|math)\b/i.test(String(html || ''));
}

// 判断一段 HTML 是否是未渲染的服务端骨架（i18n 键、导航栏、内联数据、空 tab）。
// 这类内容一旦漏进 Webview 就会显示成乱码和巨型图标，必须判为无效。
function looksLikeSkeleton(html) {
  const source = String(html || '');
  if (/<textarea\b[^>]*name=["']dataJson["']/i.test(source)) return true;
  if (/\bi18n\b|data-i18n/i.test(source)) return true;
  const i18nKeys = (source.match(/\b(?:problem|contest|status|top|article|group|comment)\.[a-z][\w.]*\b/gi) || []).length;
  if (i18nKeys >= 3) return true;
  if (/<nav\b/i.test(source) || /id=["']top-nav["']/i.test(source)) return true;
  return false;
}

// 清洗 VJudge 服务端 HTML 骨架。服务端返回的是未经前端渲染的模板，
// 直接塞进 Webview 会暴露 <i18n> 键、dataJson、导航栏/页脚图标和隐藏 tab。
// 只有当解析逻辑意外拿到整段骨架时才需要它，作为最后一道防线。
function stripServerSkeleton(html) {
  let clean = String(html || '');
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');
  clean = clean.replace(/<i18n\b[^>]*>[\s\S]*?<\/i18n\s*>/gi, '');
  clean = clean.replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea\s*>/gi, '');
  clean = clean.replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi, '');
  clean = clean.replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi, '');
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  clean = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  // 骨架中的隐藏区块（d-none / hidden / display:none），如各类 tab 面板
  clean = clean.replace(/<(div|section|span|ul|li|table|a|p|form)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, (whole, tag, attrs) => {
    if (/\b(?:d-none|hidden)\b|display\s*:\s*none/i.test(attrs)) return '';
    return whole;
  });
  // 骨架里残留的未翻译键（形如 problem.xxx / contest.view.xxx / status.list.xxx）
  clean = clean.replace(/\b(?:problem|contest|status|top|article|group)\.[a-z][\w.]*\b/gi, '');
  return clean;
}

// 无 class 的样例表格（单元格内含 <pre>）补上 vjudge_sample 标记，
// 与 VJudge 自带样例表格统一按“输入/输出各半铺满”渲染。
function markSampleTables(html) {
  return String(html || '').replace(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi, (whole, attrs, inner) => {
    if (!/<pre\b/i.test(inner) || /\bvjudge_sample\b/i.test(attrs)) return whole;
    if (/\bclass\s*=/i.test(attrs)) {
      return whole.replace(/<table\b([^>]*\bclass\s*=\s*)(["'])([^"']*)\2/i,
        (match, pre, quote, cls) => `<table${pre}${quote}${cls} vjudge_sample${quote}`);
    }
    return `<table class="vjudge_sample"${attrs}>${inner}</table>`;
  });
}

function sanitizeProblemHtml(html, baseUrl = BASE_URL) {
  let clean = stripServerSkeleton(html);
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  clean = clean.replace(/<script\b[^>]*\/?\s*>/gi, '');
  clean = clean.replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)\s*>/gi, '');
  clean = clean.replace(/<(?:iframe|object|embed|base)\b[^>]*\/?\s*>/gi, '');
  clean = clean.replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  clean = clean.replace(/(\s+(?:href|src|formaction)\s*=\s*)(["']?)\s*javascript:[\s\S]*?\2/gi, '$1$2#$2');
  clean = clean.replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi, '');
  // 懒加载图片（data-src 等）才是真实地址：无 src 时提升；有占位 src 时替换，
  // 否则 Webview 会一直显示占位图或空白。
  clean = clean.replace(/<img\b([^>]*?)>/gi, (whole, attrs) => {
    const lazy = attrs.match(/\s(?:data-src|data-original|data-lazy-src|data-actualsrc|data-echo)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const lazyUrl = lazy ? (lazy[1] || lazy[2] || lazy[3] || '') : '';
    if (!lazyUrl) return whole;
    const rest = attrs
      .replace(/\s(?:data-src|data-original|data-lazy-src|data-actualsrc|data-echo)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<img src="${escapeAttribute(lazyUrl)}"${rest}>`;
  });
  // 图片（含洛谷图床 cdn.luogu.com.cn）有 Referer 防盗链，统一无 Referer 加载
  clean = clean.replace(/<img\b([^>]*?)(\/?)>/gi, (whole, attrs, slash) => (
    /\breferrerpolicy\s*=/i.test(attrs) ? whole : `<img${attrs} referrerpolicy="no-referrer"${slash}>`
  ));
  clean = markSampleTables(clean);
  return `<base href="${escapeAttribute(resolveUrl(baseUrl))}">${clean}`;
}

const EMPTY_PROBLEM_HTML = '<p class="vjudge-empty">题面正文暂不可用，请点击「网页版」在 VJudge 查看完整题目。</p>';
const EMPTY_CONTEST_HTML = '<p class="vjudge-empty">该比赛暂无题目描述，可切换到「题目」或「榜单」查看，或点击「网页版」。</p>';

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
  // 优先用内联 dataJson 的 description.content，这是前端渲染题面的真实数据源。
  // 绝不回退到整页 bodyHtml：那会把未渲染的服务端骨架（i18n 键、dataJson、
  // 导航栏图标、隐藏 tab）当成正文显示。
  let content = '';
  let data;
  try { data = embeddedData(html); } catch { data = undefined; }
  if (data) content = descriptionFromData(data);

  // dataJson 里的正文若本身是整页骨架（异常结构），同样丢弃。
  if (looksLikeSkeleton(content)) content = '';

  let fromContainer = false;
  // 上游未提供 dataJson 时，从题面容器提取。真实 VJudge 题目页把题面服务端
  // 渲染在 id/class 含 problem 的容器里；这里先取容器，再剔除骨架噪声。
  if (!hasContent(content)) {
    const candidates = [
      'problem-statement', 'problem-description', 'problem-content', 'problem-body',
      'problem-detail', 'problem-view', 'prob-description', 'prob-desc', 'problem'
    ];
    let precise = extractContainer(html, candidates);
    if (!precise) {
      // 兜底：从 body 中切出题面容器区域。只取容器本身，不用整页 body。
      precise = extractContainer(bodyHtml(html), candidates.concat(['description', 'content']));
    }
    if (precise) {
      const cleaned = stripServerSkeleton(precise);
      if (hasContent(cleaned)) { content = cleaned; fromContainer = true; }
    }
  }

  const title = String((data && data.title) || pageTitle(html) || idOrUrl);
  const sourceUrl = /^https?:\/\//i.test(String(idOrUrl)) ? String(idOrUrl) : resolveUrl(BASE_URL);
  if (!hasContent(content) || (!fromContainer && looksLikeSkeleton(content))) {
    return { id: String(idOrUrl), title, html: EMPTY_PROBLEM_HTML, samples: [], sourceUrl, descriptionMissing: true };
  }
  return {
    id: String(idOrUrl),
    title,
    html: sanitizeProblemHtml(content),
    samples: extractSamples(content),
    sourceUrl,
    descriptionMissing: false
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
  // /contest/{id} 把完整信息放在 <textarea name="dataJson"> 中，它是前端渲染
  // 比赛描述的唯一真实数据源。绝不再回退到 extractContainer/bodyHtml：那会把
  // 未渲染的服务端骨架（<i18n> 键、dataJson 原文、导航图标、隐藏 tab）当正文。
  const embedded = parseContestData(html, id);
  let content = embedded ? embedded.description : '';
  if (looksLikeSkeleton(content)) content = '';
  const status = embedded
    ? (embedded.ended ? 'ended' : embedded.started ? 'running' : 'upcoming')
    : 'unknown';
  return {
    id: String((embedded && embedded.id) || id),
    title: (embedded && embedded.title) || pageTitle(html),
    html: hasContent(content) ? sanitizeProblemHtml(content) : EMPTY_CONTEST_HTML,
    status,
    begin: embedded ? embedded.begin : 0,
    end: embedded ? embedded.end : 0,
    startTime: embedded && embedded.begin ? new Date(embedded.begin).toLocaleString('zh-CN') : '',
    endTime: embedded && embedded.end ? new Date(embedded.end).toLocaleString('zh-CN') : '',
    managerName: embedded ? embedded.managerName : '',
    fav: embedded ? embedded.fav : false,
    problems: embedded ? embedded.problems : [],
    descriptionMissing: !hasContent(content)
  };
}

// 解析用户资料页：#profile-header-data 提供 counts/ranks 统计，
// profile-meta 是昵称，.profile-fact 是注册时间/最后活跃/学校等资料项。
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
  const accountName = (nameMatch ? stripHtml(nameMatch[1]) : '').trim()
    || (titleMatch ? stripHtml(titleMatch[1]).replace(/\s*[-–|]\s*Virtual Judge.*$/i, '').trim() : '');
  const metaMatch = source.match(/<[^>]*class=["'][^"']*profile-meta[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const displayName = metaMatch ? stripHtml(metaMatch[1]).trim() : '';

  // #profile-header-data：{"counts":{"acAll":..,"attAll":..},"ranks":{"all":..}}
  let counts = {};
  let ranks = {};
  const headerMatch = source.match(/<script\b[^>]*id=["']profile-header-data["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (headerMatch) {
    try {
      const parsed = JSON.parse(decodeEntities(headerMatch[1].trim()));
      if (parsed && typeof parsed === 'object') {
        counts = parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {};
        ranks = parsed.ranks && typeof parsed.ranks === 'object' ? parsed.ranks : {};
      }
    } catch { /* 统计 JSON 异常时保持 0，走客户端 solveDetail2 兜底 */ }
  }

  // .profile-fact：<dt data-i18n="user.profile.school">School:</dt><dd>华中师大一附中</dd>
  const FACT_LABELS = {
    'user.profile.register': '注册时间',
    'user.profile.last_seen': '最后活跃',
    'user.profile.school': '学校'
  };
  const facts = [];
  const factRe = /<div\b[^>]*class=["'][^"']*profile-fact[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/gi;
  let factMatch;
  while ((factMatch = factRe.exec(source))) {
    const inner = factMatch[1];
    const dt = inner.match(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>/i);
    const dd = inner.match(/<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/i);
    if (!dt || !dd) continue;
    const i18nKey = (dt[0].match(/data-i18n=["']([^"']+)["']/i) || [])[1] || '';
    const rawLabel = stripHtml(dt[1]).trim().replace(/[:：]\s*$/, '');
    const value = stripHtml(dd[1]).trim();
    if (!value) continue;
    facts.push({ label: FACT_LABELS[i18nKey] || rawLabel || i18nKey, value });
  }

  const solvedCount = Number(counts.acAll) || 0;
  const attemptedCount = Number(counts.attAll) || 0;
  const acceptRate = attemptedCount > 0 ? `${((solvedCount / attemptedCount) * 100).toFixed(1)}%` : '';
  const account = accountName || String(username || '');
  return {
    username: account,
    nickname: account,
    displayName,
    avatar: avatarUrl ? decodeEntities(avatarUrl) : '',
    avatarUrl: avatarUrl ? decodeEntities(avatarUrl) : '',
    solvedCount,
    attemptedCount,
    acceptRate,
    rank: Number(ranks.all) || 0,
    ranks: {
      d1: Number(ranks['1d']) || 0,
      d7: Number(ranks['7d']) || 0,
      d30: Number(ranks['30d']) || 0,
      all: Number(ranks.all) || 0
    },
    facts,
    submissionCount: attemptedCount
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
  const description = descriptionFromData(data);
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
  parseProblemDescription,
  markdownToHtml,
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
