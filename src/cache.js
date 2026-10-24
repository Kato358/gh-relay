// Cache policy. The rule is content-addressed, never date-addressed: a path is
// either immutable (SHA, tag, release asset) or mutable (branch ref), and the
// decision is made from the path itself.

const IMMUTABLE = 'immutable';
const REFRESH = 'refresh';
const STANDARD = 'standard';
const BYPASS = 'bypass';

export const POLICIES = Object.freeze({
  immutable: { edge: 31536000, browser: 31536000, swr: 0, label: IMMUTABLE },
  refresh: { edge: 60, browser: 0, swr: 600, label: REFRESH },
  standard: { edge: 3600, browser: 600, swr: 21600, label: STANDARD },
  bypass: { edge: 0, browser: 0, swr: 0, label: BYPASS },
});

const SHA = /^[0-9a-f]{40}$/i;
const SHORT_SHA = /^[0-9a-f]{7,39}$/i;
const TAG = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;
const MUTABLE_REF = /^(?:master|main|develop|dev|trunk|head|latest|nightly|snapshot|edge|canary)$/i;

/**
 * @param {string} ref
 */
function isImmutableRef(ref) {
  return SHA.test(ref) || TAG.test(ref);
}

/**
 * Classify a target path into a cache policy.
 *
 * @param {string} hostname
 * @param {string} pathname
 * @param {{authenticated?: boolean, git?: boolean, method?: string, range?: boolean}} ctx
 * @returns {{edge: number, browser: number, swr: number, label: string, immutable: boolean}}
 */
