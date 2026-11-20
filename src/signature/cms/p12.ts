/**
 * PKCS#12 (.p12 / .pfx) loading. node-forge handles both modern (AES/PBKDF2) and legacy
 * (3DES/RC2, as exported by Windows) encryptions, which WebCrypto alone cannot.
 * The private key is imported into WebCrypto as non-extractable and never stored.
 */
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import { ensureCryptoEngine, OID, type Signer } from '../signer';

export class P12Error extends Error {
  constructor(message: string, readonly code: 'password' | 'format' | 'no-key' | 'unsupported-key') {
    super(message);
  }
}

const toBinary = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export interface LoadedP12 {
  signer: Signer;
  certificate: pkijs.Certificate;
  chain: pkijs.Certificate[];
}

export async function loadP12(bytes: Uint8Array, password: string): Promise<LoadedP12> {
  ensureCryptoEngine();
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(toBinary(bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/mac|password|invalid/i.test(msg)) throw new P12Error('Wrong password for this certificate file.', 'password');
    if (/OID is not RSA|unsupported/i.test(msg)) throw new P12Error('Only RSA certificates are supported in this version.', 'unsupported-key');
    throw new P12Error(`Not a valid .p12/.pfx file (${msg}).`, 'format');
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const keyBag = keyBags.find((b) => b.key);
  if (!keyBag?.key) {
    const anyKey = keyBags.length > 0;
    throw new P12Error(
      anyKey ? 'The private key in this file uses an unsupported algorithm (only RSA is supported).' : 'This file contains no private key.',
      anyKey ? 'unsupported-key' : 'no-key',
    );
  }
  const key = keyBag.key as forge.pki.rsa.PrivateKey;

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certs = certBags.filter((b) => b.cert).map((b) => b.cert!);
  if (!certs.length) throw new P12Error('This file contains no certificate.', 'format');

  // The signing certificate is the one whose public key matches the private key.
  const leaf = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub.n && pub.n.equals(key.n) && pub.e.equals(key.e);
  });
  if (!leaf) throw new P12Error('No certificate in this file matches its private key.', 'format');

  const toPkijs = (c: forge.pki.Certificate) => pkijs.Certificate.fromBER(fromBinary(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes()));
  const certificate = toPkijs(leaf);
  const chain = orderChain(certificate, certs.filter((c) => c !== leaf).map(toPkijs));

  const pkcs8 = fromBinary(forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes());
  const cryptoKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  pkcs8.fill(0);

  const signer: Signer = {
    chain: [certificate, ...chain],
    digest: 'SHA-256',
    signatureOid: OID.sha256WithRSA,
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data as BufferSource));
    },
  };
  return { signer, certificate, chain };
}

/** Orders intermediates leaf → root by issuer/subject matching; unrelated certs are appended. */
export function orderChain(leaf: pkijs.Certificate, others: pkijs.Certificate[]): pkijs.Certificate[] {
  const out: pkijs.Certificate[] = [];
  const pool = [...others];
  let cur = leaf;
  for (;;) {
    const issuerDer = toHex(cur.issuer.toSchema().toBER());
    const i = pool.findIndex((c) => toHex(c.subject.toSchema().toBER()) === issuerDer);
    if (i < 0) break;
    cur = pool.splice(i, 1)[0];
    out.push(cur);
    if (toHex(cur.issuer.toSchema().toBER()) === toHex(cur.subject.toSchema().toBER())) break; // root
  }
  return [...out, ...pool];
}

export const toHex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('');
