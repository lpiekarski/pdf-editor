import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openFile, useDoc } from '../model/docStore';
import { useView } from '../model/viewStore';
import { IconClose, IconFitWidth, IconOpen, IconZoomIn, IconZoomOut } from './icons';

export function IconButton(props: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  showLabel?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'icon-btn active' : 'icon-btn'}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      data-testid={props.testId}
    >
      {props.children}
      {props.showLabel && <span className="icon-btn-label">{props.label}</span>}
    </button>
  );
}

/** Hidden file input + button. `<input type=file>` is the one approach that works on iOS and Android. */
export function OpenButton({ showLabel = false, big = false }: { showLabel?: boolean; big?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = '';
        }}
      />
      {big ? (
        <button className="primary-btn" onClick={() => input.current?.click()}>
          <IconOpen /> Open PDF
        </button>
      ) : (
        <IconButton label="Open PDF" onClick={() => input.current?.click()} showLabel={showLabel}>
          <IconOpen />
        </IconButton>
      )}
    </>
  );
}

export function ZoomControls({ compact = false }: { compact?: boolean }) {
  const zoom = useView((s) => s.zoom);
  const { setZoom, fit } = useView.getState();
  return (
    <div className="zoom-controls">
      <IconButton label="Zoom out" onClick={() => setZoom(zoom / 1.2)}>
        <IconZoomOut />
      </IconButton>
      {!compact && (
        <button className="zoom-value" onClick={() => setZoom(1)} title="Reset to 100%">
          {Math.round(zoom * 100)}%
        </button>
      )}
      <IconButton label="Zoom in" onClick={() => setZoom(zoom * 1.2)}>
        <IconZoomIn />
      </IconButton>
      <IconButton label="Fit width" onClick={() => fit('width')}>
        <IconFitWidth />
      </IconButton>
    </div>
  );
}

export function PageIndicator() {
  const current = useView((s) => s.currentPage);
  const count = useDoc((s) => s.pages.length);
  const [draft, setDraft] = useState<string | null>(null);
  if (!count) return null;
  return (
    <form
      className="page-indicator"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(draft);
        if (n >= 1 && n <= count) useView.getState().goToPage(n - 1);
        setDraft(null);
      }}
    >
      <input
        aria-label="Page number"
        inputMode="numeric"
        value={draft ?? String(current + 1)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
      />
      <span>/ {count}</span>
    </form>
  );
}

/** Slide-up panel for phones. */
export function BottomSheet({ title, open, onClose, children }: { title: string; open: boolean; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <IconClose />
          </IconButton>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function PasswordDialog() {
  const prompt = useDoc((s) => s.passwordPrompt);
  const [pw, setPw] = useState('');
  if (!prompt) return null;
  return (
    <Modal title="Password required">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          prompt.resolve(pw);
          setPw('');
        }}
      >
        <p>{prompt.incorrect ? 'That password is incorrect. Try again.' : 'This PDF is password protected.'}</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
        <div className="modal-actions">
          <button type="button" onClick={() => prompt.resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="primary-btn">
            Open
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EmptyState() {
  const { loading, error } = useDoc();
  return (
    <div className="empty">
      <div className="empty-card">
        <h1>PDF Editor</h1>
        <p>Edit, fill in and sign PDF files. Everything happens on your device — files are never uploaded.</p>
        <OpenButton big />
        <p className="hint">…or drop a PDF anywhere on this window.</p>
        {loading && <p>Opening…</p>}
        {error && <p className="error">Could not open the file: {error}</p>}
      </div>
    </div>
  );
}
