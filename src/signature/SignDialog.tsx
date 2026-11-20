import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/common';
import { useDoc } from '../model/docStore';
import { useEditor } from '../model/editorStore';
import { useView } from '../model/viewStore';
import type { ImageObject } from '../model/types';
import { loadP12, P12Error, type LoadedP12 } from './cms/p12';
import { describeName, signerDisplayName } from './signer';
import { signPdf, type DocMdpLevel, type SignField } from './pdf/sign';
import { exportPdf } from '../export/pipeline';
import { saveBytes, suggestedName } from '../export/save';
import { useUi } from '../editor/uiStore';
import { viewSize } from '../viewer/coords';
import { widgetsFor } from '../forms/FormLayer';
import type { Widget } from '../forms/acroform';
import { useSignatures } from './verify/useSignatures';

type Placement = { kind: 'image'; id: string } | { kind: 'field'; name: string } | { kind: 'box' } | { kind: 'invisible' };

function certWarnings(c: LoadedP12['certificate']): string[] {
  const out: string[] = [];
  const now = new Date();
  if (c.notAfter.value < now) out.push(`This certificate expired on ${c.notAfter.value.toLocaleDateString()}.`);
  if (c.notBefore.value > now) out.push(`This certificate is not valid until ${c.notBefore.value.toLocaleDateString()}.`);
  return out;
}

