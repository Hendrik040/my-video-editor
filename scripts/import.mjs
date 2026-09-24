import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/store.mjs';
import { inspectMedia, thumbnail } from '../server/media.mjs';
const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    file: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
  },
});
if (!values.project || !values.file) {
  console.error(
    'Usage: npm run import -- --project "Project name" --file "/absolute/cut.mp4" [--title "07 — New cut"] [--description "What changed"]',
  );
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.STUDIO_DATA_DIR || join(root, 'data'));
try {
  const media = await inspectMedia(values.file);
  let project = store.library().find((p) => p.name === values.project);
  if (!project) project = store.addProject({ name: values.project });
  const duplicate = store
    .library()
    .find((p) => p.id === project.id)
    .assets.find((a) => a.path === media.path);
  if (duplicate) {
    console.log(`Already imported: ${duplicate.title} (${duplicate.id})`);
  } else {
    const a = store.addAsset({
      ...media,
      projectId: project.id,
      title: values.title || media.title,
      description: values.description || '',
    });
    await thumbnail(a, store.dir).catch(() => {});
    console.log(
      JSON.stringify(
        {
          id: a.id,
          title: a.title,
          project: project.name,
          url: `http://127.0.0.1:4317/?cut=${a.id}`,
        },
        null,
        2,
      ),
    );
  }
} finally {
  store.close();
}
