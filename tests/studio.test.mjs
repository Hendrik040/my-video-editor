import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, feedbackMarkdown } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';

const drawings = [
  {
    color: '#f4b266',
    width: 0.004,
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.7 },
    ],
  },
];
const references = [{ url: 'https://example.com/reference#lighting', title: 'Lighting [example]' }];

test('visual feedback migrates legacy notes and retains geometry, links and replies after reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutroom-visual-store-'));
  let store = createStore(dir);
  try {
    const project = store.addProject({ name: 'Visual review' });
    const asset = store.addAsset({
      projectId: project.id,
      title: 'First cut',
      path: join(dir, 'preview.mp4'),
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    const original = store.addComment({
      assetId: asset.id,
      author: 'Reviewer',
      body: 'Keep this older note.',
      time: 1,
      endTime: 2,
      kind: 'keep',
    });
    store.close();
    const legacy = new DatabaseSync(join(dir, 'studio.sqlite'));
    legacy.exec(
      'ALTER TABLE comments DROP COLUMN drawings; ALTER TABLE comments DROP COLUMN "references";',
    );
    legacy.close();
    store = createStore(dir);
    assert.equal(store.comment(original.id).body, original.body);
    assert.deepEqual(store.comment(original.id).drawings, []);
    assert.deepEqual(store.comment(original.id).references, []);
    assert.equal(store.comment(original.id).endTime, 2);
    const upgradedSnapshot = JSON.parse(readFileSync(join(dir, 'feedback.json')));
    assert.equal(upgradedSnapshot.schemaVersion, 2);
    assert.deepEqual(upgradedSnapshot.projects[0].assets[0].comments[0].drawings, []);

    const annotated = store.addComment({
      assetId: asset.id,
      author: 'Reviewer',
      body: 'Match this lighting.',
      time: 3,
      kind: 'change',
      drawings,
      references,
    });
    assert.deepEqual(annotated.drawings, drawings);
    assert.equal(annotated.resolved, false);
    store.addComment({
      assetId: asset.id,
      parentId: annotated.id,
      author: 'Editor',
      body: 'Another reference.',
      time: 3,
      kind: 'note',
      references: [{ url: 'http://example.com/alternative' }],
    });
    store.updateComment(annotated.id, { body: 'Match the softer lighting.', resolved: true });
    store.updateComment(annotated.id, { resolved: false });
    store.close();
    store = createStore(dir);
    const persisted = store.comment(annotated.id);
    assert.deepEqual(persisted.drawings, drawings);
    assert.deepEqual(persisted.references, references);
    assert.equal(persisted.body, 'Match the softer lighting.');
    assert.equal(persisted.resolved, false);
    assert.equal(store.comments(asset.id).length, 3);
    const snapshot = JSON.parse(readFileSync(join(dir, 'feedback.json')));
    const exportedComment = snapshot.projects[0].assets[0].comments.find(
      (c) => c.id === annotated.id,
    );
    assert.deepEqual(exportedComment.drawings, drawings);
    assert.deepEqual(exportedComment.references, references);
    const markdown = feedbackMarkdown(store, project.id);
    assert.match(markdown, /Drawing geometry at 00:03.00/);
    assert.ok(markdown.includes(JSON.stringify(drawings)));
    assert.ok(
      markdown.includes('[Lighting \\[example\\]](<https://example.com/reference#lighting>)'),
    );
    assert.ok(markdown.includes('http://example.com/alternative'));

    store.updateComment(annotated.id, { drawings: [], references: [] });
    assert.deepEqual(store.comment(annotated.id).drawings, []);
    assert.deepEqual(store.comment(annotated.id).references, []);
    assert.equal(store.comment(original.id).body, original.body);
    store.deleteComment(annotated.id);
    assert.deepEqual(
      store.comments(asset.id).map((c) => c.id),
      [original.id],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('visual feedback rejects malformed and oversized attachments before altering stored notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutroom-visual-validation-'));
  const store = createStore(dir);
  try {
    const project = store.addProject({ name: 'Validation' });
    const asset = store.addAsset({
      projectId: project.id,
      title: 'Cut',
      path: join(dir, 'preview.mp4'),
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    const input = {
      assetId: asset.id,
      author: 'Reviewer',
      body: 'Drawing.',
      time: 3,
      kind: 'note',
    };
    const c = store.addComment({ ...input, drawings, references });
    const initialSnapshot = readFileSync(join(dir, 'feedback.json'), 'utf8');
    const invalidDrawings = [
      null,
      {},
      [null],
      [{ ...drawings[0], color: 'red' }],
      [{ ...drawings[0], width: '0.004' }],
      [{ ...drawings[0], width: NaN }],
      [{ ...drawings[0], width: 0.0009 }],
      [{ ...drawings[0], width: 0.021 }],
      [{ ...drawings[0], points: [] }],
      [{ ...drawings[0], points: [{ x: Infinity, y: 0 }] }],
      [{ ...drawings[0], points: [{ x: 0, y: -0.1 }] }],
      [{ ...drawings[0], points: [{ x: 1.1, y: 0 }] }],
      [{ ...drawings[0], points: [{ x: '0.2', y: 0 }] }],
      [{ ...drawings[0], points: Array(1501).fill({ x: 0, y: 1 }) }],
      Array(41).fill(drawings[0]),
      Array(9).fill({ ...drawings[0], points: Array(1500).fill({ x: 0, y: 1 }) }),
    ];
    const invalidReferences = [
      null,
      {},
      [null],
      Array(6).fill(references[0]),
      [{ url: 'javascript:alert(1)' }],
      [{ url: 'data:text/plain,example' }],
      [{ url: 'file:///tmp/reference.png' }],
      [{ url: '/reference' }],
      [{ url: 'https://user:secret@example.com/' }],
      [{ url: 'https://example.com/\nreference' }],
      [{ url: 'https://example.com/' + 'a'.repeat(2048) }],
      [{ url: 'https://example.com/' + 'ü'.repeat(400) }],
      [{ url: 'https://example.com', title: 'a'.repeat(161) }],
      [{ url: 'https://example.com', title: 12 }],
    ];
    for (const invalid of invalidDrawings) {
      assert.throws(() => store.addComment({ ...input, drawings: invalid }), { status: 400 });
      assert.throws(() => store.updateComment(c.id, { drawings: invalid, body: 'Changed.' }), {
        status: 400,
      });
    }
    for (const invalid of invalidReferences) {
      assert.throws(() => store.addComment({ ...input, references: invalid }), { status: 400 });
      assert.throws(() => store.updateComment(c.id, { references: invalid, resolved: true }), {
        status: 400,
      });
    }
    assert.throws(() => store.addComment({ ...input, drawings, endTime: 4 }), { status: 400 });
    assert.throws(() => store.addComment({ ...input, drawings, parentId: c.id }), { status: 400 });
    assert.equal(store.comments(asset.id).length, 1);
    assert.deepEqual(store.comment(c.id).drawings, drawings);
    assert.deepEqual(store.comment(c.id).references, references);
    assert.equal(store.comment(c.id).body, 'Drawing.');
    assert.equal(store.comment(c.id).resolved, false);
    assert.equal(readFileSync(join(dir, 'feedback.json'), 'utf8'), initialSnapshot);
    const boundary = store.addComment({
      ...input,
      drawings: [
        { color: '#ABCDEF', width: 0.001, points: [{ x: 0, y: 1 }] },
        { color: '#123456', width: 0.02, points: [{ x: 1, y: 0 }] },
      ],
      references: [{ url: ' HTTPS://example.com/ref ', title: ' Example ' }],
    });
    assert.equal(boundary.drawings[0].color, '#abcdef');
    assert.deepEqual(boundary.references, [{ url: 'https://example.com/ref', title: 'Example' }]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('section comments retain clip time and map ranges back to the original recording', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutroom-sections-'));
  let s = createStore(dir);
  try {
    const p = s.addProject({ name: 'Section Cuts — Intro' });
    const input = {
      projectId: p.id,
      title: 'Recommended — Take 03',
      path: join(dir, 'section.mp4'),
      duration: 20,
      width: 1280,
      height: 720,
      fps: 30,
      sourcePath: join(dir, 'original.mp4'),
      sourceIn: 75.5,
      sourceOut: 95.5,
    };
    assert.throws(() => s.addAsset({ ...input, sourceOut: null }), /valid source range/);
    assert.equal(s.library()[0].assets.length, 0);
    const a = s.addAsset(input);
    s.addComment({
      assetId: a.id,
      author: 'Reviewer',
      body: 'Keep this phrase.',
      time: 2.25,
      endTime: 5.5,
      kind: 'keep',
    });
    s.close();
    s = createStore(dir);
    assert.equal(s.asset(a.id).sourceIn, 75.5);
    const md = feedbackMarkdown(s, p.id);
    assert.match(md, /00:02.25–00:05.50/);
    assert.match(md, /Original recording: 01:17.75–01:21.00/);
    assert.doesNotMatch(md, /Original recording \(same timecodes\)/);
    const snapshot = JSON.parse(readFileSync(join(dir, 'feedback.json')));
    assert.equal(snapshot.projects[0].assets[0].sourceIn, 75.5);
    assert.equal(snapshot.projects[0].assets[0].comments[0].time, 2.25);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reviews persist through reopening, snapshot and Markdown retain ranges and replies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutroom-store-'));
  let s = createStore(dir);
  try {
    const p = s.addProject({ name: 'Review' }),
      a = s.addAsset({
        projectId: p.id,
        title: 'First cut',
        path: join(dir, 'clip.mp4'),
        duration: 90,
        width: 1920,
        height: 1080,
        fps: 60,
      });
    const c = s.addComment({
      assetId: a.id,
      author: 'Reviewer',
      body: 'Keep the opening.\nEspecially this lighting.',
      time: 2.25,
      endTime: 8.75,
      kind: 'keep',
    });
    s.addComment({
      assetId: a.id,
      parentId: c.id,
      author: 'Editor',
      body: 'Retained in the next cut.',
      time: 2.25,
      kind: 'note',
    });
    s.updateComment(c.id, { body: c.body, resolved: true });
    s.setStatus(a.id, 'approved');
    s.close();
    const legacy = new DatabaseSync(join(dir, 'studio.sqlite'));
    legacy.exec(
      'ALTER TABLE assets DROP COLUMN sourcePath; ALTER TABLE assets DROP COLUMN cameraProxyPath;',
    );
    legacy.close();
    s = createStore(dir);
    assert.equal(s.comments(a.id).length, 2);
    assert.equal(s.comments(a.id)[0].resolved, true);
    assert.equal(s.asset(a.id).status, 'approved');
    const snapshot = JSON.parse(readFileSync(join(dir, 'feedback.json')));
    assert.equal(snapshot.projects[0].assets[0].comments[0].endTime, 8.75);
    assert.match(feedbackMarkdown(s), /00:02.25–00:08.75/);
    assert.match(feedbackMarkdown(s), /Retained in the next cut/);
    s.deleteComment(c.id);
    assert.equal(s.comments(a.id).length, 0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API validates feedback, isolates cuts, persists mutations, exports and streams byte ranges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutroom-api-')),
    store = createStore(dir),
    file = join(dir, 'preview.mp4');
  writeFileSync(file, Buffer.from('0123456789abcdef'));
  const p = store.addProject({ name: 'Test project' }),
    a = store.addAsset({
      projectId: p.id,
      title: 'Cut A',
      path: file,
      sourcePath: file,
      cameraProxyPath: file,
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 60,
    }),
    b = store.addAsset({
      projectId: p.id,
      title: 'Cut B',
      path: file,
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 60,
    });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const req = (url, method = 'GET', body, headers = {}) =>
    fetch(root + '/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const note = {
    author: 'Hendrik',
    body: 'Reduce the pause.',
    kind: 'change',
    time: 12.5,
    endTime: 17,
  };
  try {
    assert.equal((await req('/projects', 'POST', { name: '' })).status, 400);
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...note, time: 70 })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...note, endTime: 10 })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...note, kind: 'invalid' })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', note, { Origin: 'https://untrusted.example' }))
        .status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      const r = httpRequest(
        root + '/api/library',
        { headers: { Host: 'untrusted.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      r.on('error', reject);
      r.end();
    });
    assert.equal(hostStatus, 403);
    const added = await req(`/assets/${a.id}/comments`, 'POST', note);
    assert.equal(added.status, 201);
    const c = await added.json();
    assert.equal(
      (await req(`/assets/${b.id}/comments`, 'POST', { ...note, parentId: c.id })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...note, parentId: c.id, body: 'Will do.' }))
        .status,
      201,
    );
    assert.equal((await (await req(`/assets/${b.id}/comments`)).json()).length, 0);
    await req(`/comments/${c.id}`, 'PATCH', { body: 'Trim this pause.', resolved: true });
    const comments = await (await req(`/assets/${a.id}/comments`)).json();
    assert.equal(comments[0].resolved, true);
    assert.equal(comments[0].body, 'Trim this pause.');
    const md = await (await req(`/projects/${p.id}/feedback`)).text();
    assert.match(md, /00:12.50–00:17.00/);
    assert.match(md, /Will do/);
    const visualNote = { ...note, endTime: null, drawings, references };
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...visualNote, body: '' })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...visualNote, endTime: 17 })).status,
      400,
    );
    assert.equal(
      (await req(`/assets/${a.id}/comments`, 'POST', { ...visualNote, parentId: c.id })).status,
      400,
    );
    assert.equal(
      (
        await req(`/assets/${a.id}/comments`, 'POST', {
          ...visualNote,
          references: [{ url: 'javascript:alert(1)' }],
        })
      ).status,
      400,
    );
    const visualResponse = await req(`/assets/${a.id}/comments`, 'POST', visualNote);
    assert.equal(visualResponse.status, 201);
    const visual = await visualResponse.json();
    assert.deepEqual(visual.drawings, drawings);
    assert.deepEqual(visual.references, references);
    const updated = await (
      await req(`/comments/${visual.id}`, 'PATCH', { body: 'Use this reference.', resolved: true })
    ).json();
    assert.deepEqual(updated.drawings, drawings);
    assert.deepEqual(updated.references, references);
    assert.equal(updated.resolved, true);
    const invalidPatch = await req(`/comments/${visual.id}`, 'PATCH', {
      body: 'Do not save this.',
      references: [{ url: 'https://user:secret@example.com' }],
    });
    assert.equal(invalidPatch.status, 400);
    assert.equal(store.comment(visual.id).body, 'Use this reference.');
    const jsonExport = await (await req(`/projects/${p.id}/feedback?format=json`)).json();
    assert.deepEqual(
      jsonExport.assets
        .find((asset) => asset.id === a.id)
        .comments.find((comment) => comment.id === visual.id).drawings,
      drawings,
    );
    const visualMarkdown = await (await req(`/projects/${p.id}/feedback`)).text();
    assert.ok(visualMarkdown.includes(JSON.stringify(drawings)));
    assert.ok(visualMarkdown.includes('https://example.com/reference#lighting'));
    const maximum = Array(8).fill({ ...drawings[0], points: Array(1500).fill({ x: 0, y: 1 }) });
    const maximumResponse = await req(`/assets/${a.id}/comments`, 'POST', {
      ...visualNote,
      drawings: maximum,
    });
    assert.equal(maximumResponse.status, 201);
    const maximumComment = await maximumResponse.json();
    assert.equal(maximumComment.drawings.flatMap((stroke) => stroke.points).length, 12000);
    const cleared = await (
      await req(`/comments/${visual.id}`, 'PATCH', { drawings: [], references: [] })
    ).json();
    assert.deepEqual(cleared.drawings, []);
    assert.deepEqual(cleared.references, []);
    await req(`/comments/${visual.id}`, 'DELETE');
    await req(`/comments/${maximumComment.id}`, 'DELETE');
    assert.equal((await req(`/assets/${a.id}`, 'PATCH', { status: 'approved' })).status, 200);
    assert.equal(store.asset(a.id).status, 'approved');
    const source = await req(`/assets/${a.id}/source`);
    assert.equal(source.status, 200);
    assert.match(source.headers.get('content-disposition'), /attachment/);
    assert.equal(await source.text(), '0123456789abcdef');
    assert.equal((await req(`/assets/${b.id}/source`)).status, 404);
    assert.match(md, /Original recording \(same timecodes\)/);
    const bytes = await req(`/assets/${a.id}/video`, 'GET', undefined, { Range: 'bytes=4-8' });
    assert.equal(bytes.status, 206);
    assert.equal(bytes.headers.get('content-range'), 'bytes 4-8/16');
    assert.equal(await bytes.text(), '45678');
    const missing = await req(`/assets/${a.id}/video`, 'GET', undefined, { Range: 'bytes=90-100' });
    assert.equal(missing.status, 416);
    await req(`/comments/${c.id}`, 'DELETE');
    assert.equal(store.comments(a.id).length, 0);
    assert.equal((await req('/assets/missing/comments')).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
