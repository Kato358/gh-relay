import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTarget,
  parsePastedUrl,
  hostKind,
  acceptsCredentials,
  normalizePath,
} from '../src/target.js';
import { cachePolicy, upstreamHeaders, downstreamHeaders, isCacheable, cacheKey } from '../src/cache.js';
import { classifyGit, redirectRule, isGitRoute, GIT_ROUTE, REDIRECT } from '../src/git.js';

describe('parseTarget', () => {
  it('accepts the full-URL form', () => {
    const r = parseTarget('/https://github.com/o/r/releases/download/v1.2.0/app.zip');
    assert.equal(r.ok, true);
    assert.equal(r.host, 'github.com');
    assert.equal(r.kind, 'entry');
    assert.equal(r.url.href, 'https://github.com/o/r/releases/download/v1.2.0/app.zip');
  });

  it('accepts the host-path form', () => {
    const r = parseTarget('/github.com/o/r/archive/main.zip');
    assert.equal(r.ok, true);
    assert.equal(r.url.href, 'https://github.com/o/r/archive/main.zip');
  });

  it('repairs the collapsed scheme Cloudflare produces', () => {
    const r = parseTarget('/https:/github.com/o/r');
    assert.equal(r.ok, true);
    assert.equal(r.host, 'github.com');
  });

  it('rejects an unsupported host instead of proxying /favicon.ico upstream', () => {
    assert.deepEqual(parseTarget('/favicon.ico'), { ok: false, reason: 'unsupported-host' });
    assert.deepEqual(parseTarget('/robots.txt'), { ok: false, reason: 'unsupported-host' });
    assert.deepEqual(parseTarget('/index.html'), { ok: false, reason: 'unsupported-host' });
  });

  it('rejects embedded credentials', () => {
    assert.deepEqual(parseTarget('/https://user:pass@github.com/o/r'), { ok: false, reason: 'userinfo' });
    // `:443` is canonicalized away by the URL parser; only real ports survive.
    assert.deepEqual(parseTarget('/github.com:8443/o/r'), { ok: false, reason: 'bad-port' });
  });

  it('rejects plain http', () => {
    assert.deepEqual(parseTarget('/http://github.com/o/r'), { ok: false, reason: 'insecure' });
  });

  it('rejects overlong paths', () => {
    assert.deepEqual(parseTarget('/https://github.com/' + 'a'.repeat(5000)), { ok: false, reason: 'too-long' });
  });

  it('strips the fragment so it never reaches upstream', () => {
    const r = parseTarget('/https://github.com/o/r/raw/main/a.js#L10');
    assert.equal(r.ok, true);
    assert.equal(r.url.hash, '');
  });

  it('keeps the query string for API calls', () => {
    const r = parseTarget('/https://api.github.com/repos/o/r/releases?per_page=5');
    assert.equal(r.ok, true);
    assert.equal(r.url.search, '?per_page=5');
    assert.equal(r.kind, 'api');
  });
});

describe('host tables', () => {
  it('classifies every supported host', () => {
    assert.equal(hostKind('github.com'), 'entry');
    assert.equal(hostKind('API.GitHub.com'), 'api');
    assert.equal(hostKind('release-assets.githubusercontent.com'), 'asset');
    assert.equal(hostKind('codeload.github.com'), 'asset');
    assert.equal(hostKind('evil.com'), null);
    assert.equal(hostKind('constructor'), null);
    assert.equal(hostKind('__proto__'), null);
  });

  it('allows credentials only on github.com and api.github.com', () => {
    assert.equal(acceptsCredentials('github.com'), true);
    assert.equal(acceptsCredentials('api.github.com'), true);
    assert.equal(acceptsCredentials('raw.githubusercontent.com'), false);
  });

  it('normalizes Cloudflare path collapsing', () => {
    assert.equal(normalizePath('/https://github.com/x'), 'https://github.com/x');
    assert.equal(normalizePath('/github.com/x'), 'github.com/x');
    assert.equal(normalizePath('/https:/github.com/x'), 'https://github.com/x');
  });
});

