/**
 * PAdES-B-B signing of a PDF as an incremental update:
 *   1. append signature field (+ appearance) and a signature dictionary with placeholders,
 *   2. fill /ByteRange, hash everything except /Contents, build the CMS, inject it.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFSignature, PDFString, type PDFDocument, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { IncrementalUpdate } from '../../pdf/incremental';
import { buildCadesSignature, sha256 } from '../cms/cades';
import { signerDisplayName, type Signer } from '../signer';
import type { PageGeometry, Rect } from '../../viewer/coords';
import { viewRectToPdf } from '../../viewer/coords';
import { objectMatrix } from '../../export/writeContent';
import { pdfDate, pdfText } from '../../export/writeAnnots';
import { loadFontBytes } from '../../fonts';

export type DocMdpLevel = 1 | 2 | 3;

export interface SignAppearance {
  /** Graphical signature (transparent PNG). */
  image?: { bytes: Uint8Array; width: number; height: number };
  /** Show name/date/reason text next to the image. */
  showText: boolean;
}

export type SignField =
  | { kind: 'new'; page: number; geometry: PageGeometry; rect: Rect | null; appearance?: SignAppearance }
  | { kind: 'existing'; name: string; geometry?: PageGeometry; appearance?: SignAppearance };

export interface SignOptions {
  signer: Signer;
  field: SignField;
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Certification signature with DocMDP permissions (only allowed as the first signature). */
  certify?: DocMdpLevel;
  /** FieldMDP: form fields that become read-only once this signature is applied. */
  lockFields?: { action: 'All' | 'Include' | 'Exclude'; fields: string[] };
  date?: Date;
}

const PLACEHOLDER = 9999999999;
const enc = new TextEncoder();
const latin1 = new TextDecoder('latin1');

export class SignError extends Error {}

