import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeSignatures } from './analyze';
import { signPdf } from '../pdf/sign';
import { loadP12 } from '../cms/p12';
import { exportPdf } from '../../export/pipeline';
import { setFontLoader } from '../../fonts';
import type { PageGeometry } from '../../viewer/coords';

beforeAll(() => setFontLoader(async (f) => new Uint8Array(readFileSync(`public/fonts/${f}`))));
const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));
const A4: PageGeometry = { viewBox: [0, 0, 595, 842], rotation: 0 };

describe('analyzeSignatures', () => {
  it('reports nothing for unsigned files', async () => {
    expect((await analyzeSignatures(fixture('flat-form.pdf'))).signatures).toEqual([]);
  });

  it('validates a pyHanko signature (independent implementation)', async () => {
    const { signatures } = await analyzeSignatures(fixture('signed-pyhanko.pdf'));
    expect(signatures).toHaveLength(1);
    const s = signatures[0];
    expect(s).toMatchObject({ fieldName: 'Signature1', integrity: 'ok', signatureValid: true, coversWholeFile: true, level: 'PAdES-B-B', reason: 'Test reason', location: 'Warsaw', signerName: 'Jan Kowalski' });
    expect(s.page).toBe(0);
    expect(s.rect).toEqual([380, 40, 560, 100]);
  });

  it('detects tampering', async () => {
    const [s] = (await analyzeSignatures(fixture('tampered-pyhanko.pdf'))).signatures;
    expect(s.integrity).toBe('mismatch');
  });

  it('reads certification level and classifies later changes', async () => {
    const twice = await analyzeSignatures(fixture('signed-twice-pyhanko.pdf'));
    expect(twice.signatures.map((s) => s.fieldName)).toEqual(['Signature1', 'Signature2']);
    expect(twice.signatures[0].changes).toEqual(['signing']);
    expect(twice.signatures[0].changesAllowed).toBe(true);
    expect(twice.signatures[1].coversWholeFile).toBe(true);
    const cert = await analyzeSignatures(fixture('certified-pyhanko.pdf'));
    expect(cert.docMdp).toBe(2);
    expect(cert.signatures[0].certification).toBe(2);
  });

  it('classifies form filling vs content edits after our own signature', async () => {
    const { signer } = await loadP12(fixture('certs/signer.p12'), 'test');
    const signed = await signPdf(fixture('acroform.pdf'), { signer, certify: 2, field: { kind: 'new', page: 0, geometry: A4, rect: null } });
    const ours = await analyzeSignatures(signed);
    expect(ours.signatures[0]).toMatchObject({ integrity: 'ok', signatureValid: true, coversWholeFile: true, certification: 2 });

    const filled = await exportPdf({ bytes: signed, pages: [A4], objects: [], images: {}, formValues: { name: 'X' } });
    const f = (await analyzeSignatures(filled)).signatures[0];
    expect(f.integrity).toBe('ok');
    expect(f.changes).toEqual(['form']);
    expect(f.changesAllowed).toBe(true);

    const edited = await exportPdf({
      bytes: signed, pages: [A4], images: {}, formValues: {},
      objects: [{ id: 't', kind: 'text', page: 0, rotation: 0, opacity: 1, rect: { x: 50, y: 50, width: 100, height: 14 }, text: 'changed', font: 'sans', bold: false, italic: false, size: 12, color: [0, 0, 0], align: 'left', background: null }],
    });
    const g = (await analyzeSignatures(edited)).signatures[0];
    expect(g.integrity).toBe('ok'); // the signed revision itself is intact…
    expect(g.changes).toContain('other'); // …but the page content changed afterwards
    expect(g.changesAllowed).toBe(false);
  });
});
