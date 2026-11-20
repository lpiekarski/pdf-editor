import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { signPdf } from './sign';
import { loadP12 } from '../cms/p12';
import { setFontLoader } from '../../fonts';
import { exportPdf } from '../../export/pipeline';
import { hasPython, pyValidate, writeOut, TEST_CA } from '../../../tests/unit/py';
import type { PageGeometry } from '../../viewer/coords';

beforeAll(() => setFontLoader(async (f) => new Uint8Array(readFileSync(`public/fonts/${f}`))));

const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));
const p12 = fixture('certs/signer.p12');
const A4: PageGeometry = { viewBox: [0, 0, 595, 842], rotation: 0 };
// 1x1 black PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('loadP12', () => {
  it('loads modern and legacy (3DES) PKCS#12 files', async () => {
    for (const f of ['certs/signer.p12', 'certs/signer-legacy.p12']) {
      const { certificate, chain } = await loadP12(fixture(f), 'test');
      expect(certificate.subject.typesAndValues.some((t) => t.value.valueBlock.value === 'Jan Kowalski')).toBe(true);
      expect(chain).toHaveLength(1); // the test root CA
    }
  });

  it('rejects a wrong password', async () => {
    await expect(loadP12(p12, 'nope')).rejects.toMatchObject({ code: 'password' });
  });
});

describe.skipIf(!hasPython)('signPdf (validated with pyHanko)', () => {
  it('produces a valid, intact PAdES signature (visible, new field)', async () => {
    const { signer } = await loadP12(p12, 'test');
    const out = await signPdf(fixture('flat-form.pdf'), {
      signer,
      reason: 'Zatwierdzam',
      location: 'Kraków',
      field: { kind: 'new', page: 0, geometry: A4, rect: { x: 130, y: 402, width: 220, height: 60 }, appearance: { image: { bytes: PNG, width: 1, height: 1 }, showText: true } },
    });
    const [sig] = pyValidate('sigs', writeOut('signed-visible.pdf', out), TEST_CA).signatures;
    expect(sig).toMatchObject({ intact: true, valid: true, trusted: true, coverage: 'SignatureCoverageLevel.ENTIRE_FILE', subfilter: '/ETSI.CAdES.detached', bottom_line: true });
    expect(pyValidate('check', 'tests/output/signed-visible.pdf').ok).toBe(true);
  });

  it('signs invisibly, then signs again keeping the first signature valid', async () => {
    const { signer } = await loadP12(p12, 'test');
    const once = await signPdf(fixture('acroform.pdf'), { signer, field: { kind: 'new', page: 0, geometry: A4, rect: null } });
    const twice = await signPdf(once, { signer, field: { kind: 'new', page: 0, geometry: A4, rect: { x: 300, y: 700, width: 200, height: 50 } } });
    const sigs = pyValidate('sigs', writeOut('signed-twice.pdf', twice), TEST_CA).signatures;
    expect(sigs).toHaveLength(2);
    for (const s of sigs) expect(s).toMatchObject({ intact: true, valid: true, trusted: true });
    expect(sigs[0].modification_level).toBe('ModificationLevel.FORM_FILLING');
    expect(sigs[1].coverage).toBe('SignatureCoverageLevel.ENTIRE_FILE');
  });

  it('certifies with P=2, then form filling keeps the certification valid', async () => {
    // Field and widget merged into one dictionary, as in forms made with Acrobat.
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    const field = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('name'), Rect: [100, 700, 400, 724], F: 4, P: page.ref, DA: PDFString.of('/Helv 12 Tf 0 g') }),
    );
    page.node.addAnnot(field);
    const af = doc.catalog.getOrCreateAcroForm();
    af.addField(field);
    af.dict.set(PDFName.of('DR'), ctx.obj({ Font: { Helv: helv.ref } }));
    const form = await doc.save({ useObjectStreams: false });

    const { signer } = await loadP12(p12, 'test');
    const certified = await signPdf(form, { signer, certify: 2, field: { kind: 'new', page: 0, geometry: A4, rect: null } });
    const filled = await exportPdf({ bytes: certified, pages: [A4], objects: [], images: {}, formValues: { name: 'Anna Nowak-Łęcka' } });
    const [sig] = pyValidate('sigs', writeOut('certified-filled.pdf', filled), TEST_CA).signatures;
    expect(sig).toMatchObject({ intact: true, valid: true, docmdp_ok: true, modification_level: 'ModificationLevel.FORM_FILLING' });
  });

  it('signs into an existing empty signature field', async () => {
    const doc = await PDFDocument.load(fixture('flat-form.pdf'));
    const f = doc.getForm();
    const sig = f.createTextField('tmp'); // pdf-lib cannot create Sig fields; build one by hand
    f.removeField(sig);
    const ctx = doc.context;
    const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('ApproverSig'), Rect: [130, 380, 350, 440], F: 4, P: doc.getPage(0).ref }));
    doc.getPage(0).node.addAnnot(widget);
    doc.catalog.getOrCreateAcroForm().addField(widget);
    const withField = await doc.save();
    const { signer } = await loadP12(p12, 'test');
    const out = await signPdf(withField, { signer, field: { kind: 'existing', name: 'ApproverSig', appearance: { showText: true } } });
    const [s] = pyValidate('sigs', writeOut('signed-existing.pdf', out), TEST_CA).signatures;
    expect(s).toMatchObject({ field: 'ApproverSig', intact: true, valid: true });
  });
});