export function cachePolicy(hostname, pathname, ctx = {}) {
  if (ctx.git || ctx.method === 'HEAD' || ctx.authenticated) {
    return POLICIES.bypass;
  }
  const p = String(pathname || '/');

  // Codeload archives: /owner/repo/(tar.gz|zip)/refs/tags/<tag> is immutable,
  // /refs/heads/<branch> is not.
  if (hostname === 'codeload.github.com') {
    const m = p.match(/^\/[^/]+\/[^/]+\/(?:tar\.gz|zip|legacy\.(?:tar\.gz|zip))\/(.+)$/);
    if (m) {
      const spec = m[1];
      const tail = spec.split('/').pop() || '';
      if (/\/(?:tags?|sha|commit)\//.test(spec) || isImmutableRef(tail)) {
        return POLICIES.immutable;
      }
      return POLICIES.refresh;
    }
    return POLICIES.standard;
  }

  // Raw files: /owner/repo/<ref>/path. A SHA ref makes the file immutable.
  if (hostname === 'raw.githubusercontent.com' || hostname === 'media.githubusercontent.com') {
    const parts = p.split('/').filter(Boolean);
    const ref = parts[2] || '';
    if (isImmutableRef(ref)) return POLICIES.immutable;
    if (MUTABLE_REF.test(ref) || SHORT_SHA.test(ref)) return POLICIES.refresh;
    return POLICIES.standard;
  }

  // Release assets: /owner/repo/releases/download/<tag>/<file>.
  const release = p.match(/^\/[^/]+\/[^/]+\/releases\/download\/([^/]+)\//);
  if (release) {
    return isImmutableRef(release[1]) ? POLICIES.immutable : POLICIES.refresh;
  }

  // Source archives: /owner/repo/archive/<ref>.zip|.tar.gz
  const archive = p.match(/^\/[^/]+\/[^/]+\/archive\/refs\/(?:tags|heads|pull)\/(.+)$/) ||
    p.match(/^\/[^/]+\/[^/]+\/archive\/(.+)$/);
  if (archive) {
    const tail = (archive[1] || '').replace(/\.(?:zip|tar\.gz|tgz)$/i, '');
    return isImmutableRef(tail) ? POLICIES.immutable : POLICIES.refresh;
  }

  // API responses are metadata: short and always revalidated.
  if (hostname === 'api.github.com') {
    return { ...POLICIES.standard, edge: 120, browser: 0, swr: 60, label: 'api' };
  }

  if (p.includes('/tags') || p.includes('/releases/latest')) return POLICIES.refresh;

  return POLICIES.standard;
}

/**
 * Headers that must never reach a shared cache or be replayed to the client.
 */
const STRIP_REQUEST = Object.freeze([
  'cookie',
  'host',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
  'cdn-loop',
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'accept-encoding',
]);

const STRIP_RESPONSE = Object.freeze([
  'clear-site-data',
  'content-security-policy',
  'content-security-policy-report-only',
  'cdn-cache-control',
  'cloudflare-cdn-cache-control',
  'expires',
  'pragma',
  'age',
  'connection',
  'keep-alive',
  'proxy-connection',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-github-request-id',
]);

const PASS_REQUEST = Object.freeze([
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
  'user-agent',
  'accept',
  'accept-language',
]);

/**
 * Build upstream request headers. Only a fixed allowlist survives; everything
 * else (cookies, client IP, hop-by-hop) is dropped so nothing leaks upstream
 * and nothing poisons the shared cache.
 *
 * @param {Headers} incoming
 * @param {{authenticated?: boolean, git?: boolean}} opts
 * @returns {Headers}
 */
export function upstreamHeaders(incoming, opts = {}) {
  const out = new Headers();
  for (const name of PASS_REQUEST) {
    const value = incoming.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has('accept')) out.set('accept', '*/*');
  // Ask for identity so the edge cache holds one representation per URL. The
  // browser negotiates compression with Cloudflare, not with GitHub.
  out.set('accept-encoding', 'identity');

  if (opts.git) {
    for (const name of ['git-protocol', 'content-type', 'accept']) {
      const value = incoming.get(name);
      if (value) out.set(name, value);
    }
  }
  if (opts.authenticated) {
    const auth = incoming.get('authorization');
    if (auth) out.set('authorization', auth);
  }
  return out;
}

/**
 * Build client-facing response headers.
 *
 * @param {Headers} upstream
 * @param {{policy: {edge: number, browser: number, swr: number, label: string}, immutable: boolean}} opts
 * @returns {Headers}
 */
export function downstreamHeaders(upstream, opts) {
  const out = new Headers(upstream);
  for (const name of STRIP_RESPONSE) out.delete(name);

  const { policy } = opts;
  let cacheControl;
  if (policy.label === BYPASS) {
    cacheControl = 'no-store';
  } else if (policy.edge === 0) {
    cacheControl = 'no-cache';
  } else {
    const parts = [`public`, `max-age=${policy.browser}`, `s-maxage=${policy.edge}`];
    if (opts.immutable) parts.push('immutable');
    if (policy.swr) parts.push(`stale-while-revalidate=${policy.swr}`);
    cacheControl = parts.join(', ');
  }
  out.set('cache-control', cacheControl);

  const vary = new Set(['accept-encoding']);
  const upstreamVary = upstream.get('vary');
  if (upstreamVary) {
    for (const v of upstreamVary.split(',')) {
      const name = v.trim().toLowerCase();
      if (name && name !== '*') vary.add(name);
    }
  }
  out.set('vary', [...vary].join(', '));

  out.set('access-control-allow-origin', '*');
  out.set('access-control-expose-headers', '*');
  out.set('x-content-type-options', 'nosniff');
  out.set('referrer-policy', 'no-referrer');
  out.set('x-proxy-rule', policy.label);
  return out;
}

/**
 * Whether a request/response pair may be written to the edge cache.
 *
 * @param {{method: string, authenticated: boolean, git: boolean, range: boolean}} req
 * @param {Response} res
 * @param {{edge: number}} policy
 */
export function isCacheable(req, res, policy) {
  if (req.method !== 'GET') return false;
  if (req.git || req.authenticated || req.range) return false;
  if (policy.edge <= 0) return false;
  if (res.status !== 200) return false;
  if (res.headers.has('set-cookie')) return false;
  if (res.headers.get('cache-control')?.includes('no-store')) return false;
  return true;
}

/**
 * Cache key: the proxy URL plus the encoding we negotiated (`identity`), never
 * a date. Two requests for the same bytes on different days share an entry.
 *
 * @param {string} url
 */
export function cacheKey(url) {
  const u = new URL(url);
  u.searchParams.set('__enc', 'identity');
  return u.toString();
}
