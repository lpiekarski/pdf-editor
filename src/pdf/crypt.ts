/**
 * PDF Standard Security Handler (ISO 32000-2 §7.6): key derivation and per-object
 * encryption/decryption for RC4 (R2–R4), AES-128 (R4, AESV2) and AES-256 (R5/R6, AESV3).
 *
 * Used so encrypted PDFs can be edited and signed: everything we read is decrypted, and every
 * object we append is encrypted with the file's own key, so the file stays encrypted.
 */
import forge from 'node-forge';

// ---------- byte helpers ----------

const toBin = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const fromBin = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const md5 = (data: Uint8Array) => fromBin(forge.md.md5.create().update(toBin(data)).digest().getBytes());
const sha = (bits: 256 | 384 | 512, data: Uint8Array) => {
  const md = bits === 256 ? forge.md.sha256.create() : bits === 384 ? forge.md.sha384.create() : forge.md.sha512.create();
  return fromBin(md.update(toBin(data)).digest().getBytes());
};

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function aesCbc(mode: 'encrypt' | 'decrypt', key: Uint8Array, iv: Uint8Array, data: Uint8Array, padding: boolean): Uint8Array {
  const c = mode === 'encrypt' ? forge.cipher.createCipher('AES-CBC', toBin(key)) : forge.cipher.createDecipher('AES-CBC', toBin(key));
  c.start({ iv: toBin(iv) });
  c.update(forge.util.createBuffer(toBin(data)));
  // A pad function that returns true tells forge "no padding" (raw CBC blocks).
  const finish = c.finish as (pad?: () => boolean) => boolean;
  const ok = padding ? finish.call(c) : finish.call(c, () => true);
  if (!ok) throw new Error('AES padding error');
  return fromBin(c.output.getBytes());
}

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// ---------- key derivation ----------

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export type CryptMethod = 'none' | 'rc4' | 'aesv2' | 'aesv3';

export interface EncryptParams {
  V: number;
  R: number;
  length: number; // key length in bits
  O: Uint8Array;
  U: Uint8Array;
  OE?: Uint8Array;
  UE?: Uint8Array;
  P: number;
  encryptMetadata: boolean;
  /** Method for streams and strings (from /StmF, /StrF and /CF for V4/V5). */
  stmMethod: CryptMethod;
  strMethod: CryptMethod;
  id0: Uint8Array;
}

function padPassword(pw: string): Uint8Array {
  // R2–R4 passwords are PDFDocEncoding; Latin-1 covers the printable range users type.
  const bytes = Uint8Array.from([...pw].slice(0, 32).map((c) => c.charCodeAt(0) & 0xff));
  return concat(bytes, PAD.subarray(0, 32 - bytes.length));
}

/** Algorithm 2: file key from a (padded) user password. */
function keyR4(p: EncryptParams, paddedUser: Uint8Array): Uint8Array {
  const n = p.R === 2 ? 5 : p.length / 8;
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p.P, true);
  let h = md5(concat(paddedUser, p.O.subarray(0, 32), pBytes, p.id0, p.R >= 4 && !p.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array()));
  if (p.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  return h.subarray(0, n);
}

