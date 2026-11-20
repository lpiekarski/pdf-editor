import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectFields, type TextItemLike } from './detect';
import type { PageGeometry } from '../viewer/coords';

async function detect(file: string, pageNo = 1) {
  const task = getDocument({ data: new Uint8Array(readFileSync(file)) });
  const pdf = await task.promise;
  const page = await pdf.getPage(pageNo);
  const g: PageGeometry = { viewBox: page.view as PageGeometry['viewBox'], rotation: page.rotate };
  const ol = await page.getOperatorList();
  const tc = await page.getTextContent();
  const fields = detectFields(pageNo - 1, g, ol, OPS, tc.items as TextItemLike[]);
  await task.destroy();
  return fields;
}

describe('detectFields', () => {
  it('finds lines, typed underscores, checkboxes and the signature box on the flat form', async () => {
    const f = await detect('tests/fixtures/flat-form.pdf');
    const by = (k: string) => f.filter((x) => x.kind === k);
    // Name, Surname, Address, Date (drawn lines) + Phone (underscores)
    expect(by('line')).toHaveLength(5);
    expect(by('checkbox')).toHaveLength(2);
    expect(by('box')).toHaveLength(1);
    // The Name line is at y = 842 - 728 = 114 in view space; the field sits right above it.
    const name = by('line').find((x) => Math.abs(x.rect.y + x.rect.height - 114) < 1)!;
    expect(name.rect.x).toBeCloseTo(130, 0);
    expect(name.rect.width).toBeCloseTo(320, 0);
    // Checkbox at x=50, top = 842 - (528 + 12) = 302
    const cb = by('checkbox')[0];
    expect(cb.rect).toMatchObject({ x: 50, width: 12, height: 12 });
    expect(cb.rect.y).toBeCloseTo(302, 0);
  });

  it('finds nothing to fill on a page with only text', async () => {
    const f = await detect('tests/fixtures/multipage-rotated.pdf');
    expect(f).toHaveLength(0);
  });

  it('handles the Polish label with underscores', async () => {
    const f = await detect('tests/fixtures/polish.pdf');
    expect(f.filter((x) => x.kind === 'line')).toHaveLength(1);
  });
});
