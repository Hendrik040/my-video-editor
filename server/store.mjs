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
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(assets)')
      .all()
      .map((c) => c.name),
  );
  for (const name of ['sourcePath', 'cameraProxyPath']) {
    if (!columns.has(name)) db.exec(`ALTER TABLE assets ADD COLUMN ${name} TEXT`);
  }
  for (const name of ['sourceIn', 'sourceOut']) {
    if (!columns.has(name)) db.exec(`ALTER TABLE assets ADD COLUMN ${name} REAL`);
  }
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const library = () =>
    all('SELECT * FROM projects ORDER BY createdAt DESC').map((p) => ({
      ...p,
      assets: all(
        `SELECT assets.*, (SELECT COUNT(*) FROM comments WHERE assetId=assets.id AND parentId IS NULL) AS commentCount, (SELECT COUNT(*) FROM comments WHERE assetId=assets.id AND parentId IS NULL AND resolved=0) AS openCount, (SELECT COUNT(*) FROM comments WHERE assetId=assets.id AND parentId IS NULL AND kind='keep') AS keepCount FROM assets WHERE projectId=? ORDER BY createdAt ASC, rowid ASC`,
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
    const temporary = join(dir, `feedback-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(payload, null, 2));
    renameSync(temporary, join(dir, 'feedback.json'));
  };
  const mutate = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      snapshot();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
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
        if (a.sourceIn != null || a.sourceOut != null) {
          if (
            !a.sourcePath ||
            !Number.isFinite(a.sourceIn) ||
            !Number.isFinite(a.sourceOut) ||
            a.sourceIn < 0 ||
            a.sourceOut <= a.sourceIn
          )
            throw new Error('A section needs an original recording and a valid source range.');
        }
        const asset = {
          ...a,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'review',
        };
        db.prepare(
          'INSERT INTO assets (id,projectId,title,description,path,duration,width,height,fps,status,createdAt,sourcePath,cameraProxyPath,sourceIn,sourceOut) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
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
          asset.sourcePath ?? null,
          asset.cameraProxyPath ?? null,
          asset.sourceIn ?? null,
          asset.sourceOut ?? null,
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
    `Exported ${new Date().toISOString()}. Timecodes refer to the reviewed video. Full-length camera previews share the original recording clock; edited cuts use their own output clock.`,
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
      if (a.sourcePath)
        lines.push(
          `Original recording${a.sourceIn == null ? ' (same timecodes)' : ''}: ${a.sourcePath}`,
          ...(a.sourceIn == null
            ? []
            : [
                `Source range: ${timecode(a.sourceIn)}–${timecode(a.sourceOut)}. Original time = section time + ${a.sourceIn} seconds.`,
              ]),
          `Camera preview file: ${a.cameraProxyPath || 'Not supplied'}`,
          '',
        );
      const cs = store.comments(a.id),
        parents = cs.filter((c) => !c.parentId);
      if (!parents.length) lines.push('No feedback yet.', '');
      for (const c of parents) {
        lines.push(
          `- [${c.resolved ? 'x' : ' '}] **${timecode(c.time)}${c.endTime == null ? '' : `–${timecode(c.endTime)}`} · ${c.kind} · ${c.author}**`,
          `  ${c.body.replaceAll('\n', '\n  ')}`,
          ...(a.sourceIn == null
            ? []
            : [
                `  Original recording: ${timecode(a.sourceIn + c.time)}${c.endTime == null ? '' : `–${timecode(a.sourceIn + c.endTime)}`}`,
              ]),
        );
        for (const reply of cs.filter((r) => r.parentId === c.id))
          lines.push(`  - ${reply.author}: ${reply.body.replaceAll('\n', '\n    ')}`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}
