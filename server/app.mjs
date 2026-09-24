import express from 'express';
import multer from 'multer';
import { join, extname, basename } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectMedia, thumbnail } from './media.mjs';
import { feedbackMarkdown } from './store.mjs';
const kinds = ['note', 'keep', 'change'];
function required(value, label, max = 5000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Object.assign(new Error(`${label} is required (maximum ${max} characters).`), {
      status: 400,
    });
  return value.trim();
}
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
      return res.status(403).json({ error: 'This studio accepts local connections only.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`)
      return res.status(403).json({ error: 'Open the studio directly to make changes.' });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ error: 'Cross-site changes are not allowed.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_, res) => res.json({ app: 'cutroom', ok: true }));
  app.get('/api/library', (_, res) => res.json(store.library()));
  app.post('/api/projects', (req, res) =>
    res.status(201).json(
      store.addProject({
        name: required(req.body.name, 'Project name', 120),
        description:
          typeof req.body.description === 'string' ? req.body.description.slice(0, 1000) : '',
      }),
    ),
  );
  const assetFor = (id) => store.asset(id) || fail('Video not found.', 404);
  app.get('/api/assets/:id/comments', (req, res) => {
    assetFor(req.params.id);
    res.json(store.comments(req.params.id));
  });
  app.get('/api/assets/:id/video', (req, res) => {
    const a = assetFor(req.params.id);
    res.sendFile(a.path, (err) => {
      if (err && !res.headersSent)
        res.status(err.status === 416 ? 416 : 404).json({
          error:
            err.status === 416
              ? 'Requested range is outside the video.'
              : 'The video has moved. Add the file again from its new location.',
        });
    });
  });
  app.get('/api/assets/:id/source', (req, res) => {
    const a = assetFor(req.params.id);
    const path = req.query.format === 'camera' ? a.cameraProxyPath : a.sourcePath;
    if (!path) fail('No camera source is linked to this video.', 404);
    res.download(path, (err) => {
      if (err && !res.headersSent)
        res
          .status(404)
          .json({ error: 'The original file is no longer available at its linked path.' });
    });
  });
  app.get('/api/assets/:id/thumbnail', async (req, res) => {
    const a = assetFor(req.params.id);
    const file = join(store.dir, 'thumbnails', `${a.id}.jpg`);
    if (!existsSync(file)) await thumbnail(a, store.dir);
    res.sendFile(file);
  });
  app.patch('/api/assets/:id', (req, res) => {
    assetFor(req.params.id);
    if (!['review', 'changes', 'approved'].includes(req.body.status))
      fail('Choose a valid review status.');
    store.setStatus(req.params.id, req.body.status);
    res.json(store.asset(req.params.id));
  });
  app.post('/api/assets/:id/comments', (req, res) => {
    const asset = assetFor(req.params.id),
      b = req.body;
    const parent = b.parentId ? store.comment(b.parentId) : null;
    if (b.parentId && (!parent || parent.assetId !== asset.id || parent.parentId))
      fail('Reply to a comment on this video.');
    const time = parent ? parent.time : b.time,
      endTime = parent ? null : (b.endTime ?? null);
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > asset.duration)
      fail('Comment time is outside this video.');
    if (
      endTime !== null &&
      (typeof endTime !== 'number' ||
        !Number.isFinite(endTime) ||
        endTime <= time ||
        endTime > asset.duration)
    )
      fail('The range must end after its start and within the video.');
    if (!kinds.includes(b.kind)) fail('Choose note, keep or change.');
    res.status(201).json(
      store.addComment({
        assetId: asset.id,
        parentId: parent?.id,
        author: required(b.author, 'Your name', 80),
        body: required(b.body, 'Comment'),
        time,
        endTime,
        kind: b.kind,
      }),
    );
  });
  app.patch('/api/comments/:id', (req, res) => {
    const c = store.comment(req.params.id) || fail('Comment not found.', 404);
    if (req.body.resolved !== undefined && typeof req.body.resolved !== 'boolean')
      fail('Resolved must be true or false.');
    store.updateComment(c.id, {
      body: req.body.body === undefined ? c.body : required(req.body.body, 'Comment'),
      resolved: req.body.resolved ?? Boolean(c.resolved),
    });
    res.json(store.comment(c.id));
  });
  app.delete('/api/comments/:id', (req, res) => {
    if (!store.comment(req.params.id)) fail('Comment not found.', 404);
    store.deleteComment(req.params.id);
    res.status(204).end();
  });
  async function add(projectId, file, title, description) {
    if (!store.project(projectId)) fail('Project not found.', 404);
    let m;
    try {
      m = await inspectMedia(file);
    } catch (e) {
      fail(
        e.code === 'ENOENT'
          ? 'File or FFmpeg tools not found. Check the path and install FFmpeg.'
          : e.message,
      );
    }
    const a = store.addAsset({
      ...m,
      projectId,
      title: title ? required(title, 'Title', 160) : m.title,
      description: typeof description === 'string' ? description.slice(0, 1000) : '',
    });
    await thumbnail(a, store.dir).catch(() => {});
    return a;
  }
  app.post('/api/projects/:id/import', async (req, res) => {
    res
      .status(201)
      .json(
        await add(
          req.params.id,
          required(req.body.path, 'File path', 4000),
          req.body.title,
          req.body.description,
        ),
      );
  });
  const folder = join(store.dir, 'media');
  mkdirSync(folder, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: folder,
      filename: (_, file, cb) => cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 8 * 1024 ** 3, files: 1, fields: 3 },
    fileFilter: (_, file, cb) =>
      cb(
        null,
        ['.mp4', '.mov', '.m4v', '.webm'].includes(extname(file.originalname).toLowerCase()),
      ),
  });
  app.post('/api/projects/:id/upload', upload.single('video'), async (req, res) => {
    if (!req.file) fail('Choose an MP4, MOV, M4V or WebM video.');
    try {
      res
        .status(201)
        .json(
          await add(
            req.params.id,
            req.file.path,
            req.body.title || basename(req.file.originalname, extname(req.file.originalname)),
            req.body.description,
          ),
        );
    } catch (error) {
      await unlink(req.file.path).catch(() => {});
      throw error;
    }
  });
  app.get('/api/projects/:id/feedback', (req, res) => {
    const p = store.project(req.params.id) || fail('Project not found.', 404);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${p.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 80)}-feedback.${req.query.format === 'json' ? 'json' : 'md'}"`,
    );
    if (req.query.format === 'json')
      return res.json({
        ...p,
        assets: store
          .library()
          .find((x) => x.id === p.id)
          .assets.map((a) => ({ ...a, comments: store.comments(a.id) })),
      });
    res.type('text/markdown').send(feedbackMarkdown(store, p.id));
  });
  app.use('/api', (_, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({
      error: status === 500 ? 'Could not complete this action. Please try again.' : err.message,
    });
  });
  return app;
}
