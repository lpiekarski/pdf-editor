/**
 * Loads a PDF into pdf-lib, decrypting it on the fly when it is encrypted.
 *
 * pdf-lib cannot decrypt, so three small hooks on its parser are active while one of our loads
 * runs: we note which object is being parsed, decrypt object streams before pdf-lib unpacks them,
 * and decrypt every other object (its strings and stream data) as it is stored in the context.
 * The resulting document is entirely plaintext in memory; `PdfCrypt` re-encrypts on save.
 */
import {
  PDFArray, PDFContext, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectParser,
  PDFObjectStreamParser, PDFParser, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject,
} from 'pdf-lib';
import { deriveFileKey, PdfCrypt, type CryptMethod, type EncryptParams } from './crypt';

const latin1 = new TextDecoder('latin1');

// ---------- reading the encryption dictionary ----------

function lastTrailer(bytes: Uint8Array, ctx: PDFContext): PDFDict | null {
  const tail = latin1.decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const m = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) return null;
  const offset = Number(m[1]);
  const head = latin1.decode(bytes.subarray(offset, offset + 32));
  let dictStart: number;
  if (head.startsWith('xref')) {
    const t = latin1.decode(bytes.subarray(offset)).indexOf('trailer');
    if (t < 0) return null;
    dictStart = offset + t + 'trailer'.length;
  } else {
    const h = /^\s*\d+\s+\d+\s+obj/.exec(head);
    if (!h) return null;
    dictStart = offset + h[0].length;
  }
  const o = PDFObjectParser.forBytes(bytes.subarray(dictStart), ctx).parseObject();
  return o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null;
}

/** Finds the last definition of an indirect object by scanning the bytes (encrypt dicts are never compressed). */
function findObject(bytes: Uint8Array, ref: PDFRef, ctx: PDFContext): PDFObject | null {
  const text = latin1.decode(bytes);
  const re = new RegExp(`(?:^|[^0-9])${ref.objectNumber}\\s+${ref.generationNumber}\\s+obj`, 'g');
  const all = [...text.matchAll(re)];
  const hit = all.pop();
  if (!hit) return null;
  const start = hit.index! + hit[0].length;
  return PDFObjectParser.forBytes(bytes.subarray(start), ctx).parseObject();
}

const bytesOf = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : new Uint8Array());

export function readEncryptParams(bytes: Uint8Array): EncryptParams | null {
  const ctx = PDFContext.create();
  const trailer = lastTrailer(bytes, ctx);
  const encRaw = trailer?.get(PDFName.of('Encrypt'));
  if (!trailer || !encRaw) return null;
  const enc = encRaw instanceof PDFRef ? findObject(bytes, encRaw, ctx) : encRaw;
  if (!(enc instanceof PDFDict)) throw new Error('Unreadable encryption dictionary');
  const filter = enc.get(PDFName.of('Filter'))?.toString();
  if (filter !== '/Standard') throw new Error(`Unsupported PDF security handler ${filter} (only password-based encryption is supported).`);
  const num = (k: string, d = 0) => (enc.get(PDFName.of(k)) instanceof PDFNumber ? (enc.get(PDFName.of(k)) as PDFNumber).asNumber() : d);
  const V = num('V');
  const R = num('R');
  const idArr = trailer.get(PDFName.of('ID'));
  const id0 = idArr instanceof PDFArray ? bytesOf(idArr.get(0)) : new Uint8Array();

  const methodOf = (filterName: string | undefined): CryptMethod => {
    if (V < 4) return 'rc4';
    if (!filterName || filterName === '/Identity') return 'none';
    const cf = enc.lookupMaybe(PDFName.of('CF'), PDFDict)?.lookupMaybe(PDFName.of(filterName.slice(1)), PDFDict);
    const cfm = cf?.get(PDFName.of('CFM'))?.toString();
    return cfm === '/AESV2' ? 'aesv2' : cfm === '/AESV3' ? 'aesv3' : cfm === '/V2' ? 'rc4' : 'none';
  };
  return {
    V,
    R,
    length: V === 1 ? 40 : V >= 5 ? 256 : num('Length', 40),
    O: bytesOf(enc.get(PDFName.of('O'))),
    U: bytesOf(enc.get(PDFName.of('U'))),
    OE: bytesOf(enc.get(PDFName.of('OE'))),
    UE: bytesOf(enc.get(PDFName.of('UE'))),
    P: num('P') | 0,
    encryptMetadata: enc.get(PDFName.of('EncryptMetadata'))?.toString() !== 'false',
    stmMethod: methodOf(enc.get(PDFName.of('StmF'))?.toString()),
    strMethod: methodOf(enc.get(PDFName.of('StrF'))?.toString()),
    id0,
  };
}

// ---------- object transforms ----------

/** Signature values (/Contents next to /ByteRange) are never encrypted (ISO 32000 §7.6.1). */
const isSigDict = (d: PDFDict) => d.has(PDFName.of('ByteRange'));
const isEncryptDict = (d: PDFDict) => d.get(PDFName.of('Filter'))?.toString() === '/Standard' && d.has(PDFName.of('O')) && d.has(PDFName.of('U'));

/**
 * Returns `obj` with every string (and stream data) passed through `fn`. Dicts and arrays are
 * rebuilt, never mutated, so the in-memory (plaintext) document is left untouched on save.
 */
