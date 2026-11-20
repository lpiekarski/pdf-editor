/**
 * Finds and validates every signature in a PDF, completely offline:
 *  - integrity: /ByteRange covers the file except /Contents, digest matches the CMS
 *  - signature: CMS signature verifies with the signer certificate's public key
 *  - changes after signing: later revisions are diffed and classified (signing / form fill /
 *    comments / other) and judged against DocMDP permissions
 * Certificate trust is NOT evaluated (no trust store): the chain is shown for information only.
 */
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';
import { ensureCryptoEngine, OID, signerDisplayName } from '../signer';

export type ChangeKind = 'signing' | 'form' | 'annotation' | 'other';
export type Level = 'PAdES-B-B' | 'PAdES-B-T' | 'PAdES-B-LT' | 'PAdES-B-LTA' | 'PKCS#7' | 'Document timestamp' | 'Unknown';

export interface SignatureInfo {
  index: number;
  fieldName: string;
  kind: 'signature' | 'timestamp';
  subFilter: string;
  /** Page index and PDF-space rect of the visible widget, if any. */
  page: number | null;
  rect: [number, number, number, number] | null;
  signerName: string | null;
  certificate: pkijs.Certificate | null;
  chain: pkijs.Certificate[];
  claimedTime: Date | null; // /M or signingTime attribute
  timestampTime: Date | null; // signature timestamp token
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  certification: number | null; // DocMDP P if this is a certification signature
  level: Level;
  /** /ByteRange end — the length of the signed revision. */
  revisionEnd: number;
  coversWholeFile: boolean;
  integrity: 'ok' | 'mismatch' | 'malformed' | 'unknown';
  signatureValid: boolean | null;
  digestAlgorithm: string | null;
  /** Changes made after this signature (in later revisions). */
  changes: ChangeKind[];
  changesAllowed: boolean;
  revocationInfo: { ocsps: number; crls: number; embeddedInCms: boolean };
  errors: string[];
}

export interface DocSignatures {
  signatures: SignatureInfo[];
  docMdp: number | null;
  hasDss: boolean;
}

const latin1 = new TextDecoder('latin1');

const str = (o: PDFObject | undefined): string | null => {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return null;
};

export function parsePdfDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * (+th * 60 + +tm) * 60000;
  return new Date(t);
}

const HASH: Record<string, string> = { [OID.sha256]: 'SHA-256', [OID.sha1]: 'SHA-1', [OID.sha384]: 'SHA-384', [OID.sha512]: 'SHA-512' };

async function digestRanges(alg: string, bytes: Uint8Array, br: number[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i + 1 < br.length; i += 2) parts.push(bytes.subarray(br[i], br[i] + br[i + 1]));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest(alg, buf as BufferSource));
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Exact DER length of the first element (strips the zero padding of /Contents). */
function derSlice(b: Uint8Array): Uint8Array {
  const r = asn1js.fromBER(b.slice().buffer);
  return r.offset > 0 ? b.subarray(0, r.offset) : b;
}

interface SigEntry {
  fieldName: string;
  sig: PDFDict;
  widget: PDFDict | null;
}

/** All filled signature fields (walking field kids), in the order of their /ByteRange. */
function findSignatureDicts(doc: PDFDocument): SigEntry[] {
  const out: SigEntry[] = [];
  const af = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = af?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  const seen = new Set<PDFDict>();
  const walk = (ref: PDFObject, parentName: string, inheritedFT: string | null) => {
    const d = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(d instanceof PDFDict) || seen.has(d)) return;
    seen.add(d);
    const t = str(d.get(PDFName.of('T')));
    const name = t ? (parentName ? `${parentName}.${t}` : t) : parentName;
    const ft = d.get(PDFName.of('FT'))?.toString() ?? inheritedFT;
    const kids = d.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (ft === '/Sig') {
      const v = d.lookupMaybe(PDFName.of('V'), PDFDict);
      if (v) {
        const widget = d.get(PDFName.of('Subtype'))?.toString() === '/Widget' ? d : kids ? (kids.lookup(0) as PDFDict) : null;
        out.push({ fieldName: name, sig: v, widget });
      }
      return;
    }
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.get(i), name, ft);
  };
  if (fields) for (let i = 0; i < fields.size(); i++) walk(fields.get(i), '', null);
  const br = (e: SigEntry) => (e.sig.lookupMaybe(PDFName.of('ByteRange'), PDFArray)?.lookup(2, PDFNumber).asNumber() ?? 0);
  return out.sort((a, b) => br(a) - br(b));
}