describe('parsePastedUrl', () => {
  it('accepts a bare github url', () => {
    assert.deepEqual(parsePastedUrl('github.com/o/r'), { ok: true, target: 'https://github.com/o/r' });
  });

  it('accepts a full url', () => {
    const r = parsePastedUrl('https://raw.githubusercontent.com/o/r/main/a.js');
    assert.equal(r.ok, true);
  });

  it('refuses bare owner/repo: ambiguity with /favicon.ico is real', () => {
    const r = parsePastedUrl('owner/repo');
    assert.equal(r.ok, false);
  });

  it('refuses credentials', () => {
    assert.equal(parsePastedUrl('https://u:p@github.com/o/r').ok, false);
    assert.equal(parsePastedUrl('https://u:p@github.com/o/r').reason, 'userinfo');
  });
});

describe('cachePolicy', () => {
  it('marks tag-pinned release assets immutable', () => {
    const p = cachePolicy('github.com', '/o/r/releases/download/v1.2.0/app.zip');
    assert.equal(p.label, 'immutable');
    assert.equal(p.edge, 31536000);
  });

  it('keeps branch release assets short', () => {
    const p = cachePolicy('github.com', '/o/r/releases/download/latest/app.zip');
    assert.equal(p.label, 'refresh');
  });

  it('treats a SHA raw path as immutable and a branch as refresh', () => {
    assert.equal(cachePolicy('raw.githubusercontent.com', '/o/r/' + 'a'.repeat(40) + '/x.js').label, 'immutable');
    assert.equal(cachePolicy('raw.githubusercontent.com', '/o/r/main/x.js').label, 'refresh');
  });

  it('reads codeload refs', () => {
    assert.equal(cachePolicy('codeload.github.com', '/o/r/tar.gz/refs/tags/v1.0.0').label, 'immutable');
    assert.equal(cachePolicy('codeload.github.com', '/o/r/tar.gz/refs/heads/main').label, 'refresh');
  });

  it('reads github archive refs', () => {
    assert.equal(cachePolicy('github.com', '/o/r/archive/refs/tags/v1.0.0.tar.gz').label, 'immutable');
    assert.equal(cachePolicy('github.com', '/o/r/archive/main.zip').label, 'refresh');
  });

  it('never caches authenticated, git or HEAD traffic', () => {
    assert.equal(cachePolicy('github.com', '/o/r/archive/v1.0.0.zip', { authenticated: true }).label, 'bypass');
    assert.equal(cachePolicy('github.com', '/o/r.git/info/refs', { git: true }).label, 'bypass');
    assert.equal(cachePolicy('github.com', '/o/r/archive/v1.0.0.zip', { method: 'HEAD' }).label, 'bypass');
  });
});

describe('headers', () => {
  it('drops cookies, client IP and hop-by-hop headers upstream', () => {
    const incoming = new Headers({
      cookie: 'session=1',
      'cf-connecting-ip': '1.2.3.4',
      connection: 'keep-alive',
      accept: 'text/html',
      'accept-encoding': 'gzip, br',
    });
    const out = upstreamHeaders(incoming);
    assert.equal(out.has('cookie'), false);
    assert.equal(out.has('cf-connecting-ip'), false);
    assert.equal(out.has('connection'), false);
    assert.equal(out.get('accept'), 'text/html');
    assert.equal(out.get('accept-encoding'), 'identity');
  });

  it('forwards authorization only when the caller allows it', () => {
    const incoming = new Headers({ authorization: 'Bearer t' });
    assert.equal(upstreamHeaders(incoming, { authenticated: true }).get('authorization'), 'Bearer t');
    assert.equal(upstreamHeaders(incoming).has('authorization'), false);
  });

  it('sets a cache-control that matches the policy', () => {
    const p = cachePolicy('github.com', '/o/r/releases/download/v1.0.0/a.zip');
    const h = downstreamHeaders(new Headers({ 'content-type': 'application/zip' }), {
      policy: p,
      immutable: true,
    });
    assert.match(h.get('cache-control'), /immutable/);
    assert.match(h.get('cache-control'), /s-maxage=31536000/);
    assert.equal(h.get('x-proxy-rule'), 'immutable');
  });

  it('strips CSP and request ids so the proxy does not ship a broken policy', () => {
    const h = downstreamHeaders(
      new Headers({
        'content-security-policy': "default-src 'none'",
        'x-github-request-id': 'ABC:123',
      }),
      { policy: cachePolicy('github.com', '/o/r'), immutable: false },
    );
    assert.equal(h.has('content-security-policy'), false);
    assert.equal(h.has('x-github-request-id'), false);
  });

  it('keeps set-cookie out of the shared cache by refusing the write', () => {
    const req = { method: 'GET', authenticated: false, git: false, range: false };
    const policy = cachePolicy('github.com', '/o/r');
    const res = new Response('x', { status: 200, headers: { 'set-cookie': 'a=1' } });
    assert.equal(isCacheable(req, res, policy), false);
  });

  it('refuses to cache responses that carry set-cookie', () => {
    const req = { method: 'GET', authenticated: false, git: false, range: false };
    const policy = cachePolicy('github.com', '/o/r');
    assert.equal(isCacheable(req, new Response('x', { status: 200 }), policy), true);
    assert.equal(
      isCacheable(req, new Response('x', { status: 200, headers: { 'set-cookie': 'a=1' } }), policy),
      false,
    );
    assert.equal(isCacheable({ ...req, range: true }, new Response('x', { status: 200 }), policy), false);
    assert.equal(isCacheable(req, new Response('x', { status: 404 }), policy), false);
  });

  it('builds a key without a date component', () => {
    const a = cacheKey('https://p.dev/https://github.com/o/r/a.zip');
    assert.match(a, /__enc=identity/);
    assert.doesNotMatch(a, /__v=/);
  });
});

