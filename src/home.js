/**
 * The homepage: one tool, no chrome.
 *
 * Layout notes
 * - Cool paper ground, white card for the tool, one indigo accent used for the
 *   injected host segment, the submit button and section links. The command
 *   panel stays ink-dark in both schemes so the copyable line reads as code.
 * - The hero is the tool itself; the headline sits above it and never repeats
 *   what the result field already shows.
 * - No-JS contract: the form is a real GET form with `name="q"`; the Worker
 *   answers `/?q=…` with a 301, so the page works without JavaScript.
 */

import { displayFont } from './font.js';

export const HTML_HEAD = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5fa">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#080a0f">
<meta name="description" content="GitHub 文件中转：release、raw、archive、gist、API 与只读 git clone。">
<title>GitHub 文件中转</title>`;

export const HTML_TAIL = `</body>
</html>`;

export function documentShell(fontCss) {
  return `
<style>
/* ===== tokens ===== */
:root {
  color-scheme: light;
  --paper: #f4f5fa;
  --card: #ffffff;
  --surface: #f1f3f8;
  --sunken: #eef0f6;
  --ink: #0f1117;
  --ink-2: #39414f;
  --muted: #5b6472;
  --line: #dfe3ec;
  --line-strong: #c9d0dc;
  --accent: #4a45d6;
  --accent-hover: #3a35bd;
  --accent-ink: #ffffff;
  --ok: #12864a;
  --ok-soft: #e8f6ee;
  --danger: #b3251e;
  --danger-soft: #fdf1f0;
  --focus: #4a45d6;
  --ring: rgba(74, 69, 214, .18);
  --seg-active: #ffffff;
  --glow: rgba(74, 69, 214, .10);
  --shadow: 0 1px 2px rgba(15, 17, 23, .05), 0 18px 40px -28px rgba(15, 17, 23, .45);
  /* The command panel is ink-dark in both schemes: one fixed set of tokens. */
  --code: #0f141c;
  --code-line: #232b3a;
  --code-ink: #e3eaf7;
  /* The panel ground never changes, so its chip needs the light accent in both
     schemes: the indigo used on paper would sit at 2.7:1 against it. */
  --code-chip: #a5a1ff;
  --code-chip-ink: #0a0c11;
  --code-btn: #1a2130;
  --code-btn-hover: #232c3e;
  --code-btn-line: #2b3446;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper: #080a0f;
    --card: #10141b;
    --surface: #171d27;
    --sunken: #0c1118;
    --ink: #eef1f6;
    --ink-2: #cbd3df;
    --muted: #98a2b2;
    --line: #232a37;
    --line-strong: #313a4b;
    --accent: #8f8aff;
    --accent-hover: #a5a1ff;
    --accent-ink: #0a0c11;
    --ok: #4ad686;
    --ok-soft: #10241a;
    --danger: #ff9b91;
    --danger-soft: #241315;
    --focus: #a9a5ff;
    --ring: rgba(143, 138, 255, .26);
    --seg-active: #232b38;
    --glow: rgba(143, 138, 255, .12);
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 20px 44px -30px rgba(0, 0, 0, .9);
    --code: #0b0f16;
    --code-line: #1e2635;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background:
    radial-gradient(1200px 520px at 50% -220px, var(--glow), transparent 70%),
    var(--paper);
  background-repeat: no-repeat;
  color: var(--ink);
  font: 400 16.5px/1.75 "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  font-feature-settings: "palt" 1;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
button, input { touch-action: manipulation; }
.page { max-width: 880px; margin: 0 auto; padding: 0 24px 80px; }
a { color: var(--accent); text-underline-offset: 3px; }
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ===== masthead ===== */
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 0 16px;
}
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .01em;
}
.wordmark::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--ring);
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 4px 11px;
}
.status::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line-strong);
}
.status--on::before {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}

