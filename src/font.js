// The display face carries the headline only; everything else uses the system
// CJK stack. Both files are Windfonts-shard subsets (see scripts/build-font.py),
// inlined at render time: the page makes zero third-party font requests, which
// is the point in mainland China.

import displayWoff2 from '../assets/display.woff2';
import monoWoff2 from '../assets/mono.woff2';

let cache;

/**
 * @returns {Promise<{css: string}>}
 */
export async function displayFont() {
  if (cache) return cache;
  cache = {
    css: `@font-face {
  font-family: "Headline";
  src: url(data:font/woff2;base64,${displayWoff2}) format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Relay Mono";
  src: url(data:font/woff2;base64,${monoWoff2}) format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
:root {
  --display: "Headline", "Alibaba PuHuiTi", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --mono: "Relay Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}`,
  };
  return cache;
}