export async function signPdf(bytes: Uint8Array, opts: SignOptions): Promise<Uint8Array> {
  const up = await IncrementalUpdate.load(bytes);
  const doc = up.doc;
  const ctx = doc.context;
  const date = opts.date ?? new Date();
  const name = signerDisplayName(opts.signer.chain[0]);

  // ---- AcroForm ----
  const catalog = doc.catalog;
  let acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!acroForm) {
    acroForm = ctx.obj({ Fields: [] });
    catalog.set(PDFName.of('AcroForm'), ctx.register(acroForm));
  }
  let fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) {
    fields = ctx.obj([]);
    acroForm.set(PDFName.of('Fields'), fields);
  }
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  const existingSigs = doc.getForm().getFields().filter((f) => f instanceof PDFSignature) as PDFSignature[];
  const alreadySigned = existingSigs.some((f) => f.acroField.dict.get(PDFName.of('V')));
  if (opts.certify && alreadySigned) throw new SignError('A certification signature must be the first signature in the document.');
  if (catalog.lookupMaybe(PDFName.of('Perms'), PDFDict)?.get(PDFName.of('DocMDP'))) {
    const p = docMdpPermission(doc);
    if (p === 1) throw new SignError('The document was certified with "no changes allowed", so it cannot be signed again.');
  }

  // ---- signature dictionary with placeholders ----
  const certSize = opts.signer.chain.reduce((n, c) => n + c.toSchema().toBER().byteLength, 0);
  const contentsSize = Math.max(8192, certSize + 4096);
  const sigDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
    Contents: PDFHexString.of('0'.repeat(contentsSize * 2)),
    M: PDFString.of(pdfDate(date)),
    Prop_Build: { App: { Name: 'PDF_Editor' } },
  });
  sigDict.set(PDFName.of('Name'), pdfText(name));
  if (opts.reason) sigDict.set(PDFName.of('Reason'), pdfText(opts.reason));
  if (opts.location) sigDict.set(PDFName.of('Location'), pdfText(opts.location));
  if (opts.contactInfo) sigDict.set(PDFName.of('ContactInfo'), pdfText(opts.contactInfo));
  const sigRef = ctx.register(sigDict);

  if (opts.certify) {
    sigDict.set(
      PDFName.of('Reference'),
      ctx.obj([
        {
          Type: 'SigRef',
          TransformMethod: 'DocMDP',
          TransformParams: { Type: 'TransformParams', P: opts.certify, V: '1.2' },
        },
      ]),
    );
    const perms = catalog.lookupMaybe(PDFName.of('Perms'), PDFDict) ?? ctx.obj({});
    perms.set(PDFName.of('DocMDP'), sigRef);
    catalog.set(PDFName.of('Perms'), perms);
  }

  // FieldMDP: lock form fields once this signature is applied.
  const lock = opts.lockFields;
  const lockDict = lock
    ? ctx.obj({ Type: 'SigFieldLock', Action: lock.action, ...(lock.action !== 'All' ? { Fields: lock.fields.map((f) => pdfText(f)) } : {}) })
    : null;
  if (lock) {
    const params = ctx.obj({ Type: 'TransformParams', Action: lock.action, V: '1.2' });
    if (lock.action !== 'All') params.set(PDFName.of('Fields'), ctx.obj(lock.fields.map((f) => pdfText(f))));
    const entry = ctx.obj({ Type: 'SigRef', TransformMethod: 'FieldMDP', TransformParams: params });
    const refs = sigDict.lookupMaybe(PDFName.of('Reference'), PDFArray);
    if (refs) refs.push(entry);
    else sigDict.set(PDFName.of('Reference'), ctx.obj([entry]));
  }

  // ---- field + widget ----
  const lines = [`Digitally signed by ${name}`, `Date: ${humanDate(date)}`];
  if (opts.reason) lines.push(`Reason: ${opts.reason}`);
  if (opts.location) lines.push(`Location: ${opts.location}`);

  if (opts.field.kind === 'existing') {
    const field = opts.field;
    const f = existingSigs.find((s) => s.getName() === field.name);
    if (!f) throw new SignError(`Signature field "${field.name}" not found.`);
    if (f.acroField.dict.get(PDFName.of('V'))) throw new SignError(`Signature field "${field.name}" is already signed.`);
    f.acroField.dict.set(PDFName.of('V'), sigRef);
    for (const w of f.acroField.getWidgets()) {
      const r = w.getRectangle();
      if (r.width > 1 && r.height > 1 && field.appearance) {
        const pageIndex = doc.getPages().findIndex((p) => p.ref === w.P());
        const g = field.geometry ?? { viewBox: [0, 0, 1, 1] as [number, number, number, number], rotation: pageIndex >= 0 ? doc.getPage(pageIndex).getRotation().angle : 0 };
        const ap = await buildAppearance(doc, { width: r.width, height: r.height }, g.rotation, field.appearance, lines);
        w.dict.set(PDFName.of('AP'), ctx.obj({ N: ap }));
      }
      w.dict.set(PDFName.of('F'), PDFNumber.of(132)); // Print | Locked
      if (lockDict) f.acroField.dict.set(PDFName.of('Lock'), lockDict);
    }
  } else {
    const page = doc.getPage(opts.field.page);
    const used = new Set(doc.getForm().getFields().map((f) => f.getName()));
    let n = 1;
    while (used.has(`Signature${n}`)) n++;
    const widget = ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of(`Signature${n}`),
      F: 132,
      P: page.ref,
      V: sigRef,
      Rect: [0, 0, 0, 0],
    });
    const f = opts.field;
    if (f.rect) {
      const r = viewRectToPdf(f.geometry, 1, f.rect);
      widget.set(PDFName.of('Rect'), ctx.obj([r.x, r.y, r.x + r.width, r.y + r.height].map((v) => Number(v.toFixed(3)))));
      const ap = await buildAppearance(doc, { width: f.rect.width, height: f.rect.height }, f.geometry.rotation, f.appearance ?? { showText: true }, lines, f.rect, f.geometry);
      widget.set(PDFName.of('AP'), ctx.obj({ N: ap }));
    }
    if (lockDict) widget.set(PDFName.of('Lock'), lockDict);
    const widgetRef = ctx.register(widget);
    fields.push(widgetRef);
    addAnnot(page, widgetRef);
  }

  await doc.flush();
  const { bytes: out, appendedAt } = up.save();
  return injectSignature(out, appendedAt, contentsSize, opts.signer);
}

function addAnnot(page: PDFPage, ref: PDFRef) {
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), page.doc.context.obj([ref]));
}

export function docMdpPermission(doc: PDFDocument): number | null {
  const perms = doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict);
  const sig = perms?.lookupMaybe(PDFName.of('DocMDP'), PDFDict);
  const refs = sig?.lookupMaybe(PDFName.of('Reference'), PDFArray);
  if (!refs) return null;
  for (let i = 0; i < refs.size(); i++) {
    const r = refs.lookup(i, PDFDict);
    if (r.get(PDFName.of('TransformMethod'))?.toString() === '/DocMDP') {
      const p = r.lookupMaybe(PDFName.of('TransformParams'), PDFDict)?.get(PDFName.of('P'));
      return p instanceof PDFNumber ? p.asNumber() : 2;
    }
  }
  return null;
}

function humanDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}

