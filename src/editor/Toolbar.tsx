import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '../model/editorStore';
import type { ToolId } from '../model/types';
import { IconButton } from '../ui/common';
import {
  IconCheck, IconHighlight, IconImage, IconNote, IconPen, IconRedo, IconSelect, IconShape, IconSign, IconText, IconUndo, IconWhiteout,
} from '../ui/icons';
import { importImage, pickImage, placeImage } from './images';
import { useUi } from './uiStore';
import { applySelectionMarkup } from './markup';
import type { MarkupObject } from '../model/types';

interface ToolDef {
  id: ToolId;
  label: string;
  icon: ReactNode;
}

const sw = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d={d} />
  </svg>
);

const FILL: ToolDef[] = [
  { id: 'check', label: 'Checkmark', icon: <IconCheck /> },
  { id: 'cross', label: 'Cross', icon: sw('M6 6l12 12M18 6L6 18') },
  { id: 'dot', label: 'Dot', icon: <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="5" fill="currentColor" /></svg> },
  { id: 'date', label: 'Date', icon: sw('M4 6h16v14H4zM4 10h16M9 3v4M15 3v4') },
];
const SHAPES: ToolDef[] = [
  { id: 'rect', label: 'Rectangle', icon: sw('M4 6h16v12H4z') },
  { id: 'ellipse', label: 'Ellipse', icon: sw('M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z') },
  { id: 'line', label: 'Line', icon: sw('M5 19L19 5') },
  { id: 'arrow', label: 'Arrow', icon: sw('M5 19L19 5M10 5h9v9') },
  { id: 'whiteout', label: 'White-out', icon: <IconWhiteout /> },
];
const MARKUP: ToolDef[] = [
  { id: 'highlight', label: 'Highlight text', icon: <IconHighlight /> },
  { id: 'underline', label: 'Underline text', icon: sw('M7 4v7a5 5 0 0 0 10 0V4M5 20h14') },
  { id: 'strikeout', label: 'Strike out text', icon: sw('M5 12h14M16 7a4 3 0 0 0-8 0c0 4 8 2 8 6a4 3 0 0 1-8 1') },
];

function Group({ label, tools, testId }: { label: string; tools: ToolDef[]; testId: string }) {
  const tool = useEditor((s) => s.tool);
  const [last, setLast] = useState<ToolDef>(tools[0]);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLDivElement>(null);
  const active = tools.find((t) => t.id === tool);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !btn.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.tool-popover') && setOpen(false);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  const r = btn.current?.getBoundingClientRect();
  const above = r ? r.top > window.innerHeight / 2 : false;
  return (
    <div className="tool-group" ref={btn}>
      <IconButton label={`${label}: ${(active ?? last).label}`} active={!!active} onClick={() => setOpen((v) => !v)} testId={testId}>
        {(active ?? last).icon}
        <span className="caret" aria-hidden>▾</span>
      </IconButton>
      {open && r && (
        <div className="tool-popover" role="menu" style={above ? { left: r.left, bottom: window.innerHeight - r.top + 6 } : { left: r.left, top: r.bottom + 6 }}>
          {tools.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={tool === t.id}
              className={tool === t.id ? 'active' : ''}
              data-testid={`tool-${t.id}`}
              onClick={() => {
                setLast(t);
                setOpen(false);
                useEditor.getState().setTool(t.id);
                if (MARKUP.some((m) => m.id === t.id) && applySelectionMarkup(t.id as MarkupObject['kind']) > 0) return;
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tools({ onSignature }: { onSignature?: () => void }) {
  const tool = useEditor((s) => s.tool);
  const set = (t: ToolId) => () => useEditor.getState().setTool(tool === t ? 'select' : t);
  const lock = (t: ToolId) => () => useEditor.getState().setTool(t, true);
  return (
    <>
      <IconButton label="Select" active={tool === 'select'} onClick={() => useEditor.getState().setTool('select')} testId="tool-select">
        <IconSelect />
      </IconButton>
      <span onDoubleClick={lock('text')}>
        <IconButton label="Add text" active={tool === 'text'} onClick={set('text')} testId="tool-text">
          <IconText />
        </IconButton>
      </span>
      <Group label="Fill in" tools={FILL} testId="group-fill" />
      <IconButton label="Draw" active={tool === 'ink'} onClick={set('ink')} testId="tool-ink">
        <IconPen />
      </IconButton>
      <Group label="Shapes" tools={SHAPES} testId="group-shapes" />
      <Group label="Mark up text" tools={MARKUP} testId="group-markup" />
      <IconButton label="Sticky note" active={tool === 'note'} onClick={set('note')} testId="tool-note">
        <IconNote />
      </IconButton>
      <IconButton
        label="Insert image"
        testId="tool-image"
        onClick={async () => {
          const f = await pickImage();
          if (!f) return;
          try {
            placeImage(await importImage(f));
          } catch {
            useUi.getState().showToast('That image format is not supported.');
          }
        }}
      >
        <IconImage />
      </IconButton>
      {onSignature && (
        <IconButton label="Signature" onClick={onSignature} testId="tool-signature">
          <IconSign />
        </IconButton>
      )}
    </>
  );
}

export function UndoRedo() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  return (
    <>
      <IconButton label="Undo" disabled={!canUndo} onClick={() => useEditor.getState().undo()} testId="undo">
        <IconUndo />
      </IconButton>
      <IconButton label="Redo" disabled={!canRedo} onClick={() => useEditor.getState().redo()} testId="redo">
        <IconRedo />
      </IconButton>
    </>
  );
}

/** Floating button for touch devices: apply the active markup tool to the native text selection. */
export function MarkupApplyButton() {
  const pending = useUi((s) => s.pendingMarkup);
  const tool = useEditor((s) => s.tool);
  if (!pending || !MARKUP.some((m) => m.id === tool)) return null;
  const label = MARKUP.find((m) => m.id === tool)!.label;
  return (
    <button
      className="primary-btn floating-apply"
      onPointerDown={(e) => e.preventDefault() /* keep the selection */}
      onClick={() => {
        applySelectionMarkup(tool as MarkupObject['kind']);
        useUi.setState({ pendingMarkup: false });
      }}
    >
      {label}
    </button>
  );
}

export { IconShape };
