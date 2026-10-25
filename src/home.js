/**
 * The homepage: one tool, no chrome.
 *
 * Design language — "highlighter on the desk"
 * - Warm paper ground with a faint graph-paper grid; the accent is a marker
 *   yellow (#ffd43b, the favicon's yellow) used as a highlighter, not a tint:
 *   the second headline line is swiped on load, the injected relay prefix is
 *   a yellow stamp chip, short prefixes are washed with the same yellow.
 * - The tool is the one heavy object (ink border + hard offset shadow);
 *   everything after it is hairline rules and type, no cards.
 * - Routing rows carry a colored dot that mirrors the Worker's own
 *   X-Proxy-Rule classes; a legend under the section title decodes them.
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
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fffdf6">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#14120d">
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
  --paper: #fffdf6;
  --card: #ffffff;
  --ink: #26221a;
  --ink-2: #4a4436;
  --muted: #6f6752;
  --line: #e9e2cf;
  --line-strong: #d3cab0;
  --accent: #ffd43b;
  --accent-deep: #8a6d00;
  --accent-ink: #26221a;
  --accent-wash: rgba(255, 212, 59, .35);
  --halo: rgba(255, 212, 59, .45);
  --ok: #0b7f46;
  --ok-soft: #e9f6ec;
  --danger: #bf2417;
  --danger-soft: #fcefec;
  --grid: rgba(38, 34, 26, .05);
  --offset: #26221a;
  /* Routing dots mirror the X-Proxy-Rule response classes. */
  --rule-immutable: #2f9e44;
  --rule-refresh: #1971c2;
  --rule-standard: #f08c00;
  --rule-api: #d6336c;
  --rule-git: #6741d9;
  --rule-lfs: #0c8599;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper: #14120d;
    --card: #1c1913;
    --ink: #f2ede2;
    --ink-2: #d6cfbf;
    --muted: #a69d87;
    --line: #2b271e;
    --line-strong: #403a2c;
    --accent: #ffd43b;
    --accent-deep: #ffd43b;
    --accent-ink: #1f1b10;
    --accent-wash: rgba(255, 212, 59, .13);
    --halo: rgba(255, 212, 59, .26);
    --ok: #4ad686;
    --ok-soft: #10241a;
    --danger: #ff9b91;
    --danger-soft: #241315;
    --grid: rgba(242, 237, 226, .045);
    --offset: #060503;
    --rule-immutable: #69db7c;
    --rule-refresh: #74c0fc;
    --rule-standard: #ffc078;
    --rule-api: #faa2c1;
    --rule-git: #b197fc;
    --rule-lfs: #66d9e8;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  /* Graph-paper desk: a faint grid plus one soft glow behind the headline. */
  background:
    radial-gradient(900px 420px at 82% -180px, var(--accent-wash), transparent 70%),
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px),
    var(--paper);
  background-size: auto, 36px 36px, 36px 36px, auto;
  color: var(--ink);
  font: 400 16.5px/1.75 "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  font-feature-settings: "palt" 1;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
::selection { background: var(--accent); color: var(--accent-ink); }
button, input { touch-action: manipulation; }
.page { max-width: 820px; margin: 0 auto; padding: 0 24px 80px; }
a { color: var(--accent-deep); text-underline-offset: 3px; }
:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ===== masthead ===== */
.masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 22px 0 16px;
}
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-family: var(--display);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: .01em;
}
/* A tiny sticker for the mark; the rotation is the whole joke, keep it. */
.wordmark::before {
  content: "";
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--ink);
  transform: rotate(-8deg);
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--line-strong);
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
.hero { padding: 36px 0 0; }
.headline {
  font-family: var(--display);
  font-weight: 700;
  font-size: clamp(24px, 6.4vw, 54px);
  line-height: 1.3;
  letter-spacing: -.005em;
  margin: 0;
  color: var(--ink);
}
.headline .l1 { display: block; }
/* The highlighted line: the marker swipe is the page's one big moment. The
   line must stay a single run, so it is an inline-block with nowrap; the
   headline scale bottoms out at 24px to keep 11 glyphs inside 320px. */
.headline .hl {
  display: inline-block;
  white-space: nowrap;
  position: relative;
  z-index: 0;
  margin-top: .1em;
}
/* The band is marker yellow in both schemes, so the text riding on it must
   stay dark ink even when the page ground flips dark. */
