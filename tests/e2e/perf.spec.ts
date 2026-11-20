import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test('opens a 200-page document quickly and renders on demand', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'performance budget measured on desktop only');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 200; i++) {
    const p = doc.addPage([595, 842]);
    for (let l = 0; l < 40; l++) p.drawText(`Page ${i} line ${l} lorem ipsum dolor sit amet`, { x: 40, y: 800 - l * 19, size: 11, font });
  }
  const bytes = Buffer.from(await doc.save());

  await page.goto('/');
  const t0 = Date.now();
  await page.setInputFiles('[data-testid=file-input]', { name: 'big.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('.page[data-page="0"] canvas')).toBeVisible();
  const firstPage = Date.now() - t0;

  const t1 = Date.now();
  await page.evaluate(() => {
    const v = document.querySelector('[data-testid=viewer]')!;
    v.scrollTop = (document.querySelector('.page[data-page="150"]') as HTMLElement).offsetTop;
  });
  await expect(page.locator('.page[data-page="150"] canvas')).toBeVisible();
  const jump = Date.now() - t1;

  const live = await page.locator('.page canvas').count();
  console.log(`first page ${firstPage} ms, jump ${jump} ms, live canvases ${live}`);
  expect(firstPage).toBeLessThan(2500);
  expect(jump).toBeLessThan(1500);
  expect(live).toBeLessThanOrEqual(6); // virtualised: only pages near the viewport keep canvases
});
