// Proxy engine: one upstream request, redirect rules, one cache decision.
// Everything here is I/O; all decisions live in target.js / cache.js / git.js.

import { parseTarget, acceptsCredentials, REASON_MESSAGES, applyPrefix } from './target.js';
import {
  cachePolicy,
  upstreamHeaders,
  downstreamHeaders,
  isCacheable,
  cacheKey,
} from './cache.js';
import {
  classifyGit,
  classifyLfs,
  isGitRoute,
  redirectRule,
  REDIRECT,
  GIT_ROUTE,
  LFS_ROUTE,
} from './git.js';
import { errorResponse } from './respond.js';
import { hostKind } from './target.js';

// The Workers runtime provides `caches`; the test harness stubs it. Resolve it
// once at module scope so tests can install a fake before importing the Worker.
const edgeCache = (typeof caches !== 'undefined' && caches && caches.default) || null;

const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 25000;
const RETRY_STATUS = new Set([502, 503, 504]);

// Per-isolate request counter for /stats. Resets with the isolate; it answers
// "is this Worker alive and doing work", not analytics.
let served = 0;

export function statsSnapshot() {
  return { served, uptimeHints: 'per-isolate counter, resets on cold start' };
}

/**
 * @param {Request} request
 * @param {{RATE_LIMITER?: {limit: (opts: {key: string}) => Promise<{success: boolean}>}}} env
 * @param {{waitUntil: (p: Promise<unknown>) => void}} ctx
 */
export async function handleProxy(request, env, ctx) {
  const started = Date.now();
  const url = new URL(request.url);
  served++;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST',
        'access-control-allow-headers': '*',
        'access-control-max-age': '86400',
      },
    });
  }

  const routed = applyPrefix(url.pathname);
  const target = parseTarget(routed.path, { host: routed.host });
  if (!target.ok) {
    return errorResponse(
      400,
      REASON_MESSAGES[target.reason] || '无法识别的地址。',
      target.reason === 'unsupported-host'
        ? 'This host is not proxied.'
        : 'The address could not be processed.',
      request,
    );
  }

  const gitRoute = classifyGit(request.method, target, url.searchParams, request.headers);
  const lfsRoute = gitRoute === GIT_ROUTE.FORBIDDEN || gitRoute !== GIT_ROUTE.ORDINARY
    ? ''
    : classifyLfs(request.method, target, request.headers);

  if (gitRoute === GIT_ROUTE.FORBIDDEN) {
    return errorResponse(
      405,
      '这个地址只允许读取。推送请求不会被转发。',
      'Only read-only git requests are allowed; pushes are not proxied.',
      request,
      { allow: 'GET, HEAD, OPTIONS, POST' },
    );
  }
  if (lfsRoute === LFS_ROUTE.FORBIDDEN) {
    return errorResponse(
      405,
      'LFS 只转发下载。上传请在 GitHub 上直接操作。',
      'Git LFS transfers are download-only here; uploads are refused.',
      request,
      { allow: 'GET, HEAD, OPTIONS, POST' },
    );
  }

  const git = isGitRoute(gitRoute);
  const lfsBatch = lfsRoute === LFS_ROUTE.BATCH;
  const lfsTransfer = lfsRoute === LFS_ROUTE.TRANSFER;
  const lfs = lfsBatch || lfsTransfer;

  if (!git && !lfsBatch && request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(
      405,
      '只支持下载。发布、推送或修改请在 GitHub 上直接操作。',
      'Only downloads are proxied. Publish on GitHub itself.',
      request,
      { allow: 'GET, HEAD, OPTIONS, POST' },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader && !git && !lfsBatch && !acceptsCredentials(target.host)) {
    return errorResponse(
      403,
      '凭据只会发往 github.com 和 api.github.com。',
      'Credentials are only forwarded to github.com, api.github.com and LFS batch requests.',
      request,
    );
  }
  if (authHeader && git && !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(authHeader)) {
    return errorResponse(
      400,
      '私有仓库克隆需要 HTTP Basic 凭据。',
      'Private clones require HTTP Basic credentials.',
      request,
    );
  }
  const authenticated = Boolean(authHeader) && (acceptsCredentials(target.host) || lfsBatch);

  const limited = await applyRateLimit(request, env, git || lfs);
  if (limited) return limited;

  // The proxy path carries the target's own query for API/tag pages; git and
  // LFS use the proxy query (`service=git-upload-pack`).
  const upstream = new URL(target.url.href);
  if (git) {
    upstream.search = url.search;
  } else if (!target.search) {
    upstream.search = url.search;
  }

  const policy = cachePolicy(target.host, target.pathname, {
    authenticated,
    git,
    method: request.method,
    range: request.headers.has('range'),
  });

  const key = policy.edge > 0 && !git && !lfs && !authenticated
    ? new Request(cacheKey(request.url), { method: 'GET' })
    : null;

  if (key && edgeCache) {
    const hit = await edgeCache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-proxy-cache', 'HIT');
      headers.set('server-timing', `edge;dur=${Date.now() - started}`);
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const headers = upstreamHeaders(request.headers, { authenticated, git });
  const hasBody = request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH';

  let upstreamResponse;
  try {
    upstreamResponse = git
      ? await fetchGit(upstream, request, headers)
      : await fetchWithRetry(upstream, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
      });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return errorResponse(
      502,
      '上游没有响应。稍后重试，或换一个镜像。',
      `Upstream request failed: ${detail}`,
      request,
      { 'retry-after': '10' },
    );
  }

  return finalize(upstreamResponse, {
    request,
    policy,
    git,
    lfs,
    key,
    started,
    ctx,
    upstreamUrl: upstream.href,
  });
}