/* ===== hero ===== */
.hero { padding: 40px 0 0; }
.headline {
  font-family: var(--display);
  font-weight: 700;
  font-size: clamp(30px, 4.6vw, 50px);
  line-height: 1.24;
  letter-spacing: -.01em;
  margin: 0;
  max-width: 15em;
  color: var(--ink);
  text-wrap: balance;
}
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .headline {
    background: linear-gradient(96deg, var(--ink) 34%, var(--accent));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
/* Both sentences share one bounding box; each breaks on its own comma. */
.headline span { display: inline; }
.headline span + span::before { content: " "; }
.lead {
  margin: 16px 0 0;
  max-width: 36em;
  color: var(--muted);
  font-size: 15.5px;
  text-wrap: pretty;
}

/* ===== tool ===== */
.tool {
  margin-top: 28px;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 16px;
  padding: 20px 20px 22px;
  box-shadow: var(--shadow);
  scroll-margin-top: 16px;
}
.field { position: relative; }
label.field-label {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .02em;
  color: var(--muted);
  margin-bottom: 7px;
}
.input-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  border-radius: 10px;
  padding: 0 6px 0 14px;
  min-height: 54px;
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}
.input-shell:hover { border-color: var(--muted); }
.input-shell:focus-within {
  border-color: var(--accent);
  background: var(--card);
  box-shadow: 0 0 0 4px var(--ring);
}
.input-shell input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 13.5px;
  padding: 15px 0;
}
.input-shell input:focus { outline: none; }
.input-shell input::placeholder { color: var(--muted); opacity: 1; }

.ghost-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 12px;
  min-height: 36px;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.ghost-button[hidden] { display: none; }
.ghost-button:hover { border-color: var(--muted); color: var(--ink); background: var(--surface); }
.ghost-button:active { transform: translateY(.5px); }
.ghost-button[data-done="true"] { border-color: var(--ok); color: var(--ok); background: var(--ok-soft); }

/* The one filled button on the page: the submit control. */
#tool button[type="submit"] {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
  padding: 7px 18px;
  box-shadow: 0 1px 2px rgba(15, 17, 23, .18);
}
#tool button[type="submit"]:hover {
  background: var(--accent-hover);
  border-color: transparent;
  color: var(--accent-ink);
}
#tool button[type="submit"]:active { transform: translateY(.5px); }

.result { margin-top: 18px; }
.result-label {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .02em;
  color: var(--muted);
  margin-bottom: 7px;
}
/* <output> is inline by default: as an inline box its border wraps only the
   first line and long text spills outside the frame. Block it. The box is a
   flex row so the copy button can sit inside the frame without taking part in
   the text flow. */
.result-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--sunken);
  padding: 8px 8px 8px 14px;
  min-height: 52px;
}
.result-box[hidden] { display: none; }
/* Only the text scrolls: a hostname wider than the box must not widen the
   page, and the button must stay reachable while it does. */
.result-text {
  flex: 1;
  min-width: 0;
  padding: 5px 0;
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: normal;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
/* The marker is one indivisible token. Letting it break across lines produces
   two half-filled boxes that read as an overlap, so it stays on one line and
   scrolls with its parent instead. It is filled with the accent rather than a
   tint: the sunken ground is near-white (near-black in dark) and a tint would
   disappear into it. */
.result-text .prefix {
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 5px;
  padding: 2px 6px;
  white-space: nowrap;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.command code .prefix {
  background: var(--code-chip);
  color: var(--code-chip-ink);
  border-radius: 5px;
  padding: 2px 6px;
  white-space: nowrap;
}
.command code .placeholder { color: #96a3b8; }
.command .ghost-button[hidden] { display: none; }
.result-text .rest { color: var(--ink-2); }
.result-empty { color: var(--muted); }

.flash { animation: chip-in 300ms ease-out; }
@keyframes chip-in {
  from { opacity: .35; }
  to { opacity: 1; }
}

/* ===== commands ===== */
.commands { margin-top: 22px; }
.tabs {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 9px;
  padding: 3px;
  margin: 0 0 10px;
}
.tabs button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 6px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.tabs button:hover { color: var(--ink); }
.tabs button[aria-pressed="true"] {
  color: var(--ink);
  background: var(--seg-active);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 17, 23, .12);
}
.command {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--code-line);
  border-radius: 10px;
  background: var(--code);
  padding: 11px 11px 11px 14px;
}
.command code {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  word-break: normal;
  color: var(--code-ink);
}
.command .ghost-button {
  border-color: var(--code-btn-line);
  background: var(--code-btn);
  color: var(--code-ink);
}
.command .ghost-button:hover {
  border-color: var(--code-btn-hover);
  background: var(--code-btn-hover);
  color: #ffffff;
}

/* ===== support table ===== */
.support {
  margin-top: 44px;
  padding: 22px 22px 8px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
}
.support h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .01em;
  margin: 0 0 3px;
}
.support p.hint { margin: 0; color: var(--muted); font-size: 12.5px; }
.support dl { margin: 12px 0 0; }
.support .row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 3px 24px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
/* A grid item defaults to min-width:auto, so one long hostname would push the
   whole row past the page edge. Both cells must be allowed to shrink. */
