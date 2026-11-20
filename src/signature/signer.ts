/**
 * A Signer owns a private key and its certificate chain. The PDF/CMS code only talks to this
 * interface, so where the key lives (a .p12 file today) is independent of the signing pipeline.
 */
import * as pkijs from 'pkijs';

export interface Signer {
  /** Signing certificate first, then the rest of the chain (if known). */
  readonly chain: pkijs.Certificate[];
  readonly digest: 'SHA-256';
  /** pkijs/WebCrypto signature algorithm identifier for the SignerInfo. */
  readonly signatureOid: string;
  /** Signs `data` (the DER of the signed attributes) and returns the raw signature value. */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export function ensureCryptoEngine() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto is not available (a secure context, HTTPS or localhost, is required).');
  pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ name: 'webcrypto', crypto: c }));
}

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha1: '1.3.14.3.2.26',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  country: '2.5.4.6',
  email: '1.2.840.113549.1.9.1',
  serialNumberAttr: '2.5.4.5',
} as const;

/** Human-readable value of a name attribute (e.g. CN) from a pkijs RelativeDistinguishedNames. */
export function nameAttr(rdn: pkijs.RelativeDistinguishedNames, oid: string): string | undefined {
  const tv = rdn.typesAndValues.find((t) => t.type === oid);
  return tv ? String(tv.value.valueBlock.value) : undefined;
}

export function describeName(rdn: pkijs.RelativeDistinguishedNames): string {
  const labels: Record<string, string> = {
    [OID.commonName]: 'CN',
    [OID.organization]: 'O',
    [OID.country]: 'C',
    [OID.email]: 'E',
    '2.5.4.11': 'OU',
    '2.5.4.7': 'L',
    '2.5.4.8': 'ST',
    [OID.serialNumberAttr]: 'SERIALNUMBER',
  };
  return rdn.typesAndValues.map((t) => `${labels[t.type] ?? t.type}=${t.value.valueBlock.value}`).join(', ');
}

export function signerDisplayName(cert: pkijs.Certificate): string {
  return nameAttr(cert.subject, OID.commonName) ?? nameAttr(cert.subject, OID.organization) ?? describeName(cert.subject);
}