async function applyRateLimit(request, env, exempt) {
  // Missing binding must not take the deployment down: a one-click install has
  // no rate-limit namespace, and git/LFS traffic legitimately bursts.
  if (exempt) return null;
  const limiter = env && env.RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return null;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `relay:${ip}` });
    if (success) return null;
    return errorResponse(
      429,
      '请求过于频繁。等一分钟再试。',
      'Too many requests. Try again in a minute.',
      request,
      { 'retry-after': '60', 'x-proxy-ratelimit': 'limited' },
    );
  } catch {
    return null;
  }
}

async function fetchWithRetry(url, init) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(url.href, { ...init, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      if (!RETRY_STATUS.has(res.status) || attempt === 2) return res;
      last = res;
    } catch (error) {
      clearTimeout(timer);
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  if (last instanceof Response) return last;
  throw last instanceof Error ? last : new Error('upstream unavailable');
}

/**
 * git needs manual redirects and a replayed body; a plain `redirect: 'follow'`
 * would silently drop the POST payload on a 307.
 */
async function fetchGit(url, request, headers) {
  let current = url;
  let body = request.method === 'POST' ? await request.arrayBuffer() : null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // No `cf` options here: miniflare rejects them, and git responses must
    // never touch the edge cache anyway.
    const res = await fetch(current.href, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || next.hostname !== current.hostname) {
      throw new Error(`git upstream redirected off-origin to ${next.hostname}`);
    }
    // 303 and 301/302 after a POST would drop the request body; git never
    // legitimately needs that, so treat it as an error rather than a silent 200.
    if (request.method === 'POST' && res.status !== 307 && res.status !== 308) {
      throw new Error('git upstream redirected a POST that cannot be replayed');
    }
    current = next;
  }
  throw new Error('git upstream exceeded the redirect limit');
}

async function finalize(response, state) {
  const { request, git } = state;
  const location = response.headers.get('location');

  if (location && !git) {
    const decision = redirectRule(location, { hostKind });
    if (decision.action === REDIRECT.REWRITE) {
      // Relative path form keeps the client on the relay for the next hop.
      const targetPath = decision.url ? `/${decision.url.href}` : '/';
      return new Response(null, {
        status: response.status === 301 ? 301 : 302,
        headers: {
          location: targetPath,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
          'x-proxy-rule': 'redirect',
        },
      });
    }
    if (decision.action === REDIRECT.PASS) {
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    // FOLLOW: the signed asset is fetched here and streamed to the client, so
    // the signature never reaches the address bar and the client spends one
    // round trip instead of two.
    const signed = await followSigned(response, request);
    return finish(signed, state);
  }

  return finish(response, state);
}

/** A Location on an asset host is fetched once, inside the Worker. */
async function followSigned(response, request) {
  let current = response;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (![301, 302, 303, 307, 308].includes(current.status)) return current;
    const location = current.headers.get('location');
    if (!location) return current;
    const decision = redirectRule(location, { hostKind });
    if (decision.action !== REDIRECT.FOLLOW) return current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      current = await fetch(new URL(location).href, {
        method: 'GET',
        headers: upstreamHeaders(request.headers, {}),
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return current;
}

async function finish(response, state) {
  const { request, policy, git, lfs, key, started, ctx } = state;
  const headers = downstreamHeaders(response.headers, {
    policy,
    immutable: policy.label === 'immutable',
  });

  const cacheable = !git && !lfs &&
    isCacheable(
      {
        method: request.method,
        authenticated: false,
        git: false,
        range: request.headers.has('range'),
      },
      response,
      policy,
    );

  headers.set('x-proxy-cache', cacheable ? 'MISS' : 'BYPASS');
  headers.set('server-timing', `edge;dur=${Date.now() - started}`);

  if (git || lfs) {
    headers.set('cache-control', 'no-store');
    headers.set('x-proxy-rule', git ? 'git' : 'lfs');
    headers.delete('set-cookie');
    headers.set('access-control-expose-headers', 'X-Proxy-Cache,X-Proxy-Rule');
  }

  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  if (cacheable && key && edgeCache && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(edgeCache.put(key, out.clone()).catch(() => {}));
  }
  return out;
}
