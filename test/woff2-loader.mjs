// Node loader: `.woff2` imports become base64 strings, matching what the
// Cloudflare bundler does for binary modules. Keeps `node --test` able to run
// the real Worker module.
import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.woff2')) {
    const bytes = await readFile(new URL(url));
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(bytes.toString('base64'))};`,
    };
  }
  return nextLoad(url, context);
}
