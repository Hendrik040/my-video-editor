import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createStore, feedbackMarkdown } from '../server/store.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.STUDIO_DATA_DIR || join(root, 'data'));
try {
  const text = feedbackMarkdown(store);
  writeFileSync(join(store.dir, 'feedback.md'), text);
  console.log(text);
} finally {
  store.close();
}