.headline .hl { color: #26221a; }
.headline .hl::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: -.14em;
  right: -.2em;
  top: .1em;
  bottom: .04em;
  background: var(--accent);
  border-radius: .14em;
  transform: skew(-12deg) rotate(-.7deg);
  transform-origin: left center;
}
@media (prefers-reduced-motion: no-preference) {
  .headline .hl::before { animation: swipe .7s .12s cubic-bezier(.2, .7, .2, 1) both; }
  @keyframes swipe {
    from { transform: skew(-12deg) rotate(-.7deg) scaleX(0); opacity: .6; }
    to { transform: skew(-12deg) rotate(-.7deg) scaleX(1); opacity: 1; }
  }
}
.lead {
  margin: 18px 0 0;
  max-width: 34em;
  color: var(--muted);
  font-size: 15.5px;
  text-wrap: pretty;
}

/* ===== tool ===== */
.tool {
  margin-top: 30px;
  border: 2px solid var(--ink);
  background: var(--card);
  border-radius: 18px;
  padding: 20px 20px 22px;
  box-shadow: 6px 6px 0 var(--offset);
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
  border: 1.5px solid var(--line-strong);
  background: var(--card);
  border-radius: 12px;
  padding: 0 6px 0 14px;
  min-height: 54px;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.input-shell:hover { border-color: var(--ink-2); }
.input-shell:focus-within {
  border-color: var(--ink);
  box-shadow: 0 0 0 4px var(--halo);
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
  border: 1.5px solid var(--line-strong);
  border-radius: 9px;
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
.ghost-button:hover {
  border-color: var(--ink-2);
  color: var(--ink);
  background: var(--accent-wash);
}
.ghost-button:active { transform: translateY(.5px); }
.ghost-button[data-done="true"] { border-color: var(--ok); color: var(--ok); background: var(--ok-soft); }

/* The one filled button on the page: the submit control. */
#tool button[type="submit"] {
  border: 1.5px solid var(--ink);
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
  padding: 7px 18px;
  box-shadow: 2px 2px 0 var(--ink);
}
#tool button[type="submit"]:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 var(--ink);
}
#tool button[type="submit"]:active {
  transform: translate(1px, 1px);
  box-shadow: 0 0 0 var(--ink);
}

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
  border: 1.5px solid var(--line-strong);
  border-radius: 12px;
  background: var(--card);
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
/* The injected relay host is a stamped chip: marker yellow, inked edge, one
   lifted corner. It is one indivisible token — letting it break across lines
   would produce two half-filled boxes — so it stays on one line and scrolls
   with its parent. */
.result-text .prefix {
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 6px 6px 6px 2px;
  padding: 2px 7px;
  box-shadow: 1.5px 1.5px 0 var(--ink);
  white-space: nowrap;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transform-origin: left center;
}
.command code .prefix {
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 6px 6px 6px 2px;
  padding: 2px 7px;
  white-space: nowrap;
}
.command code .placeholder { color: var(--muted); }
.command .ghost-button[hidden] { display: none; }
.result-text .rest { color: var(--ink-2); }
.result-empty { color: var(--muted); }

/* Stamp-in: the chip lands like a pressed seal when a result appears. */
.flash { animation: stamp 300ms cubic-bezier(.2, .8, .3, 1.15); }
@keyframes stamp {
  from { transform: scale(1.3) rotate(-3deg); opacity: .5; }
  to { transform: none; opacity: 1; }
}

