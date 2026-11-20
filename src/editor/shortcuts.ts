import { useEffect } from 'react';
import { useEditor } from '../model/editorStore';
import { newId, type EditorObject } from '../model/types';
import { useUi } from './uiStore';

let clipboard: EditorObject[] = [];

export function copySelection() {
  const s = useEditor.getState();
  clipboard = s.selection.map((id) => s.objects[id]).filter((o) => o && !o.locked);
}

export function pasteClipboard(offset = 12) {
  if (!clipboard.length) return;
  const s = useEditor.getState();
  const copies = clipboard.map((o) => ({ ...o, id: newId(), rect: { ...o.rect, x: o.rect.x + offset, y: o.rect.y + offset } }) as EditorObject);
  s.change((d) => {
    for (const c of copies) {
      d.objects[c.id] = c;
      d.order.push(c.id);
    }
  });
  s.select(copies.map((c) => c.id));
  clipboard = copies;
}

export function duplicateSelection() {
  copySelection();
  pasteClipboard();
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function useEditorShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e)) return;
      const sel = s.selection;
      if (e.key === 'Escape') {
        useUi.setState({ menu: null, noteOpen: null });
        if (sel.length) s.select([]);
        else s.setTool('select');
        return;
      }
      if (mod && e.key.toLowerCase() === 'c' && sel.length && !window.getSelection()?.toString()) {
        copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && sel.length) {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (!sel.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.remove(sel);
        return;
      }
      if (e.key === 'Enter' && sel.length === 1 && s.objects[sel[0]]?.kind === 'text') {
        e.preventDefault();
        s.setEditing(sel[0]);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        s.updateMany(
          sel.filter((id) => !s.objects[id]?.locked),
          (o) => ({ rect: { ...o.rect, x: o.rect.x + d[0], y: o.rect.y + d[1] } }),
          'nudge',
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
