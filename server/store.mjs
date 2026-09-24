import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createStore(directory) {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'studio.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, duration REAL NOT NULL, width INTEGER, height INTEGER, fps REAL, status TEXT NOT NULL DEFAULT 'review', createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, assetId TEXT NOT NULL REFERENCES assets(id), parentId TEXT REFERENCES comments(id) ON DELETE CASCADE, author TEXT NOT NULL, body TEXT NOT NULL, time REAL NOT NULL, endTime REAL, kind TEXT NOT NULL DEFAULT 'note', resolved INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_asset ON comments(assetId, time);`);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const library = () =>
    all('SELECT * FROM projects ORDER BY createdAt DESC').map((p) => ({
      ...p,
      assets: all(
        `SELECT assets.*, (SELECT COUNT(*) FROM comments WHERE assetId=assets.id AND parentId IS NULL) AS commentCount, (SELECT COUNT(*) FROM comments WHERE assetId=assets.id AND parentId IS NULL AND resolved=0) AS openCount FROM assets WHERE projectId=? ORDER BY createdAt ASC, rowid ASC`,
        p.id,
      ),
    }));
  const comments = (id) =>
    all('SELECT * FROM comments WHERE assetId=? ORDER BY time, createdAt, rowid', id).map((c) => ({
      ...c,
      resolved: Boolean(c.resolved),
    }));
  const snapshot = () => {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      projects: library().map((p) => ({
        ...p,
        assets: p.assets.map((a) => ({ ...a, comments: comments(a.id) })),
      })),
    };
    writeFileSync(join(dir, 'feedback.json.tmp'), JSON.stringify(payload, null, 2));
    renameSync(join(dir, 'feedback.json.tmp'), join(dir, 'feedback.json'));
  };
  const mutate = (fn) => {
    const result = fn();
    snapshot();
    return result;
  };
  return {
    db,
    dir,
    library,
    comments,
    snapshot,
    project: (id) => get('SELECT * FROM projects WHERE id=?', id),
    asset: (id) => get('SELECT * FROM assets WHERE id=?', id),
    comment: (id) => get('SELECT * FROM comments WHERE id=?', id),
    addProject: ({ name, description = '' }) =>
      mutate(() => {
        const p = { id: randomUUID(), name, description, createdAt: new Date().toISOString() };
        db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run(
          p.id,
          p.name,
          p.description,
          p.createdAt,
        );
        return p;
      }),
    addAsset: (a) =>
      mutate(() => {
        const asset = {
          ...a,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'review',
        };
        db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
          asset.id,
          asset.projectId,
          asset.title,
          asset.description || '',
          asset.path,
          asset.duration,
          asset.width,
          asset.height,
          asset.fps,
          asset.status,
          asset.createdAt,
        );
        return asset;
      }),
    setStatus: (id, status) =>
      mutate(() => db.prepare('UPDATE assets SET status=? WHERE id=?').run(status, id)),
    addComment: (c) =>
      mutate(() => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare('INSERT INTO comments VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
          id,
          c.assetId,
          c.parentId ?? null,
          c.author,
          c.body,
          c.time,
          c.endTime ?? null,
          c.kind,
          0,
          now,
          now,
        );
        return get('SELECT * FROM comments WHERE id=?', id);
      }),
    updateComment: (id, c) =>
      mutate(() =>
        db
          .prepare('UPDATE comments SET body=?, resolved=?, updatedAt=? WHERE id=?')
          .run(c.body, c.resolved ? 1 : 0, new Date().toISOString(), id),
      ),
    deleteComment: (id) => mutate(() => db.prepare('DELETE FROM comments WHERE id=?').run(id)),
    close: () => db.close(),
  };
}
export function timecode(seconds) {
  const n = Math.max(0, seconds);
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}.${Math.floor((n % 1) * 100)
    .toString()
    .padStart(2, '0')}`;
}
export function feedbackMarkdown(store, projectId) {
  const projects = store.library().filter((p) => !projectId || p.id === projectId);
  const lines = [
    '# Cutroom review feedback',
    '',
    `Exported ${new Date().toISOString()}. Timecodes refer to the rendered edit, not camera originals.`,
    '',
  ];
  for (const p of projects) {
    lines.push(`## ${p.name}`, p.description, '');
    for (const a of p.assets) {
      lines.push(
        `### ${a.title}`,
        `Status: ${a.status} | Duration: ${timecode(a.duration)}`,
        `Video: ${a.path}`,
        '',
      );
      const cs = store.comments(a.id),
        parents = cs.filter((c) => !c.parentId);
      if (!parents.length) lines.push('No feedback yet.', '');
      for (const c of parents) {
        lines.push(
          `- [${c.resolved ? 'x' : ' '}] **${timecode(c.time)}${c.endTime == null ? '' : `–${timecode(c.endTime)}`} · ${c.kind} · ${c.author}**`,
          `  ${c.body.replaceAll('\n', '\n  ')}`,
        );
        for (const reply of cs.filter((r) => r.parentId === c.id))
          lines.push(`  - ${reply.author}: ${reply.body.replaceAll('\n', '\n    ')}`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}