export function SignDialog({ onClose }: { onClose(): void }) {
  const { file, pages, pdf } = useDoc();
  const sigState = useSignatures();
  const objects = useEditor((s) => s.objects);
  const selection = useEditor((s) => s.selection);
  const sigImages = useMemo(
    () => Object.values(objects).filter((o): o is ImageObject => o.kind === 'image' && !!o.signature),
    [objects],
  );
  const [emptyFields, setEmptyFields] = useState<Widget[]>([]);
  const [p12File, setP12File] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState<LoadedP12 | null>(null);
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [contact, setContact] = useState('');
  const [certify, setCertify] = useState<0 | DocMdpLevel>(0);
  const [showText, setShowText] = useState(true);
  const [placement, setPlacement] = useState<Placement>({ kind: 'box' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadySigned = (sigState.signatures?.length ?? 0) > 0;

  useEffect(() => {
    if (!pdf) return;
    Promise.all(pages.map((p) => widgetsFor(pdf, p.index))).then((all) => {
      const empty = all.flat().filter((w) => w.kind === 'signature' && !w.signed);
      setEmptyFields(empty);
      const sel = sigImages.find((i) => selection.includes(i.id)) ?? sigImages[sigImages.length - 1];
      if (empty.length) setPlacement({ kind: 'field', name: empty[0].name });
      else if (sel) setPlacement({ kind: 'image', id: sel.id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pages]);

  const unlock = async () => {
    if (!p12File) return;
    setError(null);
    setBusy(true);
    try {
      setLoaded(await loadP12(new Uint8Array(await p12File.arrayBuffer()), password));
    } catch (e) {
      setError(e instanceof P12Error ? e.message : `Could not read the certificate: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!file || !loaded) return;
    setBusy(true);
    setError(null);
    try {
      const st = useEditor.getState();
      const usedImage = placement.kind === 'image' ? (st.objects[placement.id] as ImageObject | undefined) : undefined;
      // 1. Apply the pending edits (the graphic used as signature appearance goes into the field instead).
      const edited = await exportPdf({
        bytes: file.bytes,
        pages,
        objects: st.order.map((id) => st.objects[id]).filter((o) => o && o.id !== usedImage?.id),
        images: st.images,
        formValues: st.formValues,
      });
      // 2. Sign.
      let field: SignField;
      if (placement.kind === 'field') {
        field = { kind: 'existing', name: placement.name, appearance: { showText: true } };
      } else if (placement.kind === 'invisible') {
        field = { kind: 'new', page: useView.getState().currentPage, geometry: pages[0], rect: null };
      } else if (usedImage) {
        const img = st.images[usedImage.imageId];
        field = {
          kind: 'new',
          page: usedImage.page,
          geometry: pages[usedImage.page],
          rect: usedImage.rect,
          appearance: { image: { bytes: img.bytes, width: img.width, height: img.height }, showText },
        };
      } else {
        const page = useView.getState().currentPage;
        const size = viewSize(pages[page], 1);
        field = {
          kind: 'new',
          page,
          geometry: pages[page],
          rect: { x: size.width - 36 - 200, y: size.height - 36 - 56, width: 200, height: 56 },
          appearance: { showText: true },
        };
      }
      const signed = await signPdf(edited, {
        signer: loaded.signer,
        field,
        reason: reason || undefined,
        location: location || undefined,
        contactInfo: contact || undefined,
        certify: certify || undefined,
      });
      // 3. Offer the signed file for saving and reopen it so the signature panel shows it.
      const name = suggestedName(file.name, '-signed');
      await saveBytes(signed, name);
      await useDoc.getState().open(name, signed);
      useUi.getState().showToast('Signed. Check the signature panel for details.');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Sign digitally" onClose={busy ? undefined : onClose}>
      {!loaded ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <p className="muted">Use your certificate file (.p12 or .pfx). It stays on this device and is only kept in memory while signing.</p>
          <label className="field">
            <span>Certificate file</span>
            <input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => setP12File(e.target.files?.[0] ?? null)} data-testid="p12-input" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" data-testid="p12-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={!p12File || busy} data-testid="p12-unlock">
              {busy ? 'Opening…' : 'Continue'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="cert-card">
            <b>{signerDisplayName(loaded.certificate)}</b>
            <span className="muted">Issued by {describeName(loaded.certificate.issuer)}</span>
            <span className="muted">
              Valid {loaded.certificate.notBefore.value.toLocaleDateString()} – {loaded.certificate.notAfter.value.toLocaleDateString()}
            </span>
            {certWarnings(loaded.certificate).map((w) => (
              <span key={w} className="error">{w}</span>
            ))}
          </div>

          <fieldset className="placement">
            <legend>Where should the signature appear?</legend>
            {emptyFields.map((w) => (
              <label key={w.id} className="check">
                <input type="radio" checked={placement.kind === 'field' && placement.name === w.name} onChange={() => setPlacement({ kind: 'field', name: w.name })} />
                <span>In the signature field “{w.name}” (page {w.page + 1})</span>
              </label>
            ))}
            {sigImages.map((img) => (
              <label key={img.id} className="check">
                <input type="radio" checked={placement.kind === 'image' && placement.id === img.id} onChange={() => setPlacement({ kind: 'image', id: img.id })} />
                <span>On my handwritten signature (page {img.page + 1})</span>
              </label>
            ))}
            <label className="check">
              <input type="radio" checked={placement.kind === 'box'} onChange={() => setPlacement({ kind: 'box' })} />
              <span>Text box at the bottom of page {useView.getState().currentPage + 1}</span>
            </label>
            <label className="check">
              <input type="radio" checked={placement.kind === 'invisible'} onChange={() => setPlacement({ kind: 'invisible' })} />
              <span>Invisible (shown only in the signature panel)</span>
            </label>
            {placement.kind === 'image' && (
              <label className="check">
                <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
                <span>Add name and date next to the handwritten signature</span>
              </label>
            )}
            {!sigImages.length && <p className="muted small">Tip: place a handwritten signature with the Signature tool first to choose exactly where the signature goes.</p>}
          </fieldset>

          <label className="field">
            <span>Reason (optional)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I approve this document" />
          </label>
          <div className="two-col">
            <label className="field">
              <span>Location (optional)</span>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="field">
              <span>Contact (optional)</span>
              <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
          </div>
          {!alreadySigned && (
            <label className="field">
              <span>Signature type</span>
              <select value={certify} onChange={(e) => setCertify(Number(e.target.value) as 0 | DocMdpLevel)}>
                <option value={0}>Approval signature</option>
                <option value={1}>Certify — no changes allowed</option>
                <option value={2}>Certify — allow form filling and signing</option>
                <option value={3}>Certify — allow form filling, signing and comments</option>
              </select>
            </label>
          )}
          <p className="muted small">Level: PAdES-B-B (no timestamp). Any later change to the document will be visible to anyone checking the signature.</p>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-btn" onClick={sign} disabled={busy} data-testid="sign-confirm">
              {busy ? 'Signing…' : 'Sign and save'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
