// Git Smart HTTP classification and the redirect rule set.
// A proxy must only ever expose read-only git: git-upload-pack yes,
// git-receive-pack no — otherwise a shared proxy becomes a push vector into
// other people's repositories.

export const GIT_ROUTE = Object.freeze({
  ORDINARY: 'ordinary',
  DISCOVERY: 'discovery',
  UPLOAD_PACK: 'upload-pack',
  FORBIDDEN: 'forbidden',
});

export const LFS_ROUTE = Object.freeze({
  BATCH: 'lfs-batch',
  TRANSFER: 'lfs-transfer',
  FORBIDDEN: 'forbidden-lfs',
});

const LFS_HOST = 'media.githubusercontent.com';
// `/owner/repo.git/info/lfs/objects/batch`, with or without the `.git` suffix.
const LFS_BATCH = /^\/[^/]+\/[^/]+?(\.git)?\/info\/lfs\/objects\/batch$/;
const LFS_TRANSFER = /^\/[^/]+\/[^/]+?(\.git)?\/info\/lfs\/objects\/(?!batch$)[A-Za-z0-9]+$/;

const DISCOVERY = /^\/[^/]+\/[^/]+\/info\/refs$/;
const UPLOAD_PACK = /^\/[^/]+\/[^/]+\/git-upload-pack$/;
const RECEIVE_PACK = /^\/[^/]+\/[^/]+\/git-receive-pack$/;

/**
 * @param {string} method
 * @param {{host: string, pathname: string}} target
 * @param {URLSearchParams} search
 * @param {Headers} headers
 * @returns {string} one of GIT_ROUTE
 */
export function classifyGit(method, target, search, headers) {
  const m = String(method || '').toUpperCase();
  const isLfs = (headers.get('content-type') || '').toLowerCase().includes('git-lfs');
  if (!target || target.host !== 'github.com') {
    // LFS lives on media.githubusercontent.com, so a POST there is legitimate;
    // classifyLfs decides whether it is allowed.
    if (m === 'POST' && !isLfs) return GIT_ROUTE.FORBIDDEN;
    return GIT_ROUTE.ORDINARY;
  }
  const path = target.pathname || '';

  if (RECEIVE_PACK.test(path)) return GIT_ROUTE.FORBIDDEN;

  if (DISCOVERY.test(path)) {
    const entries = [...search.entries()];
    const onlyUploadPack = entries.length === 1 &&
      entries[0][0] === 'service' &&
      entries[0][1] === 'git-upload-pack';
    return m === 'GET' && onlyUploadPack ? GIT_ROUTE.DISCOVERY : GIT_ROUTE.FORBIDDEN;
  }

  if (UPLOAD_PACK.test(path)) {
    const contentType = (headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    return m === 'POST' && search.toString() === '' &&
      contentType === 'application/x-git-upload-pack-request'
      ? GIT_ROUTE.UPLOAD_PACK
      : GIT_ROUTE.FORBIDDEN;
  }

  if (search.get('service') === 'git-receive-pack') return GIT_ROUTE.FORBIDDEN;
  // LFS batch posts to github.com and is classified separately; leave POST
  // alone here when the caller marks it as LFS so the two classifiers compose.
  if (isLfs) return GIT_ROUTE.ORDINARY;
  return m === 'POST' ? GIT_ROUTE.FORBIDDEN : GIT_ROUTE.ORDINARY;
}

/**
 * Git LFS: the client asks the proxy for an upload/download plan, then transfers
 * bytes against the URLs the plan returns. Batch must be forwarded with the
 * caller's body and credentials; uploads (`PUT`) are refused, because a shared
 * proxy must never accept writes.
 *
 * @param {string} method
 * @param {{host: string, pathname: string}} target
 * @param {Headers} headers
 * @returns {string} one of LFS_ROUTE, or '' when this is not an LFS request
 */
export function classifyLfs(method, target, headers) {
  if (!target) return '';
  const m = String(method || '').toUpperCase();
  const path = target.pathname || '';
  const isLfsPath = LFS_BATCH.test(path) || LFS_TRANSFER.test(path);
  const lfsContentType = /lfs/i.test(headers.get('content-type') || '');
  // Object bytes are plain GETs against the media host: no LFS header at all.
  const mediaHost = target.host === LFS_HOST;
  if (!isLfsPath && !mediaHost) return '';
  if (!isLfsPath && !lfsContentType && !path.startsWith('/media/')) return '';

  if (LFS_BATCH.test(path)) return m === 'POST' ? LFS_ROUTE.BATCH : LFS_ROUTE.FORBIDDEN;
  if (m === 'PUT' || m === 'POST') return LFS_ROUTE.FORBIDDEN;
  if (m === 'GET' || m === 'HEAD') return LFS_ROUTE.TRANSFER;
  return LFS_ROUTE.TRANSFER;
}

/**
 * @param {string} route
 */
export function isGitRoute(route) {
  return route === GIT_ROUTE.DISCOVERY || route === GIT_ROUTE.UPLOAD_PACK;
}

export const REDIRECT = Object.freeze({
  REWRITE: 'rewrite',
  FOLLOW: 'follow',
  PASS: 'pass',
});

/**
 * Decide what to do with an upstream `Location` header.
 *
 * - A GitHub entry URL (github.com / api.github.com / …) is rewritten to a
 *   proxy path so the next hop stays inside the relay.
 * - A signed asset URL (release-assets, objects, …) is followed inside the
 *   Worker: the signature never appears in the address bar and the client
 *   spends one round trip instead of two.
 * - Anything else is passed through untouched.
 *
 * @param {string} location raw Location header
 * @param {{hostKind: (host: string) => string|null}} deps
 * @returns {{action: string, url: URL|null}}
 */
export function redirectRule(location, deps) {
  let url;
  try {
    url = new URL(location);
  } catch {
    return { action: REDIRECT.PASS, url: null };
  }
  if (url.protocol !== 'https:') return { action: REDIRECT.PASS, url: null };
  const kind = deps.hostKind(url.hostname);
  if (kind === 'entry' || kind === 'api') return { action: REDIRECT.REWRITE, url };
  if (kind === 'asset') return { action: REDIRECT.FOLLOW, url };
  return { action: REDIRECT.PASS, url: null };
}
