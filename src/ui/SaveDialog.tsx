import { useState } from 'react';
import { useDoc } from '../model/docStore';
import { useEditor } from '../model/editorStore';
import { buildOutput, saveBytes, suggestedName } from '../export/save';
import { IconButton, Modal } from './common';
import { IconSave } from './icons';
import { useUi } from '../editor/uiStore';

export function SaveButton({ showLabel }: { showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Save" onClick={() => setOpen(true)} showLabel={showLabel} testId="save">
        <IconSave />
      </IconButton>
      {open && <SaveDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveDialog({ onClose }: { onClose(): void }) {
  const file = useDoc((s) => s.file);
  const hasForm = useDoc((s) => s.hasForm);
  const hasWhiteout = useEditor((s) => Object.values(s.objects).some((o) => o.kind === 'whiteout'));
  const [name, setName] = useState(suggestedName(file?.name ?? 'document.pdf'));
  const [flatten, setFlatten] = useState(false);
  const hasAdded = useEditor((s) => Object.values(s.objects).some((o) => ['text', 'image', 'shape', 'ink', 'whiteout', 'mark'].includes(o.kind)));
  const [keepEditable, setKeepEditable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildOutput({ flattenForms: flatten, keepAsAnnotations: keepEditable });
      const how = await saveBytes(bytes, /\.pdf$/i.test(name) ? name : `${name}.pdf`);
      if (how) {
        useEditor.setState({ dirty: false });
        useUi.getState().showToast(how === 'share' ? 'Shared.' : 'Saved.');
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Save PDF" onClose={busy ? undefined : onClose}>
      <label className="field">
        <span>File name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} data-testid="save-name" />
      </label>
      {hasForm && (
        <label className="check">
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
          <span>Flatten form fields (values become part of the page and can no longer be edited)</span>
        </label>
      )}
      {hasAdded && (
        <label className="check">
          <input type="checkbox" checked={keepEditable} onChange={(e) => setKeepEditable(e.target.checked)} data-testid="keep-editable" />
          <span>Keep added text, shapes, drawings and images editable in other PDF apps (saved as annotations instead of becoming part of the page)</span>
        </label>
      )}
      {hasWhiteout && (
        <p className="note warn">
          White-out only covers content visually. The text underneath is still in the file and can be extracted — do not rely on it
          to remove sensitive information.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary-btn" onClick={save} disabled={busy} data-testid="save-confirm">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