/* ===== commands: a coupon, not a terminal panel ===== */
.commands { margin-top: 22px; }
.tabs {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--line-strong);
  background: var(--card);
  border-radius: 10px;
  padding: 3px;
  margin: 0 0 10px;
}
.tabs button {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 6px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.tabs button:hover { color: var(--ink); background: var(--accent-wash); }
.tabs button[aria-pressed="true"] {
  color: var(--paper);
  background: var(--ink);
  font-weight: 600;
  box-shadow: 1.5px 1.5px 0 var(--accent);
}
.command {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1.5px dashed var(--line-strong);
  border-radius: 12px;
  background: transparent;
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
  color: var(--ink);
}
.command .ghost-button {
  border-color: var(--line-strong);
  background: var(--card);
  color: var(--ink-2);
}
.command .ghost-button:hover {
  border-color: var(--ink-2);
  background: var(--accent-wash);
  color: var(--ink);
}

/* ===== reference sections: hairlines and type, no cards ===== */
.support {
  margin-top: 44px;
  padding: 18px 0 0;
  border-top: 2px solid var(--ink);
}
.support h2 {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: .01em;
  margin: 0;
}
.support p.hint { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
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

/* Routing dots + the legend that decodes them. */
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 7px;
  vertical-align: 0;
}
.dot--immutable { background: var(--rule-immutable); }
.dot--refresh { background: var(--rule-refresh); }
.dot--standard { background: var(--rule-standard); }
.dot--api { background: var(--rule-api); }
.dot--git { background: var(--rule-git); }
.dot--lfs { background: var(--rule-lfs); }
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.legend span { display: inline-flex; align-items: center; }
.legend .dot { margin-right: 6px; }
/* Short prefixes are the highlighter's home turf: a yellow wash marks the
   token you would actually retype. */
.support--prefix dt {
  background: var(--accent-wash);
  border-radius: 6px;
  padding: 2px 8px;
  justify-self: start;
  color: var(--accent-deep);
  font-weight: 500;
}

/* ===== errors ===== */
.error {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1.5px solid var(--danger);
  border-radius: 12px;
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
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 2px 2px 0 var(--ink);
  transition: top 120ms ease;
}
.skip:focus-visible { top: 12px; }

/* ===== small screens ===== */
@media (max-width: 640px) {
  .page { padding: 0 16px 56px; }
  .hero { padding-top: 26px; }
  .tool { padding: 16px 14px 18px; border-radius: 15px; box-shadow: 4px 4px 0 var(--offset); }
  .support { margin-top: 34px; }
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
@media (max-width: 350px) {
  .headline { font-size: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .flash { animation: none; }
  .headline .hl::before { animation: none; }
  * { transition: none !important; }
  .ghost-button:active, #tool button[type="submit"]:active { transform: none; }
}
/* The stamp chips and the highlight rely on background color; forced-colors
   mode remaps both to Highlight so they stay visible. */
@media (forced-colors: active) {
  .headline .hl { color: CanvasText; }
  .headline .hl::before { background: Highlight; }
  .result-text .prefix,
  .command code .prefix {
    background: Highlight;
    color: HighlightText;
    box-shadow: none;
  }
  .status::before, .dot { background: CanvasText; }
}
${fontCss}
</style>`;
}

/** Match a host-table pattern to the X-Proxy-Rule class the Worker would emit. */
function ruleOf(pattern) {
  if (/info\/lfs/.test(pattern)) return 'lfs';
  if (/\.git$/.test(pattern)) return 'git';
  if (/releases\/download|archive\//.test(pattern)) return 'immutable';
  if (/raw\.|codeload\./.test(pattern)) return 'refresh';
  if (/api\./.test(pattern)) return 'api';
  return 'standard';
}

export function bodyMarkup(copy) {
  const [line1, line2] = copy.headline;
  const rows = copy.hostTable
    .map(
      ([pattern, note]) =>
        `<div class="row"><dt><i class="dot dot--${ruleOf(pattern)}" aria-hidden="true"></i>${escapeHtml(pattern)}</dt><dd>${escapeHtml(note)}</dd></div>`,
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
    <h1 class="headline"><span class="l1">${escapeHtml(line1)}</span><span class="hl">${escapeHtml(line2)}</span></h1>
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
    <p class="hint">左边是你粘贴的地址，右边是代理对它的处理。圆点对应缓存行为。</p>
    <p class="legend">
      <span><i class="dot dot--immutable" aria-hidden="true"></i>缓存一年</span>
      <span><i class="dot dot--refresh" aria-hidden="true"></i>60 秒重验</span>
      <span><i class="dot dot--standard" aria-hidden="true"></i>常规透传</span>
      <span><i class="dot dot--api" aria-hidden="true"></i>不缓存</span>
      <span><i class="dot dot--git" aria-hidden="true"></i>只读 git</span>
      <span><i class="dot dot--lfs" aria-hidden="true"></i>LFS</span>
    </p>
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