/**
 * Appearance stream for a visible signature. Designed upright in "view" orientation (w×h as the
 * reader sees it); /Matrix rotates it to match the page rotation.
 */
async function buildAppearance(
  doc: PDFDocument,
  size: { width: number; height: number },
  rotation: number,
  ap: SignAppearance,
  lines: string[],
  viewRect?: Rect,
  g?: PageGeometry,
): Promise<PDFRef> {
  const ctx = doc.context;
  const w = size.width;
  const h = size.height;
  doc.registerFontkit(fontkit);
  const resources: Record<string, Record<string, PDFRef>> = {};
  let ops = '';
  let textBox = { x: 2, y: 2, w: w - 4, h: h - 4 };

  if (ap.image) {
    const img = await doc.embedPng(ap.image.bytes);
    const area = ap.showText ? { x: 2, y: 2, w: w * 0.5 - 4, h: h - 4 } : { x: 2, y: 2, w: w - 4, h: h - 4 };
    const k = Math.min(area.w / ap.image.width, area.h / ap.image.height);
    const iw = ap.image.width * k;
    const ih = ap.image.height * k;
    ops += `q ${iw.toFixed(3)} 0 0 ${ih.toFixed(3)} ${(area.x + (area.w - iw) / 2).toFixed(3)} ${(area.y + (area.h - ih) / 2).toFixed(3)} cm /Img Do Q\n`;
    resources.XObject = { Img: img.ref };
    textBox = { x: w * 0.5 + 2, y: 2, w: w * 0.5 - 4, h: h - 4 };
  }
  if (ap.showText) {
    const font = await doc.embedFont(await loadFontBytes('NotoSans-Regular.ttf'), { subset: true });
    resources.Font = { F1: font.ref };
    let size = Math.min(10, textBox.h / (lines.length * 1.25));
    const widest = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, 1)));
    size = Math.max(3, Math.min(size, textBox.w / widest));
    const lh = size * 1.25;
    const top = textBox.y + (textBox.h + lines.length * lh) / 2 - size;
    ops += 'BT 0 0 0 rg\n';
    lines.forEach((l, i) => {
      ops += `/F1 ${size.toFixed(2)} Tf 1 0 0 1 ${textBox.x.toFixed(2)} ${(top - i * lh).toFixed(2)} Tm ${font.encodeText(l).toString()} Tj\n`;
    });
    ops += 'ET\n';
  }

  // Rotation-only matrix (no translation): viewers map the transformed BBox onto /Rect.
  let matrix = [1, 0, 0, 1, 0, 0];
  if (g && viewRect && rotation) {
    const m = objectMatrix({ rect: { x: 0, y: 0, width: w, height: h }, rotation: 0 }, g);
    matrix = [m[0], m[1], m[2], m[3], 0, 0];
  } else if (rotation) {
    const a = (-rotation * Math.PI) / 180;
    matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0].map((v) => Math.round(v));
  }
  const stream = ctx.stream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, w, h],
    Matrix: matrix,
    Resources: resources,
  });
  return ctx.register(stream);
}

async function injectSignature(out: Uint8Array, appendedAt: number, contentsSize: number, signer: Signer): Promise<Uint8Array> {
  const tail = latin1.decode(out.subarray(appendedAt));
  const brText = `/ByteRange [ 0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER} ]`;
  const brAt = tail.indexOf(brText);
  if (brAt < 0) throw new SignError('Internal error: ByteRange placeholder not found');
  const zeros = '0'.repeat(contentsSize * 2);
  const ctAt = tail.indexOf(`/Contents <${zeros}>`);
  if (ctAt < 0) throw new SignError('Internal error: Contents placeholder not found');

  const contentsStart = appendedAt + ctAt + '/Contents '.length; // position of '<'
  const contentsEnd = contentsStart + zeros.length + 2; // after '>'
  const range = [0, contentsStart, contentsEnd, out.length - contentsEnd];

  const replacement = `/ByteRange [${range.join(' ')}]`;
  if (replacement.length > brText.length) throw new SignError('Internal error: ByteRange too long');
  out.set(enc.encode(replacement.padEnd(brText.length, ' ')), appendedAt + brAt);

  const digest = await sha256(out.subarray(0, contentsStart), out.subarray(contentsEnd));
  const cms = await buildCadesSignature(signer, digest);
  if (cms.length > contentsSize) throw new SignError(`Signature too large (${cms.length} > ${contentsSize} bytes)`);
  const hex = [...cms].map((b) => b.toString(16).padStart(2, '0')).join('');
  out.set(enc.encode(hex), contentsStart + 1);
  return out;
}