.support dt,
.support dd { min-width: 0; overflow-wrap: anywhere; }
/* Short forms are one short token next to a full URL: give the token its own
   width so the two columns never read as equal. */
.support--prefix .row { grid-template-columns: minmax(0, 0.62fr) minmax(0, 1.38fr); }
.support--vars .row { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); align-items: baseline; }
.support--vars dd { line-height: 1.6; }
.support dt {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-2);
  word-break: break-all;
}
.support dd {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.support--prefix dt { color: var(--accent); font-weight: 500; }

/* ===== errors ===== */
.error {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--danger);
  border-radius: 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 13px;
  line-height: 1.6;
}
.error::before { content: "!"; font-family: var(--mono); font-weight: 700; }
.error[hidden] { display: none; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.skip {
  position: absolute;
  left: 16px;
  top: -60px;
  z-index: 10;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: top 120ms ease;
}
.skip:focus-visible { top: 12px; }

/* ===== small screens ===== */
@media (max-width: 640px) {
  .page { padding: 0 16px 56px; }
  .hero { padding-top: 28px; }
  .tool { padding: 16px 14px 18px; border-radius: 14px; }
  .support { margin-top: 32px; padding: 18px 16px 4px; }
  .support .row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .support dd { padding-bottom: 2px; }
  .input-shell { flex-wrap: wrap; padding: 10px 12px; gap: 10px; }
  .input-shell input { padding: 6px 0; flex-basis: 100%; }
  /* Only the submit button spans the row; a full-width copy button would
     collapse the command line to zero width inside its flex row. */
  .input-shell .ghost-button { width: 100%; }
  /* The copy button drops under the command instead of squeezing the code
     line into a two-character column. */
  .command { flex-wrap: wrap; }
  .command code { flex-basis: 100%; }
  .command .ghost-button { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .flash { animation: none; }
  * { transition: none !important; }
  .ghost-button:active, #tool button[type="submit"]:active { transform: none; }
}
/* background-clip:text paints the headline as a gradient; with transparent
   text it disappears entirely in forced-colors mode unless it is restored. */
@media (forced-colors: active) {
  .headline { background: none; color: CanvasText; -webkit-text-fill-color: CanvasText; }
  .result-text .prefix,
  .command code .prefix { background: Highlight; color: HighlightText; }
  .status::before { background: CanvasText; }
}
${fontCss}
</style>`;
}

export function bodyMarkup(copy) {
  const [line1, line2] = copy.headline;
  const rows = copy.hostTable
    .map(
      ([pattern, note]) =>
        `<div class="row"><dt>${escapeHtml(pattern)}</dt><dd>${escapeHtml(note)}</dd></div>`,
    )
    .join('\n        ');
  const prefixRows = (copy.prefixTable || [])
    .map(
      ([pattern, note]) =>
        `<div class="row"><dt>${escapeHtml(pattern)}</dt><dd>${escapeHtml(note)}</dd></div>`,
    )
    .join('\n        ');
  const varRows = (copy.variables || [])
    .map(
      ([name, note]) =>
        `<div class="row"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(note)}</dd></div>`,
    )
    .join('\n        ');

  return `
<a class="skip" href="#tool">跳到中转工具</a>
<main class="page">
  <header class="masthead">
    <span class="wordmark">${escapeHtml(copy.wordmark)}</span>
    <span class="status${copy.rateLimit ? ' status--on' : ''}">${escapeHtml(copy.rateLimit ? '限流已启用' : '限流未启用')}</span>
  </header>

  <section class="hero">
    <h1 class="headline"><span>${escapeHtml(line1)}</span><span>${escapeHtml(line2)}</span></h1>
    <p class="lead">${escapeHtml(copy.lead)}</p>

    <form class="tool" method="get" action="/" id="tool" tabindex="-1">
      <div class="field">
        <label class="field-label" for="source">GitHub 地址</label>
        <div class="input-shell">
          <input id="source" name="q" type="text" inputmode="url" spellcheck="false"
                 autocomplete="off" autocapitalize="off"
                 placeholder="https://github.com/owner/repo/releases/download/v1.2.0/app.zip">
          <button class="ghost-button" type="submit">中转</button>
        </div>
      </div>

      <div class="result">
        <div class="result-label">
          <span>可访问地址</span>
        </div>
        <output class="result-box" id="result" for="source">
          <span class="result-text" id="result-text" aria-live="polite">
            <span class="result-empty">粘贴后这里显示可以直接下载的地址。</span>
          </span>
          <button class="ghost-button" type="button" id="copy" aria-label="复制可访问地址" hidden>复制</button>
        </output>
        <p class="error" id="error" role="alert" hidden></p>
        <p class="sr-only" id="copied" aria-live="polite"></p>
      </div>

      <div class="commands">
        <div class="tabs" role="group" aria-label="命令格式">
          <button aria-pressed="true" data-command="curl" type="button">curl</button>
          <button aria-pressed="false" data-command="wget" type="button">wget</button>
          <button aria-pressed="false" data-command="git" type="button">git clone</button>
        </div>
        <div class="command">
          <code id="command"><span class="placeholder">粘贴地址后这里显示命令。</span></code>
          <button class="ghost-button" type="button" id="copy-command" aria-label="复制命令" hidden>复制</button>
        </div>
      </div>
    </form>
  </section>

  <section class="support" aria-labelledby="support-title">
    <h2 id="support-title">支持的地址</h2>
    <p class="hint">左边是你粘贴的地址，右边是代理对它的处理。</p>
    <dl>
        ${rows}
    </dl>
  </section>

  <section class="support support--prefix" aria-labelledby="prefix-title">
    <h2 id="prefix-title">短写法</h2>
    <p class="hint">前缀指定主机，后面的路径原样拼上去。</p>
    <dl>
        ${prefixRows}
    </dl>
  </section>

  <section class="support support--vars" aria-labelledby="vars-title">
    <h2 id="vars-title">部署开关</h2>
    <p class="hint">以下变量都可选。</p>
    <dl>
        ${varRows}
    </dl>
  </section>
</main>`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** The client script is inlined; keep it small and dependency-free. */
export const CLIENT_SCRIPT = `
(function () {
  var form = document.getElementById('tool');
  if (!form) return;
  var source = document.getElementById('source');
  var resultText = document.getElementById('result-text');
  var copyButton = document.getElementById('copy');
  var copyCommand = document.getElementById('copy-command');
  var commandOut = document.getElementById('command');
  var errorOut = document.getElementById('error');
  var copiedOut = document.getElementById('copied');
  var origin = location.origin;
  var prefix = origin + '/';
  var mode = 'curl';
  var current = null;
  var copyTimer = null;
  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var HOSTS = ['github.com','api.github.com','raw.githubusercontent.com','gist.githubusercontent.com','codeload.github.com','media.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'];

  function parse(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    text = text.replace(/^(?:https?):\\/+/, 'https://');
    if (!/^https:\\/\\//i.test(text)) text = 'https://' + text.replace(/^\\/+/, '');
    var url;
    try { url = new URL(text); } catch (e) { return { ok: false, reason: 'bad-url' }; }
    if (url.protocol !== 'https:') return { ok: false, reason: 'insecure' };
    if (url.username || url.password) return { ok: false, reason: 'userinfo' };
    if (url.port) return { ok: false, reason: 'bad-port' };
    if (HOSTS.indexOf(url.hostname.toLowerCase()) === -1) return { ok: false, reason: 'unsupported-host' };
    url.hash = '';
    return { ok: true, href: url.href, host: url.hostname.toLowerCase() };
  }

  function command(mode, href) {
    var clean = href.replace(/^https:\\/\\//, '');
    if (mode === 'git') return 'git clone ' + prefix + 'https://' + clean.replace(/\\.git$/, '') + '.git';
    if (mode === 'wget') return 'wget ' + prefix + href;
    return 'curl -L -O ' + prefix + href;
  }

  function hostOnly() {
    return location.host + '/';
  }

  function paint(href) {
    var host = document.createElement('span');
    host.className = 'prefix';
    host.textContent = hostOnly();
    var rest = document.createElement('span');
    rest.className = 'rest';
    rest.textContent = href;
    resultText.textContent = '';
    resultText.appendChild(host);
    resultText.appendChild(rest);
    if (!reduceMotion) {
      host.classList.add('flash');
    }
  }

  function clear() {
    current = null;
    resultText.textContent = '';
    var empty = document.createElement('span');
    empty.className = 'result-empty';
    empty.textContent = '粘贴后这里显示可以直接下载的地址。';
    resultText.appendChild(empty);
    copyButton.hidden = true;
    commandOut.textContent = '';
    var hint = document.createElement('span');
    hint.className = 'placeholder';
    hint.textContent = '粘贴地址后这里显示命令。';
    commandOut.appendChild(hint);
    copyCommand.hidden = true;
  }

  var MESSAGES = {
    empty: '粘贴一个 GitHub 链接。',
    'bad-url': '这个地址无法解析。检查域名拼写，或补上 https://。',
    'unsupported-host': '这个主机不在支持范围内。',
    userinfo: '地址里不能包含用户名或密码。',
    insecure: '只支持 https 地址。',
    'bad-port': '地址里不能指定端口。'
  };

  function update() {
    var parsed = parse(source.value);
    if (!parsed.ok) {
      if (source.value.trim()) {
        errorOut.textContent = MESSAGES[parsed.reason] || MESSAGES['bad-url'];
        errorOut.hidden = false;
      } else {
        errorOut.hidden = true;
      }
      clear();
      return;
    }
    errorOut.hidden = true;
    current = parsed.href;
    paint(current);
    copyButton.hidden = false;
    paintCommand();
  }

  function paintCommand() {
    if (!current) { commandOut.textContent = ''; return; }
    var text = command(mode, current);
    var marker = prefix;
    var cut = text.indexOf(marker);
    commandOut.textContent = '';
    copyCommand.hidden = false;
    if (cut === -1) { commandOut.textContent = text; return; }
    var head = document.createElement('span');
    head.textContent = text.slice(0, cut);
    var badge = document.createElement('span');
    badge.className = 'prefix';
    badge.textContent = marker;
    var tail = document.createElement('span');
    tail.textContent = text.slice(cut + marker.length);
    commandOut.appendChild(head);
    commandOut.appendChild(badge);
    commandOut.appendChild(tail);
  }

  function setMode(next) {
    mode = next;
    var tabs = form.querySelectorAll('[data-command]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-pressed', tabs[i].getAttribute('data-command') === next ? 'true' : 'false');
    }
    if (current) paintCommand();
  }

  /* Buttons keep their resting label in data-label, so the confirmation can be
     reverted without reading the swapped text back. The aria-label is swapped
     the same way, otherwise the visible "已复制" would not appear in the
     accessible name (WCAG 2.5.3). */
  function flashLabel(button, label) {
    if (button.getAttribute('data-label') === null) {
      button.setAttribute('data-label', button.textContent);
      var aria = button.getAttribute('aria-label');
      if (aria) button.setAttribute('data-aria', aria);
    }
    button.textContent = label;
    var stored = button.getAttribute('data-aria');
    if (stored) button.setAttribute('aria-label', label + stored.slice(2));
    button.setAttribute('data-done', 'true');
    copiedOut.textContent = label;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(function () {
      button.textContent = button.getAttribute('data-label');
      if (stored) button.setAttribute('aria-label', stored);
      button.removeAttribute('data-done');
      copiedOut.textContent = '';
    }, 1600);
  }

  function copyText(text, button, label) {
    if (!text) return;
    var done = function () { flashLabel(button, label); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* leave the text selected */ }
    document.body.removeChild(area);
  }

  source.addEventListener('input', update);
  source.addEventListener('paste', function () { setTimeout(update, 0); });
  copyButton.addEventListener('click', function () {
    if (!current) return;
    copyText(prefix + current, copyButton, '已复制');
  });
  copyCommand.addEventListener('click', function () {
    if (!current) return;
    copyText(command(mode, current), copyCommand, '已复制');
  });
  form.querySelectorAll('[data-command]').forEach(function (tab) {
    tab.addEventListener('click', function () { setMode(tab.getAttribute('data-command')); });
  });

  // Paint once on load: the field may already hold a value (the Worker inlines
  // copy.prefill into the value attribute), and an empty field must settle on
  // the placeholder state rather than trusting the static markup.
  update();
})();
`;

export async function renderHomepage(copy) {
  const { css } = await displayFont();
  const prefill = copy.prefill || '';
  return `${HTML_HEAD}
${documentShell(css)}
</head>
<body>
${bodyMarkup(copy).replace(
    'id="source" name="q" type="text"',
    `id="source" name="q" type="text" value="${escapeHtml(prefill)}"`,
  )}
<script>${CLIENT_SCRIPT}</script>
${HTML_TAIL}`;
}
