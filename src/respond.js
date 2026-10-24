// Response helpers: errors in one shape, one voice, both languages.
// Copy rule: say what happened, then what to do. No apology, no "oops".

const JSON_ERROR = { 'content-type': 'application/json; charset=utf-8' };

/**
 * Human-readable error. Plain text for the address bar, JSON for API clients.
 *
 * @param {number} status
 * @param {string} zh
 * @param {string} en
 * @param {Request} request
 * @param {Record<string, string>} [extra]
 */
export function errorResponse(status, zh, en, request, extra = {}) {
  const wantsJson = (request.headers.get('accept') || '').includes('application/json') ||
    new URL(request.url).pathname.startsWith('/api.github.com/');
  const body = wantsJson ? JSON.stringify({ error: en, message: zh, status }) : `${zh}\n${en}\n`;
  return new Response(body, {
    status,
    headers: {
      'content-type': wantsJson ? JSON_ERROR['content-type'] : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}
