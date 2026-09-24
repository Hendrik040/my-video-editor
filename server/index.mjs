import express from 'express';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.STUDIO_DATA_DIR || join(root, 'data'));
const app = createApp(store),
  port = Number(process.env.PORT || 4317);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(root, 'dist')));
  app.get('/{*path}', (_, res) => res.sendFile(join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Cutroom is ready at http://127.0.0.1:${port}`),
);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : e);
  process.exit(1);
});
function stop() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
