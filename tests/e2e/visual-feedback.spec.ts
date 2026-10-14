import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Cut = { id: string; title: string };
type Point = { x: number; y: number };

async function isolatedCuts(request: APIRequestContext, name: string) {
  const projectResponse = await request.post('/api/projects', {
    data: { name },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const cuts: Cut[] = [];
  for (const title of ['Cut one', 'Cut two']) {
    const response = await request.post(`/api/projects/${project.id}/import`, {
      data: {
        path: readFileSync('test-results/fixture-path.txt', 'utf8'),
        title,
        description: 'Isolated visual feedback regression',
      },
    });
    expect(response.status()).toBe(201);
    cuts.push(await response.json());
  }
  return { project, cuts };
}

async function openCut(page: Page, cut: Cut, time = 0) {
  await page.goto(`/?cut=${cut.id}&t=${time}`);
  await expect(page.getByRole('heading', { name: cut.title, exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeCloseTo(time, 2);
}

function drawingSurface(page: Page) {
  return page.locator('svg[aria-label="Draw on this video frame"]');
}

async function stroke(page: Page, surface: Locator, points: Point[]) {
  await surface.scrollIntoViewIfNeeded();
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  const point = (p: Point) => ({
    x: bounds!.x + bounds!.width * p.x,
    y: bounds!.y + bounds!.height * p.y,
  });
  const first = point(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const next = point(p);
    await page.mouse.move(next.x, next.y, { steps: 3 });
  }
  await page.mouse.up();
}

async function visibleVideoBounds(page: Page) {
  return page.locator('video').evaluate((element) => {
    const video = element as HTMLVideoElement;
    const bounds = video.getBoundingClientRect();
    const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    return {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y + (bounds.height - height) / 2,
      width,
      height,
      elementHeight: bounds.height,
    };
  });
}

async function expectFrameAlignment(page: Page, surface: Locator) {
  const frame = await visibleVideoBounds(page);
  await expect
    .poll(async () => {
      const bounds = await surface.boundingBox();
      if (!bounds) return Infinity;
      return Math.max(
        Math.abs(bounds.x - frame.x),
        Math.abs(bounds.y - frame.y),
        Math.abs(bounds.width - frame.width),
        Math.abs(bounds.height - frame.height),
      );
    })
    .toBeLessThan(2);
  return frame;
}

test('frame drawing and reference links persist with their captured time and scale to mobile', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { project, cuts } = await isolatedCuts(request, 'Visual feedback persistence');
  await openCut(page, cuts[0], 1.25);
  // A square player deliberately letterboxes the 16:9 fixture. Ink must cover only the picture.
  await page.addStyleTag({ content: '.video-stage { aspect-ratio: 1 / 1 !important; }' });
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  const surface = drawingSurface(page);
  await expect(surface).toBeVisible();
  await surface.scrollIntoViewIfNeeded();
  const frame = await expectFrameAlignment(page, surface);
  expect(frame.elementHeight - frame.height).toBeGreaterThan(40);
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
    .toBe(true);
  await page.getByRole('button', { name: 'Yellow pen', exact: true }).click();
  await stroke(page, surface, [
    { x: 0.2, y: 0.3 },
    { x: 0.4, y: 0.5 },
    { x: 0.7, y: 0.6 },
  ]);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Time range' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Post comment', exact: true })).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Your comment' })
    .fill('Keep the marked subject in frame.');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reference 1 URL', exact: true })
    .fill('https://flask.do/roadmap');
  await page
    .getByRole('textbox', { name: 'Reference 1 title', exact: true })
    .fill('Composition reference');
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/assets/${cuts[0].id}/comments`),
  );
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  expect((await posted).status()).toBe(201);
  const comments = await (await request.get(`/api/assets/${cuts[0].id}/comments`)).json();
  expect(comments).toHaveLength(1);
  const saved = comments[0];
  expect(saved.time).toBeCloseTo(1.25, 2);
  expect(saved.endTime).toBeNull();
  expect(saved.references).toEqual([
    { url: 'https://flask.do/roadmap', title: 'Composition reference' },
  ]);
  expect(saved.drawings).toHaveLength(1);
  const points: Point[] = saved.drawings[0].points;
  expect(points[0].x).toBeCloseTo(0.2, 2);
  expect(points[0].y).toBeCloseTo(0.3, 2);
  expect(points.at(-1)!.x).toBeCloseTo(0.7, 2);
  expect(points.at(-1)!.y).toBeCloseTo(0.6, 2);
  for (const p of points) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Reference 1 URL', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeEnabled();
  await page.reload();
  const note = page.getByRole('article').filter({ hasText: 'Keep the marked subject in frame.' });
  await expect(note).toBeVisible();
  const reference = note.getByRole('link', { name: 'Composition reference', exact: true });
  await expect(reference).toHaveAttribute('href', 'https://flask.do/roadmap');
  await expect(reference).toHaveAttribute('target', '_blank');
  await expect(reference).toHaveAttribute('rel', /noopener/);
  await note.getByRole('button', { name: 'Show drawing', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeCloseTo(1.25, 2);
  // Explicitly showing a saved note must win over a different draft on that same frame.
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  await page.getByRole('button', { name: 'Red pen', exact: true }).click();
  await stroke(page, drawingSurface(page), [
    { x: 0.1, y: 0.8 },
    { x: 0.3, y: 0.8 },
  ]);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  const savedSurface = page.locator('svg[aria-label="Drawing on this video frame"]');
  await expect(savedSurface.locator('polyline')).toHaveAttribute('stroke', '#ff6b6b');
  await note.getByRole('button', { name: 'Show drawing', exact: true }).click();
  await expect(savedSurface.locator('polyline')).toHaveAttribute('stroke', '#f4c95d');
  const draft = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`cutroom-drawing-${id}`) || 'null'),
    cuts[0].id,
  );
  expect(draft.drawings[0].color).toBe('#ff6b6b');
  await page
    .getByRole('complementary', { name: 'Review comments' })
    .getByRole('button', { name: 'Clear drawing', exact: true })
    .click();
  await page.screenshot({ path: 'test-results/visual-feedback-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(savedSurface).toBeVisible();
  await savedSurface.scrollIntoViewIfNeeded();
  const mobileFrame = await expectFrameAlignment(page, savedSurface);
  expect(mobileFrame.width).toBeLessThan(390);
  const renderedStart = await savedSurface.locator('polyline').evaluate((element) => {
    const line = element as SVGPolylineElement;
    const first = line.points.getItem(0);
    const point = new DOMPoint(first.x, first.y).matrixTransform(line.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  expect(
    Math.abs(renderedStart.x - (mobileFrame.x + mobileFrame.width * points[0].x)),
  ).toBeLessThan(1);
  expect(
    Math.abs(renderedStart.y - (mobileFrame.y + mobileFrame.height * points[0].y)),
  ).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/visual-feedback-mobile.png', fullPage: true });
  const feedback = await (
    await request.get(`/api/projects/${project.id}/feedback?format=json`)
  ).json();
  expect(
    feedback.assets.find((asset: Cut) => asset.id === cuts[0].id).comments[0].drawings,
  ).toEqual(saved.drawings);
  expect(errors).toEqual([]);
});

test('drawing and reference drafts stay with their cut, and undo or clear removes only draft ink', async ({
  page,
  request,
}) => {
  const { cuts } = await isolatedCuts(request, 'Visual feedback draft isolation');
  await openCut(page, cuts[0], 0.75);
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  const surface = drawingSurface(page);
  await stroke(page, surface, [
    { x: 0.25, y: 0.25 },
    { x: 0.5, y: 0.5 },
  ]);
  await page.getByRole('button', { name: 'Red pen', exact: true }).click();
  await stroke(page, surface, [
    { x: 0.7, y: 0.2 },
    { x: 0.7, y: 0.6 },
  ]);
  await expect(surface.locator('polyline')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo stroke', exact: true }).click();
  await expect(surface.locator('polyline')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Your comment' }).fill('Draft for this cut only.');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reference 1 URL', exact: true })
    .fill('https://example.com/composition');
  await page
    .getByRole('textbox', { name: 'Reference 1 title', exact: true })
    .fill('Keep this reference');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reference 2 URL', exact: true })
    .fill('https://example.com/removed');
  await page.getByRole('button', { name: 'Remove reference 2', exact: true }).click();
  await page.getByRole('button', { name: /Cut two Ready for review/ }).click();
  await expect(page.getByRole('heading', { name: 'Cut two', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Reference 1 URL', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear drawing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeEnabled();
  await page.getByRole('button', { name: /Cut one Ready for review/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
    'Draft for this cut only.',
  );
  await expect(page.getByRole('textbox', { name: 'Reference 1 URL', exact: true })).toHaveValue(
    'https://example.com/composition',
  );
  await expect(page.getByRole('textbox', { name: 'Reference 2 URL', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
    'Draft for this cut only.',
  );
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  await expect(surface).toBeVisible();
  await page
    .getByRole('complementary', { name: 'Review comments' })
    .getByRole('button', { name: 'Clear drawing', exact: true })
    .click();
  await expect(surface).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done drawing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw on frame', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  await expect(surface).toBeVisible();
  await stroke(page, surface, [
    { x: 0.2, y: 0.6 },
    { x: 0.6, y: 0.6 },
  ]);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toBeFocused();
  await page
    .getByRole('complementary', { name: 'Review comments' })
    .getByRole('button', { name: 'Clear drawing', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
    'Draft for this cut only.',
  );
  await expect(page.getByRole('textbox', { name: 'Reference 1 title', exact: true })).toHaveValue(
    'Keep this reference',
  );
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Time range' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clear drawing', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(
    page.getByRole('article').getByText('Draft for this cut only.', { exact: true }),
  ).toBeVisible();
  const comments = await (await request.get(`/api/assets/${cuts[0].id}/comments`)).json();
  expect(comments).toHaveLength(1);
  expect(comments[0].drawings).toEqual([]);
  expect(comments[0].references).toEqual([
    { url: 'https://example.com/composition', title: 'Keep this reference' },
  ]);
  expect(await (await request.get(`/api/assets/${cuts[1].id}/comments`)).json()).toEqual([]);
});

test('unsafe reference links are rejected without losing the comment or drawing draft', async ({
  page,
  request,
}) => {
  const { cuts } = await isolatedCuts(request, 'Visual feedback URL validation');
  await openCut(page, cuts[0], 1);
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  await stroke(page, drawingSurface(page), [
    { x: 0.3, y: 0.3 },
    { x: 0.6, y: 0.6 },
  ]);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Your comment' });
  await body.fill('Preserve this draft while I correct the link.');
  await page.getByRole('button', { name: 'Add reference', exact: true }).click();
  const referenceURL = page.getByRole('textbox', { name: 'Reference 1 URL', exact: true });
  await referenceURL.fill('javascript:alert(1)');
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/assets/${cuts[0].id}/comments`))
      posts++;
  });
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'References need a full http:// or https:// link.',
  );
  await expect(body).toHaveValue('Preserve this draft while I correct the link.');
  await expect(referenceURL).toHaveValue('javascript:alert(1)');
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  expect(posts).toBe(0);
  expect(await (await request.get(`/api/assets/${cuts[0].id}/comments`)).json()).toEqual([]);
  await page.reload();
  await expect(body).toHaveValue('Preserve this draft while I correct the link.');
  await expect(referenceURL).toHaveValue('javascript:alert(1)');
  await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove reference 1', exact: true }).click();
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(
    page
      .getByRole('article')
      .getByText('Preserve this draft while I correct the link.', { exact: true }),
  ).toBeVisible();
  const comments = await (await request.get(`/api/assets/${cuts[0].id}/comments`)).json();
  expect(comments).toHaveLength(1);
  expect(comments[0].drawings).toHaveLength(1);
  expect(comments[0].references).toEqual([]);
  expect(posts).toBe(1);
});

