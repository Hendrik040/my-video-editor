import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, realpath, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
const exec = promisify(execFile);
export async function inspectMedia(path) {
  const resolved = await realpath(path);
  const s = await stat(resolved);
  if (!s.isFile() || !['.mp4', '.m4v', '.mov', '.webm'].includes(extname(resolved).toLowerCase()))
    throw new Error('Choose an MP4, MOV, M4V or WebM video.');
  const { stdout } = await exec(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', resolved],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const metadata = JSON.parse(stdout),
    v = metadata.streams.find((s) => s.codec_type === 'video');
  const duration = Number(metadata.format.duration),
    [num, den] = (v?.avg_frame_rate || '0/1').split('/').map(Number);
  if (!v || !Number.isFinite(duration) || duration <= 0)
    throw new Error('This file does not contain a playable video.');
  if (!['h264', 'vp8', 'vp9', 'av1'].includes(v.codec_name))
    throw new Error(
      'Export an H.264 MP4 preview for reliable browser playback. Your original file has not been changed.',
    );
  return {
    path: resolved,
    title: basename(resolved, extname(resolved)),
    duration,
    width: v.width,
    height: v.height,
    fps: den ? num / den : 30,
  };
}
export async function imageSize(path) {
  try {
    const { stdout } = await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'json',
        path,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const stream = JSON.parse(stdout).streams?.[0];
    if (stream && Number.isInteger(stream.width) && Number.isInteger(stream.height))
      return { width: stream.width, height: stream.height };
  } catch {}
  return {};
}
export async function thumbnail(asset, directory) {
  const folder = join(directory, 'thumbnails');
  await mkdir(folder, { recursive: true });
  const file = join(folder, `${asset.id}.jpg`);
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(Math.min(3, asset.duration / 3)),
      '-i',
      asset.path,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-2',
      '-y',
      file,
    ],
    { timeout: 30000 },
  );
  return file;
}
