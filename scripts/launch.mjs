import { spawn, execFile } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  port = Number(process.env.PORT || 4317),
  url = `http://127.0.0.1:${port}`;
async function status() {
  try {
    const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) });
    return (await r.json()).app === 'cutroom' ? 'ready' : 'occupied';
  } catch {
    return 'offline';
  }
}
if ((await status()) !== 'ready') {
  const data = process.env.STUDIO_DATA_DIR || join(root, 'data');
  mkdirSync(data, { recursive: true });
  const log = openSync(join(data, 'studio.log'), 'a');
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    if ((await status()) === 'ready') break;
    await new Promise((r) => setTimeout(r, 250));
  }
}
if ((await status()) !== 'ready') {
  console.error(
    'Could not start Cutroom. Check data/studio.log. If port 4317 is busy, run with another PORT.',
  );
  process.exit(1);
}
console.log(`Cutroom is running at ${url}`);
if (!process.argv.includes('--no-open'))
  execFile('open', [url], (error) => {
    if (error) console.log('Open the URL above in your browser.');
  });
