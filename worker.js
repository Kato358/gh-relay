// Entry point. Routing is a hand-rolled table on purpose: a framework would
// cost ~8 KB gzipped and 2.6x the dispatch time to save these branches.

import { parsePastedUrl, registerHosts } from './src/target.js';
import { handleProxy, statsSnapshot } from './src/proxy.js';
import { HOSTS } from './src/target.js';
import { renderHomepage } from './src/home.js';
import {
  EXAMPLES, COMMANDS, HOST_TABLE, PREFIX_TABLE, VARIABLES, LEAD, WORDMARK, ERRORS,
} from './src/home-copy.js';
import { readSettings, parseInlineConfig, isBlockedUa, NGINX_PAGE } from './src/config.js';

// Paste-time configuration. A one-file deployment has no bindings, so settings
// live in this string:
//
//   const INLINE_CONFIG = `MASK=nginx`;   // or `BLOCK_UA=netcraft,curl`
//
// Wrangler deployments should use [vars] instead; env wins over this string.
const INLINE_CONFIG = '';

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" fill="#14161b"/>
<rect x="6" y="13" width="12" height="6" fill="#ffce2b"/>
<rect x="20" y="13" width="6" height="6" fill="#ecedea"/>
</svg>`;

const settingsCache = new WeakMap();

function settingsFor(env) {
  let fresh;
  if (env && typeof env === 'object') {
    const cached = settingsCache.get(env);
    if (cached) return cached;
    fresh = readSettings(env, parseInlineConfig(INLINE_CONFIG));
    settingsCache.set(env, fresh);
  } else {
    fresh = readSettings({}, parseInlineConfig(INLINE_CONFIG));
  }
  if (fresh.allowHosts.length) registerHosts(fresh.allowHosts);
  return fresh;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const settings = settingsFor(env);

    // Crawlers we were told to keep out get the mask page, never a proxy.
    if (isBlockedUa(request, settings)) {
      return maskPage(settings, request);
    }

    // Homepage form target: `/?q=<github url>` → 301 to the proxied path.
    const pasted = url.searchParams.get('q') ?? url.searchParams.get('url');
    if (pasted !== null) {
      const parsed = parsePastedUrl(pasted);
      if (!parsed.ok) {
        const [zh, en] = ERRORS[parsed.reason] || ERRORS['bad-url'];
        return new Response(`${zh}\n${en}\n`, {
          status: 400,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return Response.redirect(`${url.origin}/${parsed.target}`, 301);
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (url.pathname === '/health') return health();
      if (url.pathname === '/stats') return stats(settings);
      if (url.pathname === '/') return homepage(request, settings);
      if (url.pathname === '/index.html') return homepage(request, settings);
      if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
        return new Response(request.method === 'HEAD' ? null : FAVICON, {
          headers: {
            'content-type': 'image/svg+xml',
            'cache-control': 'public, max-age=604800, immutable',
          },
        });
      }
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /\n', {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
        });
      }
    }

    const response = await handleProxy(request, env, ctx);
    if (response.status === 400 && url.pathname !== '/') {
      // A 400 on a path that is not a proxy target is a navigation mistake, not
      // an upstream failure: point at the supported hosts instead of a dead end.
      if (settings.mode !== 'relay') return maskPage(settings, request);
      return guidance(url.origin);
    }
    return response;
  },
};

function health() {
  return new Response('ok\n', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-proxy-health': 'ok',
    },
  });
}

function stats(settings) {
  return new Response(
    JSON.stringify(
      {
        ...statsSnapshot(),
        mode: settings.mode,
        rateLimit: settings.rateLimit,
        blockUa: settings.blockUa.length,
      },
      null,
      2,
    ),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

async function maskPage(settings, request) {
  if (settings.mode === 'redirect' && settings.redirectTo) {
    return Response.redirect(settings.redirectTo, 302);
  }
  if (settings.maskNginx) {
    return new Response(request.method === 'HEAD' ? null : NGINX_PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  }
  if (settings.mode === 'mask' && settings.maskUrl) {
    try {
      return await fetch(settings.maskUrl, {
        headers: { 'user-agent': request.headers.get('user-agent') || '' },
      });
    } catch {
      return new Response('upstream unavailable\n', { status: 502 });
    }
  }
  return new Response('not found\n', { status: 404 });
}

async function homepage(request, settings) {
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const html = await renderHomepage({
    headline: ['粘贴一个 GitHub 地址，', '拿回一个能下载的地址。'],
    lead: LEAD,
    wordmark: WORDMARK,
    hostTable: HOST_TABLE,
    prefixTable: PREFIX_TABLE,
    variables: VARIABLES,
    examples: EXAMPLES,
    commands: COMMANDS,
    rateLimit: settings.rateLimit,
  });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=1800, s-maxage=3600',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'self'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

function guidance(origin) {
  const hosts = Object.keys(HOSTS)
    .map((host) => `  ${origin}/https://${host}/...`)
    .join('\n');
  const prefixes = ['gh', 'raw', 'api', 'lfs'].map((p) => `  ${origin}/${p}/...`).join('\n');
  return new Response(
    `这个路径不是代理地址。\n\n完整写法：\n${hosts}\n\n短写法：\n${prefixes}\n\nThis path is not a proxy target. Append a full GitHub URL.\n`,
    {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}
