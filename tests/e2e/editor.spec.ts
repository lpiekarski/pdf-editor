import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const FIX = 'tests/fixtures';
const python = ['.venv/Scripts/python.exe', '.venv/bin/python'].find((p) => existsSync(p));

test.beforeEach(async ({ page }) => {
  // Deterministic saving: no native "Save as" picker or share sheet, plain downloads instead.
  await page.addInitScript(() => {
    // @ts-expect-error test override
    delete window.showSaveFilePicker;
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
});

async function open(page: Page, fixture: string) {
  await page.goto('/');
  await page.setInputFiles('[data-testid=file-input]', `${FIX}/${fixture}`);
  await expect(page.locator('.page canvas').first()).toBeVisible({ timeout: 20000 });
}

async function save(page: Page, name: string): Promise<Uint8Array> {
  await page.getByTestId('save').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('save-confirm').click();
  const path = await (await download).path();
  const bytes = new Uint8Array(readFileSync(path));
  mkdirSync('tests/output/e2e', { recursive: true });
  writeFileSync(`tests/output/e2e/${name}`, bytes);
  return bytes;
}

async function pageText(bytes: Uint8Array, n = 1) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const p = await pdf.getPage(n);
  const text = ((await p.getTextContent()).items as { str: string }[]).map((i) => i.str).join(' ');
  const annots = (await p.getAnnotations()).map((a: { subtype: string }) => a.subtype);
  await task.destroy();
  return { text, annots };
}

/** Clicks at a point given in page view units (PDF points from the top-left). */
async function clickOnPage(page: Page, x: number, y: number) {
  const box = (await page.locator('.page').first().boundingBox())!;
  const zoom = box.width / 595;
  await page.mouse.click(box.x + x * zoom, box.y + y * zoom);
}

test('adds text with Polish characters to a flat PDF and saves it', async ({ page }) => {
  await open(page, 'flat-form.pdf');
  await page.getByTestId('tool-text').click();
  await clickOnPage(page, 300, 500);
  await page.keyboard.type('Zażółć gęślą jaźń');
  await clickOnPage(page, 300, 780); // finish editing
  const out = await save(page, 'text.pdf');
  expect((await pageText(out)).text).toContain('Zażółć gęślą jaźń');
});

test('fills detected blanks in fill mode', async ({ page }) => {
  await open(page, 'flat-form.pdf');
  await page.getByTestId('fill-mode').click();
  await expect(page.locator('.hotspot')).toHaveCount(8);
  await page.locator('.hotspot-line').first().click();
  await page.keyboard.type('Kowalski');
  await page.locator('.hotspot-checkbox').first().click();
  await expect(page.locator('.obj-mark')).toHaveCount(1);
  const out = await save(page, 'fill-mode.pdf');
  expect((await pageText(out)).text).toContain('Kowalski');
});

test('fills real AcroForm fields', async ({ page }) => {
  await open(page, 'acroform.pdf');
  await page.locator('input[data-field=name]').fill('Łucja Żak');
  await page.locator('label[data-field=agree] input').check({ force: true });
  await page.locator('select[data-field=country]').selectOption('Poland');
  const out = await save(page, 'acroform.pdf');
  const form = (await PDFDocument.load(out)).getForm();
  expect(form.getTextField('name').getText()).toBe('Łucja Żak');
  expect(form.getCheckBox('agree').isChecked()).toBe(true);
  expect(form.getDropdown('country').getSelected()).toEqual(['Poland']);
});

test('highlights existing text as a real annotation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phones use native long-press selection handles, which cannot be scripted reliably');
  await open(page, 'flat-form.pdf');
  await page.getByTestId('group-markup').click();
  await page.getByTestId('tool-highlight').click();
  const span = page.locator('.textLayer span', { hasText: 'Application form' }).first();
  const b = (await span.boundingBox())!;
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.obj-highlight')).toHaveCount(1);
  const out = await save(page, 'highlight.pdf');
  expect((await pageText(out)).annots).toContain('Highlight');
});

test('draws a graphical signature and places it', async ({ page }) => {
  await open(page, 'flat-form.pdf');
  await page.getByTestId('tool-signature').click();
  const pad = (await page.locator('.draw-pad').boundingBox())!;
  await page.mouse.move(pad.x + 30, pad.y + pad.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + 30 + i * 18, pad.y + pad.height * (i % 2 ? 0.3 : 0.7), { steps: 3 });
  await page.mouse.up();
  await page.getByTestId('sig-done').click();
  await expect(page.locator('.obj-image')).toHaveCount(1);
  const out = await save(page, 'graphic-signature.pdf');
  const doc = await PDFDocument.load(out);
  const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  expect(xobjects.keys().length).toBeGreaterThan(0);
});

test('signs digitally with a certificate file and shows the valid signature', async ({ page }) => {
  await open(page, 'flat-form.pdf');
  await page.getByTestId('sign').click();
  await page.setInputFiles('[data-testid=p12-input]', `${FIX}/certs/signer.p12`);
  await page.getByTestId('p12-password').fill('test');
  await page.getByTestId('p12-unlock').click();
  await expect(page.locator('.cert-card')).toContainText('Jan Kowalski');
  const download = page.waitForEvent('download');
  await page.getByTestId('sign-confirm').click();
  const bytes = new Uint8Array(readFileSync(await (await download).path()));
  await expect(page.getByTestId('sig-banner')).toContainText('all valid', { timeout: 20000 });
  if (python) {
    mkdirSync('tests/output/e2e', { recursive: true });
    const file = `tests/output/e2e/signed-${test.info().project.name}.pdf`;
    writeFileSync(file, bytes);
    const res = JSON.parse(execFileSync(python, ['tools/validate.py', 'sigs', file, `${FIX}/certs/ca.crt`], { encoding: 'utf8' }));
    expect(res.signatures[0]).toMatchObject({ intact: true, valid: true, trusted: true });
  }
});

test('flags a tampered signed document as invalid', async ({ page }) => {
  await open(page, 'tampered-pyhanko.pdf');
  await expect(page.getByTestId('sig-banner')).toContainText('INVALID', { timeout: 20000 });
});

test('undo and redo work for placed objects', async ({ page }) => {
  await open(page, 'flat-form.pdf');
  await page.getByTestId('group-fill').click();
  await page.getByTestId('tool-check').click();
  await clickOnPage(page, 56, 308);
  await expect(page.locator('.obj-mark')).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(page.locator('.obj-mark')).toHaveCount(0);
  await page.getByTestId('redo').click();
  await expect(page.locator('.obj-mark')).toHaveCount(1);
});
