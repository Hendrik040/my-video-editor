import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, feedbackMarkdown } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';

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
