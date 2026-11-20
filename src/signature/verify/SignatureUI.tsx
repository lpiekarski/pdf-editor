import { useState } from 'react';
import type * as pkijs from 'pkijs';
import { useDoc } from '../../model/docStore';
import { useView } from '../../model/viewStore';
import { pdfRectToView } from '../../viewer/coords';
import type { PageInfo } from '../../viewer/pdfjs';
import { describeName, signerDisplayName } from '../signer';
import type { SignatureInfo, ChangeKind } from './analyze';
import { statusOf, useSignatures, type Status } from './useSignatures';
import { saveBytes } from '../../export/save';

const ICON: Record<Status, string> = { valid: '✔', warning: '!', invalid: '✖', unknown: '?' };
const LABEL: Record<Status, string> = { valid: 'Valid', warning: 'Valid, but changed later', invalid: 'Invalid', unknown: 'Not verifiable' };
const CHANGE: Record<ChangeKind, string> = {
  signing: 'Signatures were added',
  form: 'Form fields were filled in',
  annotation: 'Comments/annotations were added',
  other: 'Page content was changed',
};

const fmt = (d: Date | null) => (d ? d.toLocaleString() : '—');

export function Badge({ status }: { status: Status }) {
  return (
    <span className={`sig-badge ${status}`} aria-label={LABEL[status]} title={LABEL[status]}>
      {ICON[status]}
    </span>
  );
}

/** Summary shown above the document whenever it contains signatures. */
export function SignatureBanner() {
  const { signatures, loading, docMdp } = useSignatures();
  const viewing = useDoc((s) => s.revisionOf);
  if (viewing) {
    return (
      <div className="sig-banner info" role="status">
        <span>
          Viewing the version covered by <b>{viewing.label}</b> (read-only snapshot).
        </span>
        <button className="link-btn" onClick={() => useDoc.getState().backToCurrent()}>
          Back to current version
        </button>
      </div>
    );
  }
  if (loading) return null;
  const sigs = signatures?.filter((s) => s.kind === 'signature') ?? [];
  if (!signatures?.length) return null;
  const statuses = signatures.map(statusOf);
  const worst: Status = statuses.includes('invalid') ? 'invalid' : statuses.includes('warning') ? 'warning' : statuses.includes('unknown') ? 'unknown' : 'valid';
  const names = [...new Set(sigs.map((s) => s.signerName ?? 'unknown signer'))];
  const text =
    worst === 'valid'
      ? `Signed by ${names.join(', ')} · ${sigs.length} signature${sigs.length === 1 ? '' : 's'} · all valid`
      : worst === 'invalid'
        ? `${statuses.filter((s) => s === 'invalid').length} of ${signatures.length} signature(s) are INVALID — the document was altered or the signature is broken`
        : worst === 'warning'
          ? `Signed by ${names.join(', ')} · the document was changed after signing in ways the signature does not allow`
          : `Signed by ${names.join(', ')} · some signatures could not be verified`;
  return (
    <div className={`sig-banner ${worst}`} role="status" data-testid="sig-banner">
      <Badge status={worst} />
      <span>
        {text}
        {docMdp ? ` · certified (${docMdp === 1 ? 'no changes allowed' : docMdp === 2 ? 'form filling allowed' : 'form filling and comments allowed'})` : ''}
      </span>
      <button className="link-btn" onClick={() => useView.setState({ sheet: 'signatures' })}>
        Details
      </button>
    </div>
  );
}

