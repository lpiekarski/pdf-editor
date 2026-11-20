/**
 * CAdES detached SignedData for PAdES baseline B-B (ETSI EN 319 142-1):
 * signed attributes = content-type, message-digest, signing-certificate-v2.
 * No signing-time attribute (PAdES puts the claimed time in the signature dictionary /M).
 */
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { ensureCryptoEngine, OID, type Signer } from '../signer';

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** ESS signing-certificate-v2 (RFC 5035) with the default SHA-256 hash algorithm. */
async function signingCertificateV2(cert: pkijs.Certificate): Promise<asn1js.Sequence> {
  const der = new Uint8Array(cert.toSchema().toBER());
  const hash = await sha256(der);
  const issuerSerial = new asn1js.Sequence({
    value: [
      // GeneralNames: [4] directoryName (EXPLICIT, Name is a CHOICE)
      new asn1js.Sequence({
        value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })],
      }),
      cert.serialNumber,
    ],
  });
  const essCertIdV2 = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: hash.slice().buffer }), issuerSerial],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
}

/**
 * Builds the DER-encoded CMS ContentInfo(SignedData) over `digest`
 * (the SHA-256 of the PDF byte ranges).
 */
export async function buildCadesSignature(signer: Signer, digest: Uint8Array): Promise<Uint8Array> {
  ensureCryptoEngine();
  const [cert] = signer.chain;
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
      new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: digest.slice().buffer })] }),
      new pkijs.Attribute({ type: OID.signingCertificateV2, values: [await signingCertificateV2(cert)] }),
    ],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() }),
    signedAttrs,
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: signer.signatureOid, algorithmParams: new asn1js.Null() }),
  });

  // Signature is computed over the DER of the attributes encoded as SET OF (tag 0x31), not [0].
  const attrsDer = new Uint8Array(signedAttrs.toSchema().toBER());
  attrsDer[0] = 0x31;
  const sig = await signer.sign(attrsDer);
  signerInfo.signature = new asn1js.OctetString({ valueHex: sig.slice().buffer });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates: signer.chain,
    signerInfos: [signerInfo],
  });
  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER());
}