function widgetLocation(doc: PDFDocument, w: PDFDict | null): { page: number | null; rect: SignatureInfo['rect'] } {
  if (!w) return { page: null, rect: null };
  const r = w.lookupMaybe(PDFName.of('Rect'), PDFArray);
  const rect = r ? (r.asArray().map((x) => (x as PDFNumber).asNumber()) as [number, number, number, number]) : null;
  const visible = rect && Math.abs(rect[2] - rect[0]) > 1 && Math.abs(rect[3] - rect[1]) > 1;
  const pRef = w.get(PDFName.of('P'));
  let page = doc.getPages().findIndex((p) => p.ref === pRef);
  if (page < 0) page = doc.getPages().findIndex((p) => p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray().some((a) => a instanceof PDFRef && doc.context.lookup(a) === w));
  return { page: page >= 0 ? page : null, rect: visible ? [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])] : null };
}

function certificationLevel(sig: PDFDict): number | null {
  const refs = sig.lookupMaybe(PDFName.of('Reference'), PDFArray);
  if (!refs) return null;
  for (let i = 0; i < refs.size(); i++) {
    const r = refs.lookup(i);
    if (r instanceof PDFDict && r.get(PDFName.of('TransformMethod'))?.toString() === '/DocMDP') {
      const p = r.lookupMaybe(PDFName.of('TransformParams'), PDFDict)?.get(PDFName.of('P'));
      return p instanceof PDFNumber ? p.asNumber() : 2;
    }
  }
  return null;
}

