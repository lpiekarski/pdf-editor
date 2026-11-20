import { useEffect, useState } from 'react';
import { useEditor } from '../model/editorStore';
import { useDoc } from '../model/docStore';
import { Modal } from '../ui/common';
import { useUi } from '../editor/uiStore';
import { useSignatures } from './verify/useSignatures';

/**
 * Protects signed documents:
 *  - read-only snapshots and "certified, no changes" documents: every edit is undone at once;
 *  - otherwise: one warning explaining which changes keep the signatures valid.
 * Edits are always saved as incremental updates, so the signed revision itself stays intact.
 */
export function EditGuard() {
  const past = useEditor((s) => s.past.length);
  const signatures = useSignatures((s) => s.signatures);
  const docMdp = useSignatures((s) => s.docMdp) ?? null;
  const viewingRevision = useDoc((s) => !!s.revisionOf);
  const file = useDoc((s) => s.file);
  const [ackFor, setAckFor] = useState<Uint8Array | null>(null);
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    if (!past) return;
    if (viewingRevision) {
      useEditor.getState().undo();
      useUi.getState().showToast('This is a read-only snapshot of a signed version. Go back to the current version to edit.');
      return;
    }
    if (!signatures?.length) return;
    if (docMdp === 1) {
      useEditor.getState().undo();
      useUi.getState().showToast('This document is certified with “no changes allowed”. It cannot be edited without breaking the certification.');
      return;
    }
    if (ackFor !== file?.bytes) setWarn(true);
  }, [past, signatures, docMdp, viewingRevision, ackFor, file]);

  if (!warn) return null;
  const close = (keep: boolean) => {
    setWarn(false);
    setAckFor(file?.bytes ?? null);
    if (!keep) useEditor.getState().undo();
  };
  return (
    <Modal title="This document is signed" onClose={() => close(true)}>
      <p>Your changes are added on top of the signed version, which stays intact. How they affect the signatures:</p>
      <ul className="guard-list">
        <li>
          <b>Filling in form fields and adding signatures</b> — {docMdp === null || docMdp >= 2 ? 'allowed; signatures stay valid.' : 'not allowed.'}
        </li>
        <li>
          <b>Highlights and comments</b> — {docMdp === null || docMdp === 3 ? 'allowed for this document.' : 'not allowed by the certification.'}
        </li>
        <li>
          <b>Text, images, drawings, white-out</b> — change the page content. Readers will see the document was modified after it was signed.
        </li>
      </ul>
      <div className="modal-actions">
        <button onClick={() => close(false)}>Undo my change</button>
        <button className="primary-btn" onClick={() => close(true)}>
          Continue editing
        </button>
      </div>
    </Modal>
  );
}
