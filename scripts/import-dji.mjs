import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readdir, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { inspectMedia, thumbnail } from '../server/media.mjs';
const exec = promisify(execFile);
const { values } = parseArgs({
  options: { project: { type: 'string' }, directory: { type: 'string' } },
});
if (!values.project || !values.directory)
  throw new Error(
    'Usage: npm run import:dji -- --project "Raw Footage Analysis" --directory "/path/to/DJI_001"',
  );
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.STUDIO_DATA_DIR || join(root, 'data'));
const directory = resolve(values.directory),
  files = (await readdir(directory)).sort();
const originals = files.filter((f) => /^DJI_\d{14}_\d+_D\.MP4$/i.test(f));
async function probe(path) {
  const { stdout } = await exec(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
let added = 0,
  skipped = 0,
  failed = 0;
try {
  if (!originals.length) throw new Error('No DJI original MP4 recordings were found.');
  let project = store.library().find((p) => p.name === values.project);
  if (!project)
    project = store.addProject({
      name: values.project,
      description: 'Complete camera recordings. Keep flags identify moments for the next edit.',
    });
  const folder = join(store.dir, 'media', 'camera-previews');
  await mkdir(folder, { recursive: true });
  for (const name of originals) {
    try {
      const sourcePath = join(directory, name),
        cameraName = files.find(
          (f) => f.toLowerCase() === name.replace(/\.mp4$/i, '.lrf').toLowerCase(),
        ),
        cameraProxyPath = cameraName ? join(directory, cameraName) : null;
      if (
        store
          .library()
          .find((p) => p.id === project.id)
          .assets.some((a) => a.sourcePath === sourcePath || a.path === sourcePath)
      ) {
        skipped++;
        continue;
      }
      const original = await probe(sourcePath),
        video = original.streams.find(
          (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
        ),
        duration = Number(original.format.duration);
      if (!video) throw new Error('Original has no video stream.');
      let previewPath = sourcePath;
      if (video.codec_name === 'hevc') {
        if (!cameraProxyPath)
          throw new Error('HEVC recording needs its matching camera LRF preview.');
        const camera = await probe(cameraProxyPath),
          cv = camera.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
        if (
          cv?.codec_name !== 'h264' ||
          Math.abs(Number(cv.start_time) - Number(video.start_time)) > 0.001 ||
          Math.abs(Number(cv.duration) - Number(video.duration)) > 0.04
        )
          throw new Error('Camera preview does not match the original timing.');
        const stats = await stat(sourcePath),
          key = createHash('sha256')
            .update(sourcePath + ':' + stats.size + ':' + stats.mtimeMs)
            .digest('hex')
            .slice(0, 12);
        previewPath = join(folder, `${basename(name, '.MP4')}-${key}.mp4`);
        if (!existsSync(previewPath)) {
          const temp = previewPath + '.partial.mp4';
          try {
            await exec(
              'ffmpeg',
              [
                '-v',
                'error',
                '-i',
                cameraProxyPath,
                '-i',
                sourcePath,
                '-map',
                '0:v:0',
                '-map',
                '1:a:0',
                '-c',
                'copy',
                '-map_metadata',
                '-1',
                '-movflags',
                '+faststart',
                '-y',
                temp,
              ],
              { timeout: 600000, maxBuffer: 1024 * 1024 },
            );
            await rename(temp, previewPath);
          } catch (e) {
            await unlink(temp).catch(() => {});
            throw e;
          }
        }
      }
      const media = await inspectMedia(previewPath);
      if (Math.abs(media.duration - duration) > 0.05)
        throw new Error('Review copy duration differs from the original.');
      const parts = name.match(/^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(\d+)_D/i);
      const [, year, month, day, hour, minute, , take] = parts;
      const asset = store.addAsset({
        ...media,
        projectId: project.id,
        title: `Take ${take} · ${month}/${day} ${hour}:${minute}`,
        description: `${name} · ${video.width}×${video.height} original · complete recording`,
        sourcePath,
        cameraProxyPath,
      });
      await thumbnail(asset, store.dir);
      added++;
      console.log(
        JSON.stringify({
          added,
          take: asset.title,
          id: asset.id,
          duration: asset.duration,
          sourcePath,
          previewPath,
        }),
      );
    } catch (error) {
      failed++;
      console.error(JSON.stringify({ file: name, error: error.message }));
    }
  }
  console.log(
    JSON.stringify({
      project: project.name,
      id: project.id,
      recordings: originals.length,
      added,
      skipped,
      failed,
    }),
  );
  if (failed) process.exitCode = 1;
} finally {
  store.close();
}