export async function analyzeSignatures(bytes: Uint8Array): Promise<DocSignatures> {
  ensureCryptoEngine();
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch {
    return { signatures: [], docMdp: null, hasDss: false };
  }
  const entries = findSignatureDicts(doc);
  const hasDss = !!doc.catalog.get(PDFName.of('DSS'));
  const docTsEnds: number[] = [];
  const results: SignatureInfo[] = [];

  for (const [index, e] of entries.entries()) {
    const sig = e.sig;
    const errors: string[] = [];
    const subFilter = sig.get(PDFName.of('SubFilter'))?.toString().slice(1) ?? '';
    const isDocTs = sig.get(PDFName.of('Type'))?.toString() === '/DocTimeStamp' || subFilter === 'ETSI.RFC3161';
    const brArr = sig.lookupMaybe(PDFName.of('ByteRange'), PDFArray);
    const br = brArr ? brArr.asArray().map((x) => (x as PDFNumber).asNumber()) : [];
    const contentsObj = sig.get(PDFName.of('Contents'));
    const contents = contentsObj instanceof PDFHexString ? contentsObj.asBytes() : contentsObj instanceof PDFString ? contentsObj.asBytes() : new Uint8Array();
    const loc = widgetLocation(doc, e.widget);
    const info: SignatureInfo = {
      index,
      fieldName: e.fieldName,
      kind: isDocTs ? 'timestamp' : 'signature',
      subFilter,
      page: loc.page,
      rect: loc.rect,
      signerName: str(sig.get(PDFName.of('Name'))),
      certificate: null,
      chain: [],
      claimedTime: parsePdfDate(str(sig.get(PDFName.of('M')))),
      timestampTime: null,
      reason: str(sig.get(PDFName.of('Reason'))),
      location: str(sig.get(PDFName.of('Location'))),
      contactInfo: str(sig.get(PDFName.of('ContactInfo'))),
      certification: certificationLevel(sig),
      level: 'Unknown',
      revisionEnd: br.length === 4 ? br[2] + br[3] : 0,
      coversWholeFile: br.length === 4 && br[2] + br[3] === bytes.length,
      integrity: 'unknown',
      signatureValid: null,
      digestAlgorithm: null,
      changes: [],
      changesAllowed: true,
      revocationInfo: { ocsps: 0, crls: 0, embeddedInCms: false },
      errors,
    };

    // ---- ByteRange sanity ----
    const wellFormed =
      br.length === 4 && br[0] === 0 && br[1] > 0 && br[2] > br[1] && br[2] + br[3] <= bytes.length && bytes[br[1]] === 0x3c && bytes[br[2] - 1] === 0x3e;
    if (!wellFormed) {
      info.integrity = 'malformed';
      errors.push('The signature byte range is malformed or does not cover the signed data correctly.');
      results.push(info);
      continue;
    }
    // The excluded gap must be exactly the /Contents hex string.
    const gapHex = latin1.decode(bytes.subarray(br[1] + 1, br[2] - 1));
    if (!/^[0-9a-fA-F\s]*$/.test(gapHex)) {
      info.integrity = 'malformed';
      errors.push('The unsigned gap contains data other than the signature value.');
    }

    // ---- CMS ----
    try {
      const der = derSlice(contents);
      const ci = pkijs.ContentInfo.fromBER(der.slice());
      const sd = new pkijs.SignedData({ schema: ci.content });
      const si = sd.signerInfos[0];
      const certs = (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
      const sid = si.sid as pkijs.IssuerAndSerialNumber;
      const signerCert =
        certs.find((c) => sid?.serialNumber && c.serialNumber.isEqual(sid.serialNumber) && c.issuer.isEqual(sid.issuer)) ?? certs[0] ?? null;
      info.certificate = signerCert;
      info.chain = signerCert ? [signerCert, ...certs.filter((c) => c !== signerCert)] : certs;
      if (signerCert) info.signerName = signerDisplayName(signerCert);
      const hashName = HASH[si.digestAlgorithm.algorithmId];
      info.digestAlgorithm = hashName ?? si.digestAlgorithm.algorithmId;

      const attrs = si.signedAttrs?.attributes ?? [];
      const st = attrs.find((a) => a.type === OID.signingTime);
      if (st && !info.claimedTime) info.claimedTime = (st.values[0] as asn1js.UTCTime).toDate();
      if (attrs.some((a) => a.type === '1.2.840.113583.1.1.8')) info.revocationInfo.embeddedInCms = true;

      const tsAttr = si.unsignedAttrs?.attributes.find((a) => a.type === OID.timeStampToken);
      if (tsAttr) {
        try {
          const tsCi = new pkijs.ContentInfo({ schema: tsAttr.values[0] });
          const tsSd = new pkijs.SignedData({ schema: tsCi.content });
          const tst = new pkijs.TSTInfo({ schema: asn1js.fromBER(tsSd.encapContentInfo.eContent!.getValue()).result });
          info.timestampTime = tst.genTime;
        } catch {
          errors.push('The signature timestamp could not be read.');
        }
      }

      if (!hashName) throw new Error(`Unsupported digest algorithm ${si.digestAlgorithm.algorithmId}`);
      const digest = await digestRanges(hashName, bytes, br);

      if (isDocTs) {
        const tst = new pkijs.TSTInfo({ schema: asn1js.fromBER(sd.encapContentInfo.eContent!.getValue()).result });
        info.timestampTime = tst.genTime;
        const imprint = new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
        info.integrity = eq(imprint, digest) && info.integrity !== 'malformed' ? 'ok' : 'mismatch';
      } else if (subFilter === 'adbe.pkcs7.sha1' && sd.encapContentInfo.eContent) {
        const sha1 = await digestRanges('SHA-1', bytes, br);
        const inner = new Uint8Array(sd.encapContentInfo.eContent.getValue());
        info.integrity = eq(inner, sha1) ? 'ok' : 'mismatch';
      } else {
        const md = attrs.find((a) => a.type === OID.messageDigest);
        const mdVal = md ? new Uint8Array((md.values[0] as asn1js.OctetString).valueBlock.valueHexView) : null;
        if (info.integrity !== 'malformed') info.integrity = mdVal && eq(mdVal, digest) ? 'ok' : 'mismatch';
      }

      // Cryptographic check of the signature value itself.
      const data = new Uint8Array(br[1] + br[3]);
      data.set(bytes.subarray(0, br[1]), 0);
      data.set(bytes.subarray(br[2], br[2] + br[3]), br[1]);
      const vr = (await sd.verify({ signer: 0, data: isDocTs || subFilter === 'adbe.pkcs7.sha1' ? undefined : data.buffer, checkChain: false, extendedMode: true }).catch(
        (e: unknown) => e,
      )) as { signatureVerified?: boolean | null } | null;
      info.signatureValid = vr && typeof vr === 'object' && 'signatureVerified' in vr ? (vr.signatureVerified ?? false) : false;
    } catch (err) {
      errors.push(`The signature data could not be processed: ${err instanceof Error ? err.message : err}`);
    }

    if (isDocTs) {
      info.level = 'Document timestamp';
      docTsEnds.push(info.revisionEnd);
    } else if (subFilter === 'ETSI.CAdES.detached') info.level = info.timestampTime ? 'PAdES-B-T' : 'PAdES-B-B';
    else if (subFilter.startsWith('adbe.pkcs7')) info.level = 'PKCS#7';
    results.push(info);
  }

  // LT / LTA: DSS present, and a document timestamp after the DSS.
  for (const s of results) {
    if (s.kind !== 'signature' || !s.level.startsWith('PAdES-B')) continue;
    if (hasDss && (s.timestampTime || docTsEnds.some((e) => e > s.revisionEnd))) {
      s.level = docTsEnds.some((e) => e > s.revisionEnd) && docTsEnds.length ? 'PAdES-B-LTA' : 'PAdES-B-LT';
    }
  }
  if (hasDss) {
    const dss = doc.catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
    const count = (k: string) => dss?.lookupMaybe(PDFName.of(k), PDFArray)?.size() ?? 0;
    for (const s of results) s.revocationInfo = { ...s.revocationInfo, ocsps: count('OCSPs'), crls: count('CRLs') };
  }

  // ---- changes after each signature ----
  const docMdp = results.find((s) => s.certification)?.certification ?? null;
  for (const s of results) {
    if (s.integrity === 'malformed' || s.coversWholeFile || !s.revisionEnd) continue;
    try {
      s.changes = await classifyChanges(bytes.subarray(0, s.revisionEnd), doc);
      const p = docMdp;
      s.changesAllowed = s.changes.every((c) =>
        c === 'signing' ? p !== 1 : c === 'form' ? p !== 1 : c === 'annotation' ? p === null || p === 3 : false,
      );
    } catch {
      s.changes = ['other'];
      s.changesAllowed = false;
    }
  }
  return { signatures: results, docMdp, hasDss };
}

// ---------------- change classification ----------------

function fingerprint(o: PDFObject): string {
  if (o instanceof PDFStream) return `${o.dict.toString()}#${o.getContents().length}`;
  return o.toString();
}

/** Compares the signed revision with the final document and classifies every changed object. */
export async function classifyChanges(signedBytes: Uint8Array, finalDoc: PDFDocument): Promise<ChangeKind[]> {
  const old = await PDFDocument.load(signedBytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const kinds = new Set<ChangeKind>();
  const oldCtx = old.context;
  const newCtx = finalDoc.context;

  for (const [ref, obj] of newCtx.enumerateIndirectObjects()) {
    const before = oldCtx.lookup(ref);
    if (before && fingerprint(before) === fingerprint(obj)) continue;
    const k = classifyObject(obj, before ?? null, newCtx);
    if (k !== 'neutral') kinds.add(k);
  }
  const order: ChangeKind[] = ['signing', 'form', 'annotation', 'other'];
  return order.filter((k) => kinds.has(k));
}

function classifyObject(obj: PDFObject, before: PDFObject | null, ctx: PDFDocument['context']): ChangeKind | 'neutral' {
  const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
  if (!d) return 'neutral'; // arrays (Fields, Annots), numbers…
  const type = d.get(PDFName.of('Type'))?.toString();
  const subtype = d.get(PDFName.of('Subtype'))?.toString();
  const ft = d.get(PDFName.of('FT'))?.toString() ?? parentFT(d, ctx);
  if (type === '/Sig' || type === '/DocTimeStamp' || d.has(PDFName.of('ByteRange'))) return 'signing';
  if (d.has(PDFName.of('VRI')) || d.has(PDFName.of('OCSPs')) || d.has(PDFName.of('CRLs'))) return 'signing';
  if (subtype === '/Widget' || d.has(PDFName.of('FT')) || d.has(PDFName.of('Kids')) && d.has(PDFName.of('T'))) return ft === '/Sig' ? 'signing' : 'form';
  if (type === '/Annot' || (subtype && ['/Text', '/Highlight', '/Underline', '/StrikeOut', '/FreeText', '/Ink', '/Square', '/Circle', '/Line', '/Stamp', '/Popup', '/Squiggly', '/Polygon', '/PolyLine', '/Caret', '/FileAttachment'].includes(subtype)))
    return 'annotation';
  if (type === '/Page') {
    const b = before instanceof PDFDict ? before : null;
    if (!b) return 'other';
    const changedKeys = new Set<string>();
    for (const [k, v] of d.entries()) if (b.get(k)?.toString() !== v.toString()) changedKeys.add(k.toString());
    for (const [k] of b.entries()) if (!d.has(k)) changedKeys.add(k.toString());
    changedKeys.delete('/Annots');
    return changedKeys.size ? 'other' : 'neutral';
  }
  if (type === '/Catalog') {
    const b = before instanceof PDFDict ? before : null;
    if (!b) return 'other';
    for (const [k, v] of d.entries()) {
      const key = k.toString();
      if (['/AcroForm', '/DSS', '/Metadata', '/Perms'].includes(key)) continue;
      if (b.get(k)?.toString() !== v.toString()) return 'other';
    }
    return 'neutral';
  }
  if (d.has(PDFName.of('Fields')) || d.has(PDFName.of('SigFlags')) || d.has(PDFName.of('DR'))) return 'neutral'; // AcroForm dict
  if (type === '/XObject' || type === '/Font' || type === '/FontDescriptor' || type === '/ExtGState' || subtype === '/Form' || subtype === '/Image') return 'neutral';
  if (type === '/Pages') return 'other';
  if (d.has(PDFName.of('Producer')) || d.has(PDFName.of('ModDate')) || type === '/Metadata') return 'neutral';
  // Unknown new streams (e.g. content streams) are judged by whether a page's /Contents changed.
  return 'neutral';
}

function parentFT(d: PDFDict, ctx: PDFDocument['context']): string | undefined {
  let p = d.get(PDFName.of('Parent'));
  for (let i = 0; i < 10 && p; i++) {
    const pd = p instanceof PDFRef ? ctx.lookup(p) : p;
    if (!(pd instanceof PDFDict)) return undefined;
    const ft = pd.get(PDFName.of('FT'));
    if (ft) return ft.toString();
    p = pd.get(PDFName.of('Parent'));
  }
  return undefined;
}
