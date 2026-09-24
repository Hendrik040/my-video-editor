import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createStore } from '../../server/store.mjs';
import { inspectMedia, thumbnail } from '../../server/media.mjs';
const dir = mkdtempSync(join(tmpdir(), 'cutroom-browser-'));
process.env.STUDIO_DATA_DIR = dir;
process.env.PORT = '4337';
process.env.NODE_ENV = 'production';
const fixture = join(dir, 'sample.mp4');
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=30',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  '4',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-movflags',
  '+faststart',
  '-y',
  fixture,
]);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/fixture-path.txt', fixture);
const s = createStore(dir),
  p = s.addProject({ name: 'Browser test project' }),
  m = await inspectMedia(fixture);
for (const title of ['Cut one', 'Cut two'])
  await thumbnail(
    s.addAsset({ ...m, projectId: p.id, title, description: 'Isolated browser test' }),
    dir,
  );
s.close();
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
await import('../../server/index.mjs');