export function mapStrings(
  obj: PDFObject,
  ctx: PDFContext,
  str: (b: Uint8Array) => Uint8Array,
  stream: ((b: Uint8Array, s: PDFStream) => Uint8Array) | null,
): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(toHex(str(obj.asBytes())));
  if (obj instanceof PDFArray) return ctx.obj(obj.asArray().map((x) => mapStrings(x, ctx, str, stream)));
  if (obj instanceof PDFDict) {
    const out = PDFDict.withContext(ctx);
    const sig = isSigDict(obj);
    for (const [k, v] of obj.entries()) out.set(k, sig && k.toString() === '/Contents' ? v : mapStrings(v, ctx, str, stream));
    return out;
  }
  if (obj instanceof PDFStream) {
    const dict = mapStrings(obj.dict, ctx, str, stream) as PDFDict;
    const data = stream ? stream(obj.getContents(), obj) : obj.getContents();
    dict.set(PDFName.of('Length'), PDFNumber.of(data.length));
    return PDFRawStream.of(dict, data);
  }
  return obj;
}

const toHex = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};

/** Streams that are stored unencrypted even in encrypted files. */
export function streamIsExempt(s: PDFStream, crypt: PdfCrypt): boolean {
  const type = s.dict.get(PDFName.of('Type'))?.toString();
  if (type === '/XRef') return true;
  if (type === '/Metadata' && !crypt.params.encryptMetadata) return true;
  const f = s.dict.get(PDFName.of('Filter'));
  return !!f && f.toString().includes('/Crypt'); // explicit crypt filter (Identity): leave alone
}

/**
 * In-place variant for loading: pdf-lib parses some dictionaries into subclasses (catalog, page
 * tree, pages) that must be kept, so strings and stream data are replaced inside the objects.
 */
function decryptInPlace(obj: PDFObject, str: (b: Uint8Array) => Uint8Array, stream: (b: Uint8Array, s: PDFRawStream) => Uint8Array): PDFObject {
  const fix = (v: PDFObject): PDFObject => {
    if (v instanceof PDFString || v instanceof PDFHexString) return PDFHexString.of(toHex(str(v.asBytes())));
    if (v instanceof PDFArray) {
      for (let i = 0; i < v.size(); i++) v.set(i, fix(v.get(i)));
      return v;
    }
    if (v instanceof PDFDict) {
      const sig = isSigDict(v);
      for (const [k, x] of v.entries()) if (!(sig && k.toString() === '/Contents')) v.set(k, fix(x));
      return v;
    }
    if (v instanceof PDFRawStream) {
      fix(v.dict);
      (v as unknown as { contents: Uint8Array }).contents = stream(v.contents, v);
      return v;
    }
    return v;
  };
  return fix(obj);
}

// ---------- parser hooks ----------

let active: PdfCrypt | null = null;
let currentRef: PDFRef | null = null;
let inObjectStream = 0;
let hooked = false;

function installHooks() {
  if (hooked) return;
  hooked = true;
  const parserProto = PDFParser.prototype as unknown as { parseIndirectObjectHeader(): PDFRef };
  const origHeader = parserProto.parseIndirectObjectHeader;
  parserProto.parseIndirectObjectHeader = function (this: unknown) {
    const ref = origHeader.call(this);
    currentRef = ref;
    return ref;
  };

  const osp = PDFObjectStreamParser as unknown as { forStream(s: PDFRawStream, wait?: () => boolean): { parseIntoContext(): Promise<void> } };
  const origForStream = osp.forStream;
  osp.forStream = function (s: PDFRawStream, wait?: () => boolean) {
    if (active && currentRef) {
      (s as unknown as { contents: Uint8Array }).contents = active.decryptStream(s.contents, currentRef.objectNumber, currentRef.generationNumber);
    }
    const parser = origForStream.call(this, s, wait);
    if (!active) return parser;
    const run = parser.parseIntoContext.bind(parser);
    parser.parseIntoContext = async () => {
      inObjectStream++; // objects inside an object stream are not encrypted individually
      try {
        await run();
      } finally {
        inObjectStream--;
      }
    };
    return parser;
  };

  const ctxProto = PDFContext.prototype as unknown as { assign(ref: PDFRef, obj: PDFObject): void };
  const origAssign = ctxProto.assign;
  ctxProto.assign = function (this: PDFContext, ref: PDFRef, obj: PDFObject) {
    const crypt = active;
    if (crypt && !inObjectStream && !(obj instanceof PDFDict && isEncryptDict(obj))) {
      const n = ref.objectNumber;
      const g = ref.generationNumber;
      obj = decryptInPlace(
        obj,
        (b) => crypt.decryptString(b, n, g),
        (b, s) => (streamIsExempt(s, crypt) ? b : crypt.decryptStream(b, n, g)),
      );
    }
    return origAssign.call(this, ref, obj);
  };
}

let queue: Promise<unknown> = Promise.resolve();

export interface LoadedPdf {
  doc: PDFDocument;
  crypt: PdfCrypt | null;
}

/**
 * Loads `bytes` with pdf-lib. Encrypted files are decrypted with `password` (user or owner
 * password; empty for files that only restrict permissions).
 */
export function loadPdf(bytes: Uint8Array, password = ''): Promise<LoadedPdf> {
  const job = queue.then(async () => {
    const params = readEncryptParams(bytes);
    if (!params) {
      return { doc: await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }), crypt: null };
    }
    const crypt = new PdfCrypt(params, deriveFileKey(params, password));
    installHooks();
    active = crypt;
    try {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
      return { doc, crypt };
    } finally {
      active = null;
      currentRef = null;
    }
  });
  queue = job.catch(() => undefined); // one encrypted load at a time (the hooks are global)
  return job;
}