test('a delayed comment save does not clear the drawing or draft on a newly selected cut', async ({
  page,
  request,
}) => {
  const { cuts } = await isolatedCuts(request, 'Visual feedback delayed save');
  await openCut(page, cuts[0], 1.5);
  await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
  await stroke(page, drawingSurface(page), [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.2 },
  ]);
  await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your comment' }).fill('Save on the first cut.');

  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markPostReceived!: () => void;
  const postReceived = new Promise<void>((resolve) => {
    markPostReceived = resolve;
  });
  await page.route(`**/api/assets/${cuts[0].id}/comments`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    markPostReceived();
    await responseGate;
    await route.fulfill({ response });
  });

  try {
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await postReceived;
    await expect(page.getByRole('button', { name: 'Draw on frame', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo stroke', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Cut two Ready for review/ }).click();
    await expect(page.getByRole('heading', { name: 'Cut two', exact: true })).toBeVisible();
    await expect
      .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Draw on frame', exact: true }).click();
    await page.getByRole('button', { name: 'White pen', exact: true }).click();
    const surface = drawingSurface(page);
    await stroke(page, surface, [
      { x: 0.3, y: 0.7 },
      { x: 0.7, y: 0.7 },
    ]);
    await page.getByRole('textbox', { name: 'Your comment' }).fill('Draft on the second cut.');
    const secondDraft = await page.evaluate(
      (id) => localStorage.getItem(`cutroom-drawing-${id}`),
      cuts[1].id,
    );
    expect(secondDraft).not.toBeNull();

    const responseReceived = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/assets/${cuts[0].id}/comments`),
    );
    releaseResponse();
    expect((await responseReceived).status()).toBe(201);
    // The old cut's storage cleanup confirms its async submit handler has completed.
    await expect
      .poll(() => page.evaluate((id) => localStorage.getItem(`cutroom-drawing-${id}`), cuts[0].id))
      .toBeNull();
    await expect(page.getByRole('heading', { name: 'Cut two', exact: true })).toBeVisible();
    await expect(surface).toBeVisible();
    await expect(surface.locator('polyline')).toHaveAttribute('stroke', '#ffffff');
    await expect(page.getByRole('button', { name: 'Done drawing', exact: true })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
      'Draft on the second cut.',
    );
    await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
    expect(
      await page.evaluate((id) => localStorage.getItem(`cutroom-drawing-${id}`), cuts[1].id),
    ).toBe(secondDraft);
    const firstComments = await (await request.get(`/api/assets/${cuts[0].id}/comments`)).json();
    expect(firstComments).toHaveLength(1);
    expect(firstComments[0].body).toBe('Save on the first cut.');
    expect(firstComments[0].drawings).toHaveLength(1);
    expect(await (await request.get(`/api/assets/${cuts[1].id}/comments`)).json()).toEqual([]);
    await page.getByRole('button', { name: 'Done drawing', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
      'Draft on the second cut.',
    );
    await expect(page.getByRole('textbox', { name: 'Comment start time' })).toBeDisabled();
  } finally {
    releaseResponse();
  }
});
