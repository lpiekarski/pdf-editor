import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from './pipeline';
import { setFontLoader } from '../fonts';
import type { EditorObject, StoredImage } from '../model/types';
import type { PageGeometry } from '../viewer/coords';
import { hasPython, pyValidate, writeOut } from '../../tests/unit/py';

beforeAll(() => setFontLoader(async (f) => new Uint8Array(readFileSync(`public/fonts/${f}`))));

// 1x1 red PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const images: Record<string, StoredImage> = { img1: { id: 'img1', bytes: PNG, mime: 'image/png', width: 1, height: 1, url: '' } };

async function pagesOf(bytes: Uint8Array): Promise<PageGeometry[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const b = p.getCropBox();
    return { viewBox: [b.x, b.y, b.x + b.width, b.y + b.height], rotation: p.getRotation().angle };
  });
}

async function textOf(bytes: Uint8Array, page = 1) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const p = await pdf.getPage(page);
  const tc = await p.getTextContent();
  const items = tc.items as { str: string; transform: number[] }[];
  const annots = await p.getAnnotations();
  const vp = p.getViewport({ scale: 1 });
  await task.destroy();
  return { items, annots, vp };
}

const base = { rotation: 0, opacity: 1 };
const textObj = (page: number, x: number, y: number, text: string): EditorObject => ({
  ...base, id: `t${page}${x}`, kind: 'text', page, rect: { x, y, width: 300, height: 14.4 }, text,
  font: 'sans', bold: false, italic: false, size: 12, color: [0, 0, 0], align: 'left', background: null,
});

describe('exportPdf', () => {
  it('writes text, image, shapes, ink, marks and annotations; reopens cleanly', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/flat-form.pdf'));
    const objects: EditorObject[] = [
      textObj(0, 130, 98, 'Zażółć gęślą jaźń'),
      { ...base, id: 'i', kind: 'image', page: 0, imageId: 'img1', rect: { x: 130, y: 420, width: 100, height: 40 } },
      { ...base, id: 's', kind: 'shape', shape: 'rect', page: 0, rect: { x: 300, y: 600, width: 80, height: 40 }, stroke: [1, 0, 0], fill: null, strokeWidth: 2 },
      { ...base, id: 'e', kind: 'shape', shape: 'arrow', page: 0, rect: { x: 300, y: 660, width: 80, height: 40 }, stroke: [0, 0, 1], fill: null, strokeWidth: 2, from: { x: 0.1, y: 0.1 }, to: { x: 0.9, y: 0.9 } },
      { ...base, id: 'k', kind: 'ink', page: 0, rect: { x: 50, y: 700, width: 100, height: 50 }, color: [0, 0, 0.5], width: 2, paths: [[{ x: 5, y: 5 }, { x: 50, y: 40 }, { x: 95, y: 10 }]] },
      { ...base, id: 'm', kind: 'mark', mark: 'check', page: 0, rect: { x: 50, y: 300, width: 12, height: 12 }, color: [0, 0, 0] },
      { ...base, id: 'w', kind: 'whiteout', page: 0, rect: { x: 400, y: 50, width: 100, height: 20 }, color: [1, 1, 1] },
      { ...base, id: 'h', kind: 'highlight', page: 0, rect: { x: 50, y: 40, width: 150, height: 22 }, quads: [{ x: 50, y: 40, width: 150, height: 22 }], color: [1, 1, 0], text: 'Application form' },
      { ...base, id: 'n', kind: 'note', page: 0, rect: { x: 500, y: 100, width: 20, height: 20 }, color: [1, 0.8, 0.3], text: 'Notatka: proszę sprawdzić' },
    ];
    const out = await exportPdf({ bytes, pages: await pagesOf(bytes), objects, images, formValues: {} });
    expect(out.subarray(0, bytes.length)).toEqual(bytes); // incremental: original preserved

    const { items, annots, vp } = await textOf(out);
    const added = items.find((i) => i.str.includes('Zażółć'));
    expect(added, 'text is extractable with Polish characters').toBeTruthy();
    // Baseline position: top of box 98 + baselineOffset (≈ 12*1.2/2 + ...) → view y ≈ 98 + ~11
    const [vx, vy] = vp.convertToViewportPoint(added!.transform[4], added!.transform[5]);
    expect(vx).toBeCloseTo(130, 0);
    expect(vy).toBeGreaterThan(98 + 8);
    expect(vy).toBeLessThan(98 + 14.4);

    const subtypes = annots.map((a: { subtype: string }) => a.subtype).sort();
    expect(subtypes).toEqual(['Highlight', 'Text']);
    const note = annots.find((a: { subtype: string }) => a.subtype === 'Text') as { contentsObj: { str: string } };
    expect(note.contentsObj.str).toBe('Notatka: proszę sprawdzić');

    const doc = await PDFDocument.load(out);
    const res = doc.getPage(0).node.Resources()!;
    const xobjects = res.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects.keys().length).toBeGreaterThanOrEqual(1); // the image
    expect(doc.getPage(0).node.lookup(PDFName.of('Contents'), PDFArray).size()).toBe(4); // q, original, Q, ours

    if (hasPython) expect(pyValidate('check', writeOut('export-flat.pdf', out)).ok).toBe(true);
  });

  it('places objects correctly on rotated pages', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/multipage-rotated.pdf'));
    const pages = await pagesOf(bytes);
    expect(pages[1].rotation).toBe(90);
    const out = await exportPdf({ bytes, pages, objects: [textObj(1, 100, 100, 'Rotated hello')], images, formValues: {} });
    const { items, vp } = await textOf(out, 2);
    const it = items.find((i) => i.str === 'Rotated hello')!;
    const [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    expect(vx).toBeCloseTo(100, 0);
    expect(vy).toBeGreaterThan(100);
    expect(vy).toBeLessThan(115);
    // Upright for the reader: text direction in viewport space is +x.
    const [ex] = vp.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
    expect(ex).toBeGreaterThan(vx);
  });

  it('fills AcroForm fields with Unicode values and optional flattening', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/acroform.pdf'));
    const formValues = { name: 'Łukasz Żółć', agree: true, size: 'M', country: 'Germany', pin: '1234567', comments: 'Line 1\nLinia 2' };
    const out = await exportPdf({ bytes, pages: await pagesOf(bytes), objects: [], images, formValues });
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('name').getText()).toBe('Łukasz Żółć');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('size').getSelected()).toBe('M');
    expect(form.getDropdown('country').getSelected()).toEqual(['Germany']);
    expect(form.getTextField('pin').getText()).toBe('1234'); // maxLength 4

    const flat = await exportPdf({ bytes, pages: await pagesOf(bytes), objects: [], images, formValues, flattenForms: true });
    expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0);
    const { items } = await textOf(flat);
    expect(items.some((i) => i.str.includes('Łukasz'))).toBe(true);
  });

  it('returns the original bytes when nothing changed', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/polish.pdf'));
    const out = await exportPdf({ bytes, pages: await pagesOf(bytes), objects: [], images, formValues: {} });
    expect(out).toBe(bytes);
  });
});