/** Algorithms 4/5: the /U value a key would produce; used to check a password. */
function checkUserKeyR4(p: EncryptParams, key: Uint8Array): boolean {
  if (p.R === 2) return eq(rc4(key, PAD), p.U.subarray(0, 32));
  let x = rc4(key, md5(concat(PAD, p.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return eq(x, p.U.subarray(0, 16));
}

/** Algorithm 7: recover the padded user password from the owner password. */
function userFromOwnerR4(p: EncryptParams, owner: string): Uint8Array {
  const n = p.R === 2 ? 5 : p.length / 8;
  let h = md5(padPassword(owner));
  if (p.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const k = h.subarray(0, n);
  if (p.R === 2) return rc4(k, p.O.subarray(0, 32));
  let x = p.O.subarray(0, 32);
  for (let i = 19; i >= 0; i--) x = rc4(k.map((b) => b ^ i), x);
  return x;
}

/** Algorithm 2.B (R6) / plain SHA-256 (R5). */
function hashR6(p: EncryptParams, password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha(256, concat(password, salt, udata));
  if (p.R === 5) return k;
  for (let round = 0; ; round++) {
    const k1 = concat(password, k, udata);
    const rep = new Uint8Array(k1.length * 64);
    for (let i = 0; i < 64; i++) rep.set(k1, i * k1.length);
    const e = aesCbc('encrypt', k.subarray(0, 16), k.subarray(16, 32), rep, false);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod += e[i];
    mod %= 3;
    k = sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
    if (round >= 63 && e[e.length - 1] <= round + 1 - 32) break;
  }
  return k.subarray(0, 32);
}

export class WrongPasswordError extends Error {
  constructor() {
    super('The password for this encrypted PDF is wrong.');
  }
}

/** Derives the file encryption key, trying `password` as user password, then as owner password. */
export function deriveFileKey(p: EncryptParams, password = ''): Uint8Array {
  if (p.R >= 5) {
    const pw = new TextEncoder().encode(password.normalize('NFKC')).subarray(0, 127);
    const zero = new Uint8Array(16);
    if (eq(hashR6(p, pw, p.U.subarray(32, 40), new Uint8Array()), p.U.subarray(0, 32))) {
      return aesCbc('decrypt', hashR6(p, pw, p.U.subarray(40, 48), new Uint8Array()), zero, p.UE!.subarray(0, 32), false);
    }
    const u48 = p.U.subarray(0, 48);
    if (eq(hashR6(p, pw, p.O.subarray(32, 40), u48), p.O.subarray(0, 32))) {
      return aesCbc('decrypt', hashR6(p, pw, p.O.subarray(40, 48), u48), zero, p.OE!.subarray(0, 32), false);
    }
    throw new WrongPasswordError();
  }
  const asUser = keyR4(p, padPassword(password));
  if (checkUserKeyR4(p, asUser)) return asUser;
  const asOwner = keyR4(p, userFromOwnerR4(p, password));
  if (checkUserKeyR4(p, asOwner)) return asOwner;
  throw new WrongPasswordError();
}

// ---------- per-object encryption (Algorithm 1 / 1.A) ----------

export class PdfCrypt {
  constructor(
    readonly params: EncryptParams,
    readonly fileKey: Uint8Array,
  ) {}

  private objectKey(method: CryptMethod, num: number, gen: number): Uint8Array {
    if (method === 'aesv3') return this.fileKey;
    const suffix = Uint8Array.of(num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff);
    const salt = method === 'aesv2' ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) : new Uint8Array(); // "sAlT"
    return md5(concat(this.fileKey, suffix, salt)).subarray(0, Math.min(this.fileKey.length + 5, 16));
  }

  private run(method: CryptMethod, dir: 'encrypt' | 'decrypt', data: Uint8Array, num: number, gen: number): Uint8Array {
    if (method === 'none') return data;
    const key = this.objectKey(method, num, gen);
    if (method === 'rc4') return rc4(key, data);
    if (dir === 'encrypt') {
      const iv = randomBytes(16);
      return concat(iv, aesCbc('encrypt', key, iv, data, true));
    }
    if (data.length < 16) return new Uint8Array(); // an empty string encrypts to IV only
    const body = data.subarray(16);
    if (body.length === 0 || body.length % 16) return new Uint8Array();
    const plain = aesCbc('decrypt', key, data.subarray(0, 16), body, false);
    const pad = plain[plain.length - 1];
    return pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
  }

  decryptString(data: Uint8Array, num: number, gen: number) {
    return this.run(this.params.strMethod, 'decrypt', data, num, gen);
  }
  encryptString(data: Uint8Array, num: number, gen: number) {
    return this.run(this.params.strMethod, 'encrypt', data, num, gen);
  }
  decryptStream(data: Uint8Array, num: number, gen: number) {
    return this.run(this.params.stmMethod, 'decrypt', data, num, gen);
  }
  encryptStream(data: Uint8Array, num: number, gen: number) {
    return this.run(this.params.stmMethod, 'encrypt', data, num, gen);
  }

  /** Permission flags from /P (bits as in ISO 32000 Table 22). */
  get permissions() {
    const P = this.params.P;
    return {
      print: !!(P & (1 << 2)),
      modify: !!(P & (1 << 3)),
      annotate: !!(P & (1 << 5)),
      fillForms: !!(P & (1 << 8)) || !!(P & (1 << 5)),
    };
  }
}