describe('classifyGit', () => {
  const t = (pathname) => ({ host: 'github.com', pathname });

  it('accepts read-only discovery', () => {
    const s = new URLSearchParams('service=git-upload-pack');
    assert.equal(classifyGit('GET', t('/o/r.git/info/refs'), s, new Headers()), GIT_ROUTE.DISCOVERY);
  });

  it('rejects discovery with extra query parameters', () => {
    const s = new URLSearchParams('service=git-upload-pack&extra=1');
    assert.equal(classifyGit('GET', t('/o/r.git/info/refs'), s, new Headers()), GIT_ROUTE.FORBIDDEN);
  });

  it('rejects receive-pack outright', () => {
    assert.equal(classifyGit('POST', t('/o/r.git/git-receive-pack'), new URLSearchParams(), new Headers()), GIT_ROUTE.FORBIDDEN);
    assert.equal(
      classifyGit('GET', t('/o/r.git/info/refs'), new URLSearchParams('service=git-receive-pack'), new Headers()),
      GIT_ROUTE.FORBIDDEN,
    );
  });

  it('requires the upload-pack content type', () => {
    const ok = new Headers({ 'content-type': 'application/x-git-upload-pack-request' });
    const bad = new Headers({ 'content-type': 'application/json' });
    const s = new URLSearchParams();
    assert.equal(classifyGit('POST', t('/o/r.git/git-upload-pack'), s, ok), GIT_ROUTE.UPLOAD_PACK);
    assert.equal(classifyGit('POST', t('/o/r.git/git-upload-pack'), s, bad), GIT_ROUTE.FORBIDDEN);
  });

  it('rejects POST anywhere else', () => {
    assert.equal(classifyGit('POST', t('/o/r/issues'), new URLSearchParams(), new Headers()), GIT_ROUTE.FORBIDDEN);
    assert.equal(classifyGit('GET', t('/o/r'), new URLSearchParams(), new Headers()), GIT_ROUTE.ORDINARY);
    assert.equal(isGitRoute(GIT_ROUTE.ORDINARY), false);
  });
});

describe('redirectRule', () => {
  const deps = { hostKind };
  it('rewrites entry redirects back into the proxy', () => {
    assert.equal(redirectRule('https://github.com/o/r/archive/main.zip', deps).action, REDIRECT.REWRITE);
  });
  it('follows signed asset redirects internally', () => {
    assert.equal(redirectRule('https://release-assets.githubusercontent.com/x?sig=1', deps).action, REDIRECT.FOLLOW);
  });
  it('passes foreign and insecure redirects through', () => {
    assert.equal(redirectRule('https://evil.example/x', deps).action, REDIRECT.PASS);
    assert.equal(redirectRule('http://github.com/o/r', deps).action, REDIRECT.PASS);
    assert.equal(redirectRule('not a url', deps).action, REDIRECT.PASS);
  });
});

