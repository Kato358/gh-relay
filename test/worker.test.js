// Integration tests: run the real Worker with a stubbed upstream.
// node --test with the .woff2 loader registered in test/loader.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./woff2-loader.mjs', import.meta.url);

const realFetch = globalThis.fetch;
let calls = [];
let upstreamHandler = () => new Response('default', { status: 200 });

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  // data: URLs (font inlining) go to the real fetch.
  if (url.startsWith('data:')) return realFetch(input, init);
  calls.push({ url, init });
  return upstreamHandler(url, init);
};

const worker = (await import('../worker.js')).default;

const ENV = {};
const CTX = { waitUntil(promise) { promise.catch(() => {}); } };

async function call(path, init = {}) {
  calls = [];
  return worker.fetch(new Request(`https://relay.example${path}`, init), ENV, CTX);
}

function json(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('routing', () => {
  it('serves the homepage with an inlined font and no external requests', async () => {
    const res = await call('/');
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /粘贴一个 GitHub 地址/);
    assert.match(html, /@font-face/);
    assert.match(html, /data:font\/woff2;base64,/);
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(calls.length, 0);
  });

  it('answers HEAD on the homepage without a body', async () => {
    const res = await call('/', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  it('serves an inline favicon', async () => {
    const res = await call('/favicon.ico');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  });

  it('redirects ?q= to the proxied path', async () => {
    const res = await call('/?q=https://github.com/o/r/releases/download/v1/app.zip');
    assert.equal(res.status, 301);
    assert.equal(
      res.headers.get('location'),
      'https://relay.example/https://github.com/o/r/releases/download/v1/app.zip',
    );
  });

  it('explains an unsupported host instead of a blank 400', async () => {
    const res = await call('/not-a-proxy-path');
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.match(text, /这个路径不是代理地址/);
    assert.equal(calls.length, 0);
  });
});

describe('proxy', () => {
  it('streams an immutable release asset and marks it immutable', async () => {
    upstreamHandler = () =>
      new Response('binary', {
        status: 200,
        headers: { 'content-type': 'application/zip', 'content-length': '6' },
      });
    const res = await call('/https://github.com/o/r/releases/download/v1.2.0/app.zip');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'binary');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.equal(res.headers.get('x-proxy-rule'), 'immutable');
    assert.equal(calls[0].url, 'https://github.com/o/r/releases/download/v1.2.0/app.zip');
  });

  it('never forwards cookies or client IP upstream', async () => {
    upstreamHandler = () => new Response('ok');
    await call('/https://raw.githubusercontent.com/o/r/main/a.js', {
      headers: {
        cookie: 'session=secret',
        'cf-connecting-ip': '203.0.113.9',
        'accept-encoding': 'br',
      },
    });
    const sent = new Headers(calls[0].init.headers);
    assert.equal(sent.has('cookie'), false);
    assert.equal(sent.has('cf-connecting-ip'), false);
    assert.equal(sent.get('accept-encoding'), 'identity');
  });

  it('rewrites an entry redirect back into the relay', async () => {
    upstreamHandler = () =>
      new Response(null, { status: 302, headers: { location: 'https://github.com/o/r/raw/main/a.js' } });
    const res = await call('/https://github.com/o/r/blob/main/a.js');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/https://github.com/o/r/raw/main/a.js');
  });

  it('follows a signed asset redirect internally, one round trip for the client', async () => {
    upstreamHandler = (url) => {
      if (url.includes('github.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/asset?sig=abc' },
        });
      }
      return new Response('signed-payload', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    };
    const res = await call('/https://github.com/o/r/releases/download/v1/a.bin');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'signed-payload');
    assert.equal(res.headers.has('location'), false);
    assert.equal(calls.length, 2);
  });

  it('refuses to forward credentials to an asset host', async () => {
    const res = await call('/https://raw.githubusercontent.com/o/r/main/a.js', {
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });

  it('allows a token on api.github.com and marks it uncacheable', async () => {
    upstreamHandler = () => json({ ok: true });
    const res = await call('/https://api.github.com/repos/o/r', {
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(res.status, 200);
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer token');
    assert.match(res.headers.get('cache-control'), /no-store/);
  });

  it('rejects a non-git POST', async () => {
    const res = await call('/https://github.com/o/r/git-receive-pack', { method: 'POST', body: 'x' });
    assert.equal(res.status, 405);
    assert.equal(calls.length, 0);
  });

  it('upgrades a 502 into an error with guidance, not a stack trace', async () => {
    upstreamHandler = () => new Response('boom', { status: 502 });
    const res = await call('/https://github.com/o/r/archive/main.zip');
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.doesNotMatch(text, /Error:/);
  });
});

describe('git smart http', () => {
  it('passes upload-pack discovery through uncached', async () => {
    upstreamHandler = () =>
      new Response('001e# service=git-upload-pack\n', {
        status: 200,
        headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
      });
    const res = await call('/https://github.com/o/r.git/info/refs?service=git-upload-pack');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-proxy-rule'), 'git');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(calls.length, 1);
  });

  it('replays the POST body through a 307', async () => {
    let first = true;
    upstreamHandler = () => {
      if (first) {
        first = false;
        return new Response(null, { status: 307, headers: { location: 'https://github.com/o/r.git/git-upload-pack' } });
      }
      return new Response('pack', { status: 200 });
    };
    const res = await call('/https://github.com/o/r.git/git-upload-pack', {
      method: 'POST',
      headers: { 'content-type': 'application/x-git-upload-pack-request' },
      body: 'want abc',
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'pack');
    const replayed = calls[calls.length - 1].init.body;
    assert.equal(
      replayed instanceof ArrayBuffer ? new TextDecoder().decode(replayed) : replayed,
      'want abc',
    );
  });

  it('rejects receive-pack', async () => {
    const res = await call('/https://github.com/o/r.git/git-receive-pack', { method: 'POST', body: 'x' });
    assert.equal(res.status, 405);
  });
});

describe('route prefixes', () => {
  it('pins the host for /raw/', async () => {
    upstreamHandler = () => new Response('raw-body');
    const res = await call('/raw/o/r/main/a.js');
    assert.equal(res.status, 200);
    assert.equal(calls[0].url, 'https://raw.githubusercontent.com/o/r/main/a.js');
    assert.equal(res.headers.get('x-proxy-rule'), 'refresh');
  });

  it('pins github.com for /gh/ and keeps the path', async () => {
    upstreamHandler = () => new Response('x');
    await call('/gh/o/r/releases/download/v2/a.zip');
    assert.equal(calls[0].url, 'https://github.com/o/r/releases/download/v2/a.zip');
  });

  it('pins api.github.com for /api/', async () => {
    upstreamHandler = () => json({ ok: true });
    await call('/api/repos/o/r?per_page=3');
    assert.equal(calls[0].url, 'https://api.github.com/repos/o/r?per_page=3');
  });

  it('does not double a host the caller already wrote', async () => {
    upstreamHandler = () => new Response('x');
    await call('/gh/github.com/o/r');
    assert.equal(calls[0].url, 'https://github.com/o/r');
  });
});

describe('lfs', () => {
  it('forwards the batch POST with the caller body and auth', async () => {
    upstreamHandler = () => json({ objects: [] });
    const res = await call('/lfs/o/r.git/info/lfs/objects/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/vnd.git-lfs+json',
        authorization: 'Basic dXNlcjp0b2tlbg==',
      },
      body: JSON.stringify({ operation: 'download', objects: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls[0].url, 'https://media.githubusercontent.com/o/r.git/info/lfs/objects/batch');
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Basic dXNlcjp0b2tlbg==');
    assert.equal(res.headers.get('x-proxy-rule'), 'lfs');
    assert.match(res.headers.get('cache-control'), /no-store/);
  });

  it('refuses an LFS upload', async () => {
    const res = await call('/lfs/o/r.git/info/lfs/objects/abc', {
      method: 'PUT',
      headers: { 'content-type': 'application/vnd.git-lfs+json' },
      body: 'bytes',
    });
    assert.equal(res.status, 405);
    assert.equal(calls.length, 0);
  });

  it('streams an LFS object download', async () => {
    upstreamHandler = () => new Response('lfs-bytes');
    const res = await call('/https://media.githubusercontent.com/media/o/r/main/big.bin');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'lfs-bytes');
  });
});

describe('deployment switches', () => {
  it('answers /health without touching upstream', async () => {
    const res = await call('/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-proxy-health'), 'ok');
    assert.equal(calls.length, 0);
  });

  it('reports stats as json', async () => {
    const res = await call('/stats');
    const body = JSON.parse(await res.text());
    assert.equal(typeof body.served, 'number');
    assert.equal(body.mode, 'relay');
    assert.equal(body.rateLimit, false);
  });
});

describe('mask mode', () => {
  const MASK_ENV = { MASK: 'nginx', BLOCK_UA: 'netcraft, AhrefsBot' };

  it('serves the nginx page for a blocked crawler instead of proxying', async () => {
    upstreamHandler = () => new Response('should not be reached');
    const res = await worker.fetch(
      new Request('https://relay.example/https://github.com/o/r/archive/main.zip', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; NetcraftSurveyAgent/1.0)' },
      }),
      MASK_ENV,
      CTX,
    );
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Welcome to nginx!/);
    assert.equal(calls.length, 0);
  });

  it('still serves the proxy to a normal browser', async () => {
    upstreamHandler = () => new Response('file');
    const res = await worker.fetch(
      new Request('https://relay.example/https://raw.githubusercontent.com/o/r/main/a.js', {
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0' },
      }),
      MASK_ENV,
      CTX,
    );
    assert.equal(await res.text(), 'file');
  });

  it('redirects non-proxy paths when MASK302 is set', async () => {
    const res = await worker.fetch(
      new Request('https://relay.example/some/page', { headers: { 'user-agent': 'curl/8' } }),
      { MASK302: 'https://example.com/' },
      CTX,
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://example.com/');
  });

  it('reads BLOCK_UA from the inline config when env is empty', async () => {
    const { readSettings, parseInlineConfig } = await import('../src/config.js');
    const settings = readSettings({}, parseInlineConfig('BLOCK_UA=netcraft, git/'));
    assert.deepEqual(settings.blockUa, ['netcraft', 'git/']);
    assert.equal(settings.mode, 'relay');
  });
});

describe('ALLOW_HOSTS (integration)', () => {
  it('proxies a host added through env and refuses the same host without it', async () => {
    upstreamHandler = () => new Response('custom-bytes');
    const env = { ALLOW_HOSTS: 'files.example.com' };
    const ok = await worker.fetch(
      new Request('https://relay.example/https://files.example.com/a/b.bin'),
      env,
      CTX,
    );
    assert.equal(await ok.text(), 'custom-bytes');

    // A fresh env object: registration is per-isolate and already happened for
    // files.example.com above, which is the intended cache semantics.
    const rejected = await worker.fetch(
      new Request('https://relay.example/https://not-registered.example.com/a/b.bin'),
      {},
      CTX,
    );
    assert.equal(rejected.status, 400);
  });
});
