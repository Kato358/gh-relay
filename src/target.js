// Target parsing: turn a request path into a validated upstream URL.
// Pure functions only — no fetch, no globals.

/** Hosts a user may paste. Entry hosts return GitHub pages, asset hosts serve files. */
export const HOSTS = Object.freeze({
  'github.com': 'entry',
  'api.github.com': 'api',
  'raw.githubusercontent.com': 'asset',
  'gist.githubusercontent.com': 'asset',
  'gist.github.com': 'entry',
  'codeload.github.com': 'asset',
  'media.githubusercontent.com': 'asset',
  'release-assets.githubusercontent.com': 'asset',
  'objects.githubusercontent.com': 'asset',
  'github-releases.githubusercontent.com': 'asset',
  'github.githubassets.com': 'asset',
});

/** Hosts that may receive the caller's Authorization header. */
const CREDENTIAL_HOSTS = new Set(['github.com', 'api.github.com']);

/**
 * Route prefixes that pin a host, so `/raw/owner/repo/main/a.js` and
 * `/gh/github.com/...` work next to the canonical `/<full-url>` form.
 * `api` and `lfs` keep their full host so the existing parser sees it.
 */
export const PREFIX_HOSTS = Object.freeze({
  gh: 'github.com',
  raw: 'raw.githubusercontent.com',
  api: 'api.github.com',
  lfs: 'media.githubusercontent.com',
});

export const MAX_PATH_LENGTH = 4096;

/**
 * Strip a known route prefix and resolve the host it pins.
 *
 * @param {string} path request pathname
 * @returns {{path: string, host: string|null}}
 */
export function applyPrefix(path) {
  const value = String(path || '');
  const match = value.match(/^\/(gh|raw|api|lfs)\/(?=\S)/i);
  if (!match) return { path: value, host: null };
  const rest = value.slice(match[0].length);
  return { path: '/' + rest, host: PREFIX_HOSTS[match[1].toLowerCase()] };
}

/**
 * @param {string} hostname
 * @returns {'entry'|'api'|'asset'|null}
 */
export function hostKind(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(HOSTS, h)) return HOSTS[h];
  // ALLOW_HOSTS entries are treated as asset hosts: they serve bytes, never
  // GitHub pages, and never receive credentials.
  if (h && extraHosts.has(h)) return 'asset';
  return null;
}

const extraHosts = new Set();

/**
 * Register hosts from `ALLOW_HOSTS`. Called once per isolate by the Worker.
 * @param {string[]} hosts lowercase hostnames
 */
export function registerHosts(hosts) {
  for (const host of hosts || []) {
    const h = String(host || '').toLowerCase().trim();
    if (h && /^[a-z0-9.-]+$/.test(h)) extraHosts.add(h);
  }
  return extraHosts.size;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function acceptsCredentials(hostname) {
  return CREDENTIAL_HOSTS.has(String(hostname || '').toLowerCase());
}

/** True when the caller already wrote `host/path` or `https://host/path`. */
function authoredHost(rest) {
  if (/^https:\/\//i.test(rest)) return true;
  const lower = rest.toLowerCase();
  const slash = lower.indexOf('/');
  if (slash <= 0) return false;
  return Boolean(hostKind(lower.slice(0, slash)));
}

/**
 * Cloudflare collapses `//` inside paths and the platform may strip a scheme
 * separator, so `/https://github.com/x` can arrive as `/https:/github.com/x`.
 * @param {string} path
 */
export function normalizePath(path) {
  const rest = String(path || '').replace(/^\/+/, '');
  if (!/^https?:/i.test(rest)) return rest;
  // Keep the scheme the caller wrote so `http:` is rejected, not silently
  // upgraded, and collapse Cloudflare's `//` trimming to exactly `//`.
  return rest.replace(/^(https?):\/*/i, (_, scheme) => `${scheme.toLowerCase()}://`);
}

/**
 * Parse a proxied path into an upstream target.
 * Accepts two forms: `/https://host/...` and `/host/...`.
 *
 * @param {string} path request pathname (no query)
 * @param {{host?: string|null}} [options] host pinned by a route prefix; the
 *        path then omits the host and starts at its first segment
 * @returns {{ok: true, url: URL, host: string, kind: 'entry'|'api'|'asset', pathname: string, search: string}
 *          | {ok: false, reason: 'empty'|'too-long'|'bad-url'|'unsupported-host'|'userinfo'|'insecure'|'bad-port'}}
 */
export function parseTarget(path, options = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (path.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  let rest = normalizePath(path);
  if (!rest) return { ok: false, reason: 'empty' };
  if (options.host) {
    // `/raw/owner/repo/main/a.js` → `raw.githubusercontent.com/owner/repo/main/a.js`.
    // A pinned prefix never rewrites a host the caller already wrote in full.
    if (!authoredHost(rest)) rest = `${options.host}/${rest}`;
  }
  // Check the scheme before any repair: prepending `https://` to `http://host`
  // would otherwise produce `https://http://host` and report the wrong reason.
  if (/^http:/i.test(rest)) return { ok: false, reason: 'insecure' };
  if (!/^https:\/\//i.test(rest)) rest = 'https://' + rest;

  let url;
  try {
    url = new URL(rest);
  } catch {
    return { ok: false, reason: 'bad-url' };
  }

  // Order matters: `http://user:pass@host` must report `insecure`, not a
  // credential error the caller cannot act on.
  if (url.protocol !== 'https:') return { ok: false, reason: 'insecure' };
  if (url.port) return { ok: false, reason: 'bad-port' };
  // Reject credentials outright: a proxy that accepts `user:pass@` leaks them
  // into logs and into the upstream request line.
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };

  const kind = hostKind(url.hostname);
  if (!kind) return { ok: false, reason: 'unsupported-host' };
  if (!url.pathname || url.pathname === '/') {
    return { ok: false, reason: 'unsupported-host' };
  }
  if (url.hash) url.hash = '';

  return {
    ok: true,
    url,
    host: url.hostname.toLowerCase(),
    kind,
    pathname: url.pathname,
    search: url.search,
  };
}

/**
 * Parse a value pasted into the homepage box (query `?q=` or `?url=`).
 * Bare `owner/repo` is deliberately not accepted: it collides with `/` routes
 * such as `/favicon.ico` and `/robots.txt` and silently proxies 404s upstream.
 *
 * @param {string} value
 * @returns {{ok: true, target: string}|{ok: false, reason: string}}
 */
export function parsePastedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_PATH_LENGTH) return { ok: false, reason: 'too-long' };

  let rest = raw.replace(/^(?:https?):\/+/i, 'https://');
  if (!/^https:\/\//i.test(rest)) rest = 'https://' + rest.replace(/^\/+/, '');

  let url;
  try {
    url = new URL(rest);
  } catch {
    return { ok: false, reason: 'bad-url' };
  }
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  if (url.protocol !== 'https:' || url.port) return { ok: false, reason: 'insecure' };
  if (!hostKind(url.hostname)) return { ok: false, reason: 'unsupported-host' };

  url.hash = '';
  return { ok: true, target: url.href };
}

export const REASON_MESSAGES = Object.freeze({
  empty: '没有地址可以处理。粘贴一个 GitHub 链接。',
  'too-long': '地址太长了，超过 4096 个字符。',
  'bad-url': '这个地址无法解析。检查是否少了协议或域名拼写有误。',
  'unsupported-host': '这个主机不在支持范围内。',
  userinfo: '地址里不能包含用户名或密码。',
  insecure: '只支持 https 地址。',
  'bad-port': '地址里不能指定端口。',
});
