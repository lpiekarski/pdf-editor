import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PDFName, PDFString, PDFArray, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IncrementalUpdate, readLastXref } from './incremental';
import { hasPython, pyValidate, writeOut, TEST_CA } from '../../tests/unit/py';

// (The password-protected fixture is covered by crypt.test.ts.)
const fixtures = readdirSync('tests/fixtures').filter((f) => f.endsWith('.pdf') && !f.startsWith('tampered') && !f.includes('password'));

async function addNote(bytes: Uint8Array) {
  const up = await IncrementalUpdate.load(bytes);
  const ctx = up.context;
  const page = up.doc.getPage(0);
  const note = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], Contents: PDFString.of('added incrementally'), F: 4 }),
  );
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(note);
  else page.node.set(PDFName.of('Annots'), ctx.obj([note]));
  return up;
}

async function annotCount(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const n = (await (await pdf.getPage(1)).getAnnotations()).length;
  await task.destroy();
  return n;
}

describe('IncrementalUpdate', () => {
  it('detects no changes when nothing is modified', async () => {
    const up = await IncrementalUpdate.load(readFileSync('tests/fixtures/acroform.pdf'));
    expect(up.changedRefs()).toEqual([]);
  });

  it.each(fixtures)('appends an annotation to %s without touching original bytes', async (name) => {
    const original = new Uint8Array(readFileSync(`tests/fixtures/${name}`));
    const before = await annotCount(original);
    const up = await addNote(original);
    const kind = up.prev.kind;
    const changed = up.changedRefs().length;
    expect(changed).toBeGreaterThanOrEqual(2); // new annot + page (or its Annots array)
    const { bytes } = up.save();

    expect(bytes.subarray(0, original.length)).toEqual(original);
    expect(await annotCount(bytes)).toBe(before + 1);

    // A second update on top of the first works too (chained /Prev).
    const second = await addNote(bytes);
    expect(second.prev.kind).toBe(kind);
    const twice = second.save().bytes;
    expect(await annotCount(twice)).toBe(before + 2);
    const ctx = second.context;
    expect(readLastXref(twice, ctx).size).toBeGreaterThanOrEqual(readLastXref(bytes, ctx).size);

    if (hasPython) {
      const out = writeOut(`incremental-${name}`, twice);
      expect(pyValidate('check', out).ok).toBe(true);
    }
  });

  it.skipIf(!hasPython)('keeps an existing pyHanko signature intact', async () => {
    const original = new Uint8Array(readFileSync('tests/fixtures/signed-pyhanko.pdf'));
    const { bytes } = (await addNote(original)).save();
    const out = writeOut('incremental-signed.pdf', bytes);
    const [sig] = pyValidate('sigs', out, TEST_CA).signatures;
    expect(sig.intact).toBe(true);
    expect(sig.valid).toBe(true);
    expect(sig.coverage).toBe('SignatureCoverageLevel.ENTIRE_REVISION');
  });

  it('keeps the catalog reachable', async () => {
    const original = new Uint8Array(readFileSync('tests/fixtures/flat-form-xrefstream.pdf'));
    const { bytes } = (await addNote(original)).save();
    const re = await IncrementalUpdate.load(bytes);
    expect(re.doc.catalog).toBeInstanceOf(PDFDict);
    expect(re.doc.getPageCount()).toBe(1);
  });
});
