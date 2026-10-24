// Post-deploy smoke check: fetch the live homepage and assert the shipped
// markup matches the template (no third-party font, no stale copy).
const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/verify-live.mjs <url>');
  process.exit(1);
}

const res = await fetch(url, { redirect: 'manual' });
const html = await res.text();

const resultBlock = html.match(/<output class="result-box" id="result"[\s\S]*?<\/output>/)?.[0] || '';
const labelBlock = html.match(/<div class="result-label">[\s\S]*?<\/div>/)?.[0] || '';

const checks = [
  ['status 200', res.status === 200],
  ['content-type html', /text\/html; charset=utf-8/.test(res.headers.get('content-type') || '')],
  ['csp present', /default-src 'none'/.test(res.headers.get('content-security-policy') || '')],
  ['headline', html.includes('粘贴一个 GitHub 地址')],
  ['inlined font', /data:font\/woff2;base64,/.test(html)],
  ['no third-party font', !/fonts\.googleapis|fonts\.gstatic/.test(html)],
  ['indigo accent token', /--accent: #4a45d6/.test(html)],
  ['dark accent token', /--accent: #8f8aff/.test(html)],
  ['theme-color meta', /name="theme-color"/.test(html)],
  ['skip link', html.includes('跳到中转工具')],
  ['command empty state', html.includes('粘贴地址后这里显示命令')],
  ['no dead marker token', !/--marker:/.test(html)],
  ['copy buttons hidden at rest', /id="copy"[^>]*hidden/.test(html) && /id="copy-command"[^>]*hidden/.test(html)],
  ['copy button inside result box', resultBlock.includes('id="copy"')],
  ['result text precedes copy', resultBlock.indexOf('id="result-text"') < resultBlock.indexOf('id="copy"')],
  ['label holds no copy button', labelBlock.includes('可访问地址') && !labelBlock.includes('<button')],
  ['footnote removed', !html.includes('这个页面就是一次请求') && !/class="footnote"/.test(html)],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}

console.log(`\ncache-control: ${res.headers.get('cache-control')}`);
console.log(`bytes: ${html.length}`);
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
