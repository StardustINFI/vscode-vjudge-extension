'use strict';

const https = require('node:https');
const { resolveUrl } = require('./endpoints');

class HttpError extends Error {
  constructor(response) {
    super(`HTTP ${response.status}`);
    this.name = 'HttpError';
    this.status = response.status;
    this.url = response.url;
    this.data = response.data;
  }
}

class MockNetworkError extends Error {
  constructor() {
    super('Mock 模式已启用，已阻止真实网络请求');
    this.name = 'MockNetworkError';
    this.code = 'MOCK_NETWORK_BLOCKED';
  }
}

function splitSetCookie(value) {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[^;,\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function responseHeaders(rawHeaders) {
  return {
    get(name) {
      const value = rawHeaders[String(name).toLowerCase()];
      return Array.isArray(value) ? value.join(', ') : value || null;
    },
    getSetCookie() {
      const value = rawHeaders['set-cookie'];
      return Array.isArray(value) ? value : splitSetCookie(value);
    }
  };
}

function httpsRequest(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || 'GET',
      headers: { 'Accept-Encoding': 'identity', ...(options.headers || {}) },
      signal: options.signal
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error('重定向次数过多'));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        const nextOptions = { ...options };
        if (status === 303) {
          nextOptions.method = 'GET';
          nextOptions.body = undefined;
        }
        resolve(httpsRequest(nextUrl, nextOptions, redirects + 1));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headers = responseHeaders(response.headers);
        const result = {
          status,
          ok: status >= 200 && status < 300,
          url,
          headers,
          async text() { return body; },
          async json() { return JSON.parse(body); }
        };
        resolve(result);
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (options.body !== undefined && options.body !== null) {
      request.write(options.body);
    }
    request.end();
  });
}

class HttpClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl;
    this.timeout = options.timeout || 30000;
    this.outputChannel = options.outputChannel;
    this.isMockMode = options.isMockMode || (() => false);
    this.onCookiesChanged = options.onCookiesChanged;
    this.fetchImpl = options.fetchImpl;
    this.cookies = new Map();
  }

  setCookies(cookies) {
    this.cookies.clear();
    Object.entries(cookies || {}).forEach(([name, value]) => {
      if (typeof value === 'string') {
        this.cookies.set(name, value);
      }
    });
  }

  getCookies() {
    return Object.fromEntries(this.cookies.entries());
  }

  getCookie(name) {
    if (this.cookies.has(name)) {
      return this.cookies.get(name);
    }
    const key = Object.keys(this.getCookies()).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? this.cookies.get(key) : undefined;
  }

  cookieHeader() {
    return Array.from(this.cookies.entries(), ([name, value]) => `${name}=${value}`).join('; ');
  }

  absorbSetCookie(headers) {
    let values = [];
    if (headers && typeof headers.getSetCookie === 'function') {
      values = headers.getSetCookie();
    }
    if (!values.length && headers) {
      values = splitSetCookie(headers.get('set-cookie'));
    }
    values.forEach((cookie) => {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    });
    return values.length > 0;
  }

  async persistCookies() {
    if (!this.onCookiesChanged) {
      return;
    }
    try {
      await this.onCookiesChanged(this.getCookies());
    } catch (error) {
      this.log(`Cookie 保存失败: ${error.message}`);
    }
  }

  log(message) {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[HTTP] ${message}`);
    }
  }

  async request(pathOrUrl, options = {}) {
    if (this.isMockMode()) {
      throw new MockNetworkError();
    }

    const method = String(options.method || 'GET').toUpperCase();
    const url = resolveUrl(pathOrUrl, this.baseUrl);
    const headers = {
      Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      ...(options.headers || {})
    };
    const cookie = this.cookieHeader();
    if (cookie && !headers.Cookie && !headers.cookie) {
      headers.Cookie = cookie;
    }
    if (['POST', 'PUT'].includes(method)) {
      const csrf = this.getCookie('csrftoken');
      if (csrf) {
        headers['X-XSRF-TOKEN'] = decodeURIComponent(csrf);
      }
    }

    const controller = new AbortController();
    const externalSignal = options.signal;
    let timedOut = false;
    const abort = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
      if (externalSignal.aborted) {
        abort();
      } else {
        externalSignal.addEventListener('abort', abort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('请求超时'));
    }, options.timeout || this.timeout);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    try {
      const fetcher = this.fetchImpl || (typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : httpsRequest);
      const response = await fetcher(url, {
        method,
        headers,
        body: options.body,
        signal: controller.signal,
        redirect: 'follow'
      });
      const changed = this.absorbSetCookie(response.headers);
      if (changed) {
        await this.persistCookies();
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      let data = null;
      let rawText;
      if (response.status !== 204 && response.status !== 205) {
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          data = await response.json();
        } else {
          rawText = await response.text();
          data = rawText;
        }
      }
      const result = { data, rawText, contentType, status: response.status, ok: response.ok,
        headers: response.headers, url: response.url || url };
      if (!response.ok) {
        throw new HttpError(result);
      }
      return result;
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error('请求超时');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abort);
      }
    }
  }

  get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  postForm(url, data, options = {}) {
    const form = new URLSearchParams();
    Object.entries(data || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => form.append(key, String(item)));
      } else {
        form.append(key, String(value));
      }
    });
    return this.request(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(options.headers || {})
      },
      body: form.toString()
    });
  }
}

module.exports = { HttpClient, HttpError, MockNetworkError, httpsRequest, splitSetCookie };
