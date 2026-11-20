import { useEffect, useLayoutEffect, useRef } from 'react';
import { useEditor } from '../model/editorStore';
import type { NoteObject, TextObject } from '../model/types';
import { cssFont } from '../fonts';
import { css } from './ObjectView';
import { useUi } from './uiStore';

/** In-place editor for a text box, styled with the same font as the rendered/exported text. */
export function TextEditor({ o, zoom }: { o: TextObject; zoom: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const font = cssFont(o.font, o.bold, o.italic);

  useEffect(() => {
    const ta = ref.current!;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [o.id]);

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.style.height = '0px';
    ta.style.height = `${Math.max(ta.scrollHeight, o.size * 1.2 * zoom)}px`;
  }, [o.text, o.size, zoom, o.rect.width]);

  const finish = () => {
    const st = useEditor.getState();
    const cur = st.objects[o.id];
    st.setEditing(null);
    if (cur && cur.kind === 'text' && cur.text.trim() === '') {
      // Removing an empty, never-filled box should not leave an undo step behind.
      useEditor.setState((s) => {
        const objects = { ...s.objects };
        delete objects[o.id];
        return { objects, order: s.order.filter((x) => x !== o.id), selection: [], past: s.past.slice(0, -1) };
      });
    }
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={o.text}
      spellCheck
      aria-label="Text"
      style={{
        left: o.rect.x * zoom,
        top: o.rect.y * zoom,
        width: o.rect.width * zoom,
        transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
        ...font,
        fontSize: o.size * zoom,
        lineHeight: 1.2,
        color: css(o.color),
        textAlign: o.align,
        background: o.background ? css(o.background) : 'rgba(255,255,255,0.6)',
      }}
      onChange={(e) => useEditor.getState().update(o.id, { text: e.target.value }, `text:${o.id}`)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') ref.current?.blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** Popup for a sticky note's comment text. */
export function NoteEditor({ id, zoom, pageWidth }: { id: string; zoom: number; pageWidth: number }) {
  const open = useUi((s) => s.noteOpen === id);
  const o = useEditor((s) => s.objects[id]) as NoteObject | undefined;
  if (!open || !o) return null;
  // Position in screen pixels: next to the icon, but kept inside the page (the popup is 200px wide).
  const POPUP_W = 200;
  const right = (o.rect.x + o.rect.width) * zoom + 4;
  const fitsRight = right + POPUP_W <= pageWidth * zoom - 4;
  // No room to the right (narrow screens): open below the icon instead of covering it.
  const left = fitsRight ? right : Math.max(4, Math.min(o.rect.x * zoom, pageWidth * zoom - POPUP_W - 4));
  const top = fitsRight ? o.rect.y * zoom : (o.rect.y + o.rect.height) * zoom + 4;
  return (
    <div className="note-popup" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        aria-label="Note text"
        placeholder="Comment…"
        value={o.text}
        onChange={(e) => useEditor.getState().update(id, { text: e.target.value }, `note:${id}`)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') useUi.setState({ noteOpen: null });
        }}
      />
      <div className="note-actions">
        <button
          onClick={() => {
            useEditor.getState().remove([id]);
            useUi.setState({ noteOpen: null });
          }}
        >
          Delete
        </button>
        <button className="primary-btn" onClick={() => useUi.setState({ noteOpen: null })}>
          Done
        </button>
      </div>
    </div>
  );
}
