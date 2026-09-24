import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('playback, time-range feedback, replies, edits, resolution, version isolation and export', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixtures = await (await request.get('/api/library')).json();
  const initialCut = fixtures
    .find((p: { name: string }) => p.name === 'Browser test project')
    .assets.find((a: { title: string }) => a.title === 'Cut two');
  await page.goto('/?cut=' + initialCut.id);
  await expect(page.getByRole('heading', { name: 'Cut two', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).focus();
  await page.keyboard.press('c');
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toBeFocused();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
    .toBe(true);
  await page.getByRole('button', { name: 'Keep this', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your comment' })
    .fill('Keep this opening and its natural lighting.');
  await page.getByRole('textbox', { name: 'Comment start time' }).fill('00:01.00');
  await page.getByRole('checkbox', { name: 'Time range' }).check();
  await page.getByRole('textbox', { name: 'Comment end time' }).fill('00:02.50');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(
    page
      .getByRole('article')
      .getByText('Keep this opening and its natural lighting.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue('');
  await expect(
    page
      .getByRole('article')
      .getByText('Keep this opening and its natural lighting.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '00:01 – 00:02', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime))
    .toBeCloseTo(1, 1);
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reply text' }).fill('This stays in the next edit.');
  await page.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(page.getByText('This stays in the next edit.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Edit comment' })
    .fill('Keep the opening; shorten the following pause.');
  await page.getByRole('button', { name: 'Save edit', exact: true }).click();
  await expect(page.getByText('Keep the opening; shorten the following pause.')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve note', exact: true }).click();
  await expect(page.getByText('All caught up.')).toBeVisible();
  await page.getByRole('button', { name: 'Resolved 1', exact: true }).click();
  await expect(page.getByText('Keep the opening; shorten the following pause.')).toBeVisible();
  await page.getByRole('button', { name: 'Reopen note', exact: true }).click();
  await page.getByRole('button', { name: 'Open 1', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your comment' })
    .fill('Unposted draft retained between cuts.');
  await page.getByRole('button', { name: /Cut one Ready for review/ }).click();
  await expect(page.getByText('What’s working in this cut?')).toBeVisible();
  await expect(page.getByText('Keep the opening; shorten the following pause.')).toHaveCount(0);
  await page.getByRole('button', { name: /Cut two 1 open note/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toHaveValue(
    'Unposted draft retained between cuts.',
  );
  await page.getByRole('combobox', { name: 'Review status' }).selectOption('changes');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Review status' })).toHaveValue('changes');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export feedback' }).click();
  const download = await downloadPromise;
  const exported = readFileSync((await download.path())!, 'utf8');
  expect(exported).toContain('00:01.00–00:02.50');
  expect(exported).toContain('This stays in the next edit.');
  expect(exported).toContain('changes');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByText('What’s working in this cut?')).toBeVisible();
  expect(errors).toEqual([]);
});
test('new project, upload, local import and mobile layout', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.getByLabel('Project name').fill('Future campaign');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page
    .getByLabel('Choose video file')
    .setInputFiles(readFileSync('test-results/fixture-path.txt', 'utf8'));
  await page.getByLabel('Cut title').fill('New uploaded cut');
  await page.getByRole('button', { name: 'Add video', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'New uploaded cut', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add video', exact: true }).click();
  await page.getByRole('button', { name: 'Link local file', exact: true }).click();
  await page
    .getByLabel('Full video path')
    .fill(readFileSync('test-results/fixture-path.txt', 'utf8'));
  await page.getByLabel('Cut title').fill('Linked local cut');
  await page.getByRole('button', { name: 'Add video', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Linked local cut', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your comment' })).toBeFocused();
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
});

test('raw library search, keep filters, original sources and source-clock feedback', async ({
  page,
  request,
}) => {
  const library = await (await request.get('/api/library')).json();
  const project = library.find((p: { name: string }) => p.name === 'Raw camera test');
  await page.goto('/?cut=' + project.assets[0].id);
  await expect(page.getByRole('heading', { name: 'All recordings 13', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous recording', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Next recording', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Raw take 02', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a recording' }).fill('take 12');
  await expect(
    page.getByRole('list', { name: 'Available recordings' }).getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: /Raw take 12 1 keep flag/ }).click();
  await expect(page.getByRole('heading', { name: 'Raw take 12', exact: true })).toBeVisible();
  await expect(page.getByText('Keep this good moment.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download original MP4', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download camera LRF', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a recording' }).fill('');
  await page.getByRole('combobox', { name: 'Filter recordings' }).selectOption('keep');
  await expect(
    page.getByRole('list', { name: 'Available recordings' }).getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Filter recordings' }).selectOption('unreviewed');
  await expect(
    page.getByRole('list', { name: 'Available recordings' }).getByRole('listitem'),
  ).toHaveCount(12);
});
