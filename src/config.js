// Runtime settings. Everything is optional: with no variables and no bindings
// the Worker still serves files, and the homepage says so instead of failing.

/**
 * @typedef {Object} Settings
 * @property {string} mode       'relay' | 'mask' | 'redirect'
 * @property {string} maskUrl    page served for non-proxy paths in mask mode
 * @property {string} maskNginx  true when MASK=nginx
 * @property {string} redirectTo target for `MASK302`
 * @property {string[]} blockUa  substrings (lowercase) that get the mask page
 * @property {boolean} rateLimit binding present
 * @property {string[]} allowHosts extra hosts appended to the default table
 */

const UA_LIMIT = 64;

/**
 * Parse `NAME=value` pairs pasted into the Worker editor. A one-file deployment
 * cannot mount a KV binding, so this is the only way to configure it there.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseInlineConfig(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toUpperCase();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) out[key] = value;
  }
  return out;
}

/**
 * @param {{[key: string]: unknown}} env
 * @param {Record<string, string>} [inline] values from INLINE_CONFIG
 * @returns {Settings}
 */
export function readSettings(env, inline = {}) {
  const e = env || {};
  const get = (name) => {
    const raw = e[name] ?? inline[name];
    return raw === undefined || raw === null ? '' : String(raw).trim();
  };

  const mask = get('MASK');
  const redirectTo = get('MASK302') || get('URL302');
  const maskUrl = get('URL');

  let mode = 'relay';
  if (redirectTo && /^https?:\/\//i.test(redirectTo)) mode = 'redirect';
  else if (mask && mask.toLowerCase() !== 'nginx') mode = 'mask';
  else if (mask.toLowerCase() === 'nginx' || maskUrl.toLowerCase() === 'nginx') mode = 'mask';

  // Commas and/or whitespace separate entries; values may contain `/` and `-`
  // (e.g. `AhrefsBot`, `git/`), so only those two characters split.
  const blockUa = get('BLOCK_UA')
    .split(/[,\s]+/)
    .map((v) => v.toLowerCase())
    .filter(Boolean)
    .slice(0, UA_LIMIT);

  return {
    mode,
    maskUrl: mode === 'mask' && mask && mask.toLowerCase() !== 'nginx' ? mask : maskUrl,
    maskNginx: mask.toLowerCase() === 'nginx' || maskUrl.toLowerCase() === 'nginx',
    redirectTo: mode === 'redirect' ? redirectTo : '',
    blockUa,
    rateLimit: Boolean(e.RATE_LIMITER),
    allowHosts: get('ALLOW_HOSTS')
      .split(/[,\s]+/)
      .map((v) => v.toLowerCase())
      .filter(Boolean),
  };
}

/** True when the request looks like a crawler we were told to keep out. */
export function isBlockedUa(request, settings) {
  if (!settings.blockUa.length) return false;
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return settings.blockUa.some((needle) => ua.includes(needle));
}

export const NGINX_PAGE = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="https://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="https://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;