describe('route prefixes (unit)', () => {
  it('maps each prefix to its host and strips the prefix', async () => {
    const { applyPrefix } = await import('../src/target.js');
    assert.deepEqual(applyPrefix('/gh/o/r'), { path: '/o/r', host: 'github.com' });
    assert.deepEqual(applyPrefix('/raw/o/r/main/a.js'), { path: '/o/r/main/a.js', host: 'raw.githubusercontent.com' });
    assert.deepEqual(applyPrefix('/api/repos/o/r'), { path: '/repos/o/r', host: 'api.github.com' });
    assert.deepEqual(applyPrefix('/lfs/o/r/x'), { path: '/o/r/x', host: 'media.githubusercontent.com' });
    assert.deepEqual(applyPrefix('/https://github.com/o/r'), { path: '/https://github.com/o/r', host: null });
  });

  it('parses a prefixed path without doubling the host', async () => {
    const { applyPrefix } = await import('../src/target.js');
    const a = applyPrefix('/raw/o/r/main/a.js');
    const b = parseTarget(a.path, { host: a.host });
    assert.equal(b.ok, true);
    assert.equal(b.url.href, 'https://raw.githubusercontent.com/o/r/main/a.js');
    const c = applyPrefix('/raw/raw.githubusercontent.com/o/r/main/a.js');
    const d = parseTarget(c.path, { host: c.host });
    assert.equal(d.url.href, 'https://raw.githubusercontent.com/o/r/main/a.js');
  });
});

describe('lfs classification (unit)', () => {
  it('routes batch, transfer and uploads', async () => {
    const { classifyLfs, LFS_ROUTE } = await import('../src/git.js');
    const h = new Headers({ 'content-type': 'application/vnd.git-lfs+json' });
    assert.equal(classifyLfs('POST', { host: 'github.com', pathname: '/o/r.git/info/lfs/objects/batch' }, h), LFS_ROUTE.BATCH);
    assert.equal(classifyLfs('PUT', { host: 'media.githubusercontent.com', pathname: '/o/r.git/info/lfs/objects/abc' }, h), LFS_ROUTE.FORBIDDEN);
    assert.equal(classifyLfs('GET', { host: 'media.githubusercontent.com', pathname: '/media/o/r/main/f.bin' }, new Headers()), LFS_ROUTE.TRANSFER);
    assert.equal(classifyLfs('GET', { host: 'github.com', pathname: '/o/r' }, h), '');
  });
});

describe('settings (unit)', () => {
  it('parses inline NAME=value lines with quotes and comments', async () => {
    const { parseInlineConfig } = await import('../src/config.js');
    const parsed = parseInlineConfig('# comment\nMASK="nginx"\n\nURL302 = https://a.b/\nnovalue');
    assert.deepEqual(parsed, { MASK: 'nginx', URL302: 'https://a.b/' });
  });

  it('prefers env over inline values', async () => {
    const { readSettings } = await import('../src/config.js');
    const s = readSettings({ MASK: 'https://x.test/' }, { MASK: 'nginx' });
    assert.equal(s.mode, 'mask');
    assert.equal(s.maskUrl, 'https://x.test/');
  });

  it('treats MASK302 as redirect mode and never as a mask page', async () => {
    const { readSettings } = await import('../src/config.js');
    const s = readSettings({ MASK: 'nginx', MASK302: 'https://t.me/x' });
    assert.equal(s.mode, 'redirect');
    assert.equal(s.redirectTo, 'https://t.me/x');
  });
});

describe('ALLOW_HOSTS (unit)', () => {
  it('accepts registered hosts as asset hosts and rejects everything else', async () => {
    const { registerHosts, parseTarget } = await import('../src/target.js');
    registerHosts(['files.example.com', 'evil host', '__proto__']);
    const ok = parseTarget('/https://files.example.com/a/b.bin');
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, 'asset');
    assert.equal(parseTarget('/https://evil host/a').ok, false);
    assert.equal(parseTarget('/https://__proto__/a').ok, false);
    assert.equal(parseTarget('/https://other.example.com/a').ok, false);
  });

  it('never sends credentials to an allowed custom host', async () => {
    const { registerHosts, acceptsCredentials } = await import('../src/target.js');
    registerHosts(['files.example.com']);
    assert.equal(acceptsCredentials('files.example.com'), false);
  });
});
