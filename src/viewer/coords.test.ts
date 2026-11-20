import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToView, viewToPdf, viewSize, viewTransform, type PageGeometry } from './coords';

describe('coords', () => {
  it('matches pdf.js PageViewport for every page (rotation + cropbox) and round-trips', async () => {
    const data = new Uint8Array(readFileSync('tests/fixtures/multipage-rotated.pdf'));
    const task = getDocument({ data });
    const pdf = await task.promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      for (const scale of [1, 1.75]) {
        for (const extra of [0, 90, 180, 270]) {
          const vp = page.getViewport({ scale, rotation: page.rotate + extra });
          const g: PageGeometry = { viewBox: page.view as PageGeometry['viewBox'], rotation: page.rotate + extra };
          const m = viewTransform(g, scale);
          m.forEach((v, k) => expect(v).toBeCloseTo(vp.transform[k], 6));
          expect(viewSize(g, scale).width).toBeCloseTo(vp.width, 6);
          expect(viewSize(g, scale).height).toBeCloseTo(vp.height, 6);
          const p = { x: 123.4, y: 456.7 };
          const back = viewToPdf(g, scale, pdfToView(g, scale, p));
          expect(back.x).toBeCloseTo(p.x, 6);
          expect(back.y).toBeCloseTo(p.y, 6);
        }
      }
    }
    await task.destroy();
  });
});
