'use strict';

// 扩展宿主端图片内联：把正文 HTML 里的远程图片抓取后转成 data URI。
// Webview 的网络环境（代理、证书、CSP、防盗链）在不同机器上差异很大，
// 洛谷图床 cdn.luogu.com.cn 等外链经常加载失败；在扩展宿主侧抓取并内联
// 可以彻底绕过 Webview 网络问题，同时保持零 npm 依赖（仅 Node 内置模块）。
//
// 约束：
// - 只处理 http(s) 绝对地址与协议相对地址（//host/...）；
// - 单张图片大小上限 2MB、超时 15 秒、并发 4；
// - 会话级缓存，同一 URL 只抓一次；
// - 原图抓取失败时回退 VJudge 图片代理（cdn.vjudge.net.cn/<md5(原图URL)>）；
// - 仍失败时保留原始 URL 并写入 data-fallback 备用地址，交回 Webview 重试
//   （CSP 已放行 http/https）。

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

// url -> dataUri | null（null 表示抓取失败，别再重试）
const cache = new Map();

function resetCache() {
  cache.clear();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function mimeFromType(contentType, url) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (/^image\//.test(type)) return type;
  const ext = String(url || '').toLowerCase().split(/[?#]/)[0].match(/\.([a-z0-9]+)$/);
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif'
  };
  return (ext && map[ext[1]]) || 'image/png';
}

// 按魔数嗅探图片类型。洛谷图床返回 application/octet-stream、
// VJudge CDN 代理 URL 无扩展名，仅靠 content-type/扩展名不可靠。
function sniffMime(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b.length >= 12 && b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }
  const head = b.slice(0, 256).toString('latin1').replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}

// VJudge 图片代理地址：https://cdn.vjudge.net.cn/<md5(原图URL)>
// VJudge 会把题面引用的外链图片爬取到自家 CDN，哈希即原图 URL 的 MD5。
// 仅对已被 VJudge 收录过的图片有效（题面里的图片都属于这一类）。
function proxyUrl(url) {
  const hash = crypto.createHash('md5').update(String(url)).digest('hex');
  return `https://cdn.vjudge.net.cn/${hash}`;
}

function isJudgeProxy(url) {
  return /cdn\.vjudge\.net\.cn/i.test(String(url || ''));
}

function fetchBinary(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const transport = parsed.protocol === 'http:' ? http : https;
    const request = transport.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; vscode-vjudge-extension)',
        Accept: 'image/*,*/*;q=0.8',
        // 洛谷图床对无 Referer 或本站 Referer 都放行；这里带上图片所属站点
        // 的 Referer，兼容少数只对“自家页面”开放的图床。
        Referer: /luogu\.com\.cn/i.test(parsed.hostname) ? 'https://www.luogu.com.cn/' : 'https://vjudge.net/'
      },
      timeout: TIMEOUT_MS
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error('图片重定向次数过多'));
          return;
        }
        const nextUrl = new URL(response.headers.location, parsed).toString();
        resolve(fetchBinary(nextUrl, redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`图片响应 ${status}`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          request.destroy(new Error('图片超过 2MB 上限'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const sniffed = sniffMime(buffer);
        const type = sniffed || mimeFromType(response.headers['content-type'], parsed.href);
        resolve({ buffer, type });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('图片下载超时')));
    request.on('error', reject);
  });
}

async function toDataUri(url) {
  if (cache.has(url)) return cache.get(url);
  let result = null;
  try {
    const { buffer, type } = await fetchBinary(url);
    if (buffer.length && buffer.length <= MAX_BYTES) {
      result = `data:${type};base64,${buffer.toString('base64')}`;
    }
  } catch {
    result = null;
  }
  // 原图失败（证书、防盗链、区域网络）时回退 VJudge 图片代理；
  // 代理 URL 本身失败则不再套娃。
  if (!result && !isJudgeProxy(url)) {
    try {
      const { buffer, type } = await fetchBinary(proxyUrl(url));
      if (buffer.length && buffer.length <= MAX_BYTES) {
        result = `data:${type};base64,${buffer.toString('base64')}`;
      }
    } catch {
      result = null;
    }
  }
  cache.set(url, result);
  return result;
}

function absolutize(rawUrl) {
  let url = decodeEntities(String(rawUrl || '').trim());
  if (!url || /^data:/i.test(url)) return '';
  if (/^\/\//.test(url)) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

// 扫描 <img> 的 src，抓取远程图片并替换为 data URI。
// 返回替换后的 HTML；单张失败不影响其余图片，全部失败则原样返回。
async function inlineImages(html) {
  const source = String(html || '');
  if (!source || !/<img\b/i.test(source)) return source;

  const targets = new Map(); // 原始 src 文本 -> 绝对 URL
  const imgRe = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(source))) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const absolute = absolutize(raw);
    if (absolute && !targets.has(raw)) targets.set(raw, absolute);
    if (targets.size >= 30) break;
  }
  if (!targets.size) return source;

  // 限并发抓取
  const entries = [...targets.entries()];
  const resolved = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const [raw, absolute] = entries[cursor];
      cursor += 1;
      resolved.set(raw, await toDataUri(absolute));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  return source.replace(imgRe, (whole, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare ?? '';
    const dataUri = resolved.get(raw);
    if (dataUri) {
      const quote = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
      return whole.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1${quote}${dataUri}${quote}`);
    }
    // 内联失败：写入 data-fallback 备用地址，Webview 端加载出错时换用它重试。
    const absolute = absolutize(raw);
    if (absolute && !isJudgeProxy(absolute) && !/\sdata-fallback\s*=/i.test(whole)) {
      return whole.replace(/\s*\/?>$/, (tail) => ` data-fallback="${proxyUrl(absolute)}"${tail}`);
    }
    return whole;
  });
}

module.exports = { inlineImages, resetCache, fetchBinary, proxyUrl, sniffMime, MAX_BYTES };
