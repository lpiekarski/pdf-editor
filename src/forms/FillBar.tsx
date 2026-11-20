import { deletedAnnots } from '../editor/existingAnnots';
import { useEffect, useState } from 'react';
import { useDoc } from '../model/docStore';
import { useEditor } from '../model/editorStore';
import { detectAll, useFill } from './FillLayer';
import type { DetectedField } from './detect';
import { exportPdf } from '../export/pipeline';
import { useUi } from '../editor/uiStore';
import { Modal } from '../ui/common';
import { IconButton } from '../ui/common';
import { IconForm } from '../ui/icons';

/** Toolbar toggle for fill mode (only for PDFs without real form fields). */
export function FillToggle() {
  const on = useFill((s) => s.on);
  const hasForm = useDoc((s) => s.hasForm);
  if (hasForm) return null;
  return (
    <IconButton label="Fill form (find blanks)" active={on} onClick={() => useFill.getState().toggle()} testId="fill-mode">
      <IconForm />
    </IconButton>
  );
}

/** Banner shown in fill mode: how many blanks were found, and the option to convert them to real fields. */
export function FillBar() {
  const on = useFill((s) => s.on);
  const { pdf, pages, file } = useDoc();
  const [found, setFound] = useState<DetectedField[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!on || !pdf) return;
    let alive = true;
    setFound(null);
    detectAll(pdf, pages).then((f) => alive && setFound(f));
    return () => {
      alive = false;
    };
  }, [on, pdf, pages]);

  if (!on) return null;

  const convert = async () => {
    if (!file || !found) return;
    setBusy(true);
    try {
      const s = useEditor.getState();
      const bytes = await exportPdf({
        bytes: file.bytes,
        pages,
        objects: s.order.map((id) => s.objects[id]),
        images: s.images,
        formValues: s.formValues,
        createFields: found,
        removeAnnots: deletedAnnots(s),
      });
      useFill.getState().toggle(false);
      await useDoc.getState().open(file.name.replace(/\.pdf$/i, '') + '-fillable.pdf', bytes);
      useUi.getState().showToast(`Created ${found.length} form fields. Save to keep the fillable PDF.`);
    } catch (e) {
      useUi.getState().showToast(`Conversion failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className="fill-bar" role="status">
      {found === null ? (
        <span>Looking for blanks to fill…</span>
      ) : found.length ? (
        <>
          <span>
            Found <b>{found.length}</b> place{found.length === 1 ? '' : 's'} to fill in. Tap one to type or tick it.
          </span>
          <button className="link-btn" onClick={() => setConfirm(true)} data-testid="make-fillable">
            Make fillable PDF
          </button>
        </>
      ) : (
        <span>No blanks detected (scanned page?). Use the Text and Fill-in tools to place content anywhere.</span>
      )}
      <button className="link-btn" onClick={() => useFill.getState().toggle(false)}>
        Done
      </button>
      {confirm && (
        <Modal title="Make fillable PDF" onClose={() => setConfirm(false)}>
          <p>
            This adds {found?.length} real form fields to the PDF, so it can be filled in any PDF reader. Anything you have already added
            will become a permanent part of the pages.
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirm(false)}>Cancel</button>
            <button className="primary-btn" onClick={convert} disabled={busy}>
              {busy ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