/** Status badges drawn on visible signature fields. */
export function SignatureBadgeLayer({ info, zoom }: { info: PageInfo; zoom: number }) {
  const signatures = useSignatures((s) => s.signatures);
  const [open, setOpen] = useState<number | null>(null);
  const here = signatures?.filter((s) => s.page === info.index && s.rect) ?? [];
  if (!here.length) return null;
  return (
    <div className="sig-badge-layer">
      {here.map((s) => {
        const [x0, y0, x1, y1] = s.rect!;
        const r = pdfRectToView(info, zoom, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
        const st = statusOf(s);
        return (
          <div key={s.index} className={`sig-zone ${st}`} style={{ left: r.x, top: r.y, width: r.width, height: r.height }}>
            <button className="sig-zone-btn" onClick={() => setOpen(open === s.index ? null : s.index)} aria-label={`Signature by ${s.signerName}: ${LABEL[st]}`}>
              <Badge status={st} />
            </button>
            {open === s.index && (
              <div className="sig-popover" onPointerDown={(e) => e.stopPropagation()}>
                <SignatureCard s={s} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CertChain({ chain }: { chain: pkijs.Certificate[] }) {
  return (
    <ol className="cert-chain">
      {chain.map((c, i) => (
        <li key={i}>
          <b>{signerDisplayName(c)}</b>
          <span className="muted small">Subject: {describeName(c.subject)}</span>
          <span className="muted small">Issuer: {describeName(c.issuer)}</span>
          <span className="muted small">
            Valid {c.notBefore.value.toLocaleDateString()} – {c.notAfter.value.toLocaleDateString()}
          </span>
          <button
            className="link-btn small"
            onClick={() => saveBytes(new Uint8Array(c.toSchema().toBER()), `${signerDisplayName(c).replace(/[^\w.-]+/g, '_')}.cer`)}
          >
            Export certificate
          </button>
        </li>
      ))}
    </ol>
  );
}

export function SignatureCard({ s, compact = false }: { s: SignatureInfo; compact?: boolean }) {
  const st = statusOf(s);
  const [showChain, setShowChain] = useState(false);
  const file = useDoc((d) => d.file);
  const certExpiredAtSigning = s.certificate && s.claimedTime && (s.certificate.notAfter.value < s.claimedTime || s.certificate.notBefore.value > s.claimedTime);
  return (
    <div className={`sig-card ${st}`} data-testid="sig-card">
      <div className="sig-card-head">
        <Badge status={st} />
        <div>
          <b>{s.kind === 'timestamp' ? 'Document timestamp' : s.signerName ?? 'Unknown signer'}</b>
          <div className={`sig-status ${st}`}>{LABEL[st]}</div>
        </div>
      </div>
      <dl>
        <dt>Signed</dt>
        <dd>{fmt(s.claimedTime)} <span className="muted small">(signer's clock)</span></dd>
        {s.timestampTime && (
          <>
            <dt>Timestamp</dt>
            <dd>{fmt(s.timestampTime)}</dd>
          </>
        )}
        {s.reason && (<><dt>Reason</dt><dd>{s.reason}</dd></>)}
        {s.location && (<><dt>Location</dt><dd>{s.location}</dd></>)}
        {!compact && s.contactInfo && (<><dt>Contact</dt><dd>{s.contactInfo}</dd></>)}
        <dt>Type</dt>
        <dd>
          {s.certification ? `Certification (${s.certification === 1 ? 'no changes' : s.certification === 2 ? 'form filling' : 'form filling + comments'})` : s.kind === 'timestamp' ? 'Timestamp' : 'Approval'}
          {' · '}
          {s.level}
          {!compact && <span className="muted small"> ({s.subFilter}{s.digestAlgorithm ? `, ${s.digestAlgorithm}` : ''})</span>}
        </dd>
        <dt>Integrity</dt>
        <dd>
          {s.integrity === 'ok' ? 'The signed content is unchanged.' : s.integrity === 'mismatch' ? 'The signed content was altered.' : s.integrity === 'malformed' ? 'Malformed signature.' : 'Not checked.'}
        </dd>
        <dt>Signature</dt>
        <dd>{s.signatureValid ? 'Cryptographically valid.' : s.signatureValid === false ? 'Does not verify with the signer certificate.' : 'Not checked.'}</dd>
        <dt>Later changes</dt>
        <dd>
          {s.coversWholeFile ? (
            'None — the signature covers the whole document.'
          ) : (
            <>
              {s.changes.length ? s.changes.map((c) => CHANGE[c]).join('; ') : 'Only technical updates'}.{' '}
              {s.changesAllowed ? <span className="ok-text">Allowed.</span> : <span className="error-text">Not covered by this signature.</span>}
            </>
          )}
        </dd>
        {!compact && (s.revocationInfo.ocsps > 0 || s.revocationInfo.crls > 0 || s.revocationInfo.embeddedInCms) && (
          <>
            <dt>Revocation data</dt>
            <dd>
              {s.revocationInfo.ocsps} OCSP, {s.revocationInfo.crls} CRL{s.revocationInfo.embeddedInCms ? ', embedded in signature' : ''}
            </dd>
          </>
        )}
        <dt>Trust</dt>
        <dd className="muted">Not checked — verify who issued the certificate yourself.</dd>
      </dl>
      {certExpiredAtSigning && <p className="error small">The certificate was not valid at the claimed signing time.</p>}
      {s.errors.map((e) => (
        <p key={e} className="error small">{e}</p>
      ))}
      {!compact && (
        <div className="sig-card-actions">
          {s.chain.length > 0 && (
            <button className="link-btn" onClick={() => setShowChain((v) => !v)} aria-expanded={showChain}>
              {showChain ? 'Hide' : 'Show'} certificates ({s.chain.length})
            </button>
          )}
          {!s.coversWholeFile && s.revisionEnd > 0 && file && (
            <button
              className="link-btn"
              onClick={() => useDoc.getState().openRevision(file.bytes.slice(0, s.revisionEnd), s.signerName ?? `signature ${s.index + 1}`)}
            >
              View signed version
            </button>
          )}
          {s.page !== null && (
            <button className="link-btn" onClick={() => useView.getState().goToPage(s.page!)}>
              Go to page {s.page + 1}
            </button>
          )}
        </div>
      )}
      {showChain && <CertChain chain={s.chain} />}
    </div>
  );
}

export function SignaturePanel() {
  const { signatures, loading } = useSignatures();
  if (loading) return <p className="muted pad">Checking signatures…</p>;
  if (!signatures?.length) return <p className="muted pad">This document has no digital signatures.</p>;
  return (
    <div className="sig-panel">
      {signatures.map((s) => (
        <SignatureCard key={s.index} s={s} />
      ))}
    </div>
  );
}
