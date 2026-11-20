import { useEffect } from 'react';
import { useEditor } from '../model/editorStore';
import { useUi } from './uiStore';
import { copySelection, duplicateSelection } from './shortcuts';

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.ctx-menu')) useUi.getState().closeMenu();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  if (!menu) return null;
  const s = useEditor.getState();
  const objs = menu.ids.map((id) => s.objects[id]).filter(Boolean);
  const editable = objs.filter((o) => !o.locked);
  const run = (fn: () => void) => () => {
    fn();
    useUi.getState().closeMenu();
  };
  const x = Math.min(menu.x, window.innerWidth - 200);
  const y = Math.min(menu.y, window.innerHeight - 260);
  return (
    <div className="ctx-menu" role="menu" style={{ left: x, top: y }}>
      {objs.length === 1 && objs[0].kind === 'text' && !objs[0].locked && (
        <button role="menuitem" onClick={run(() => s.setEditing(objs[0].id))}>Edit text</button>
      )}
      {editable.length > 0 && <button role="menuitem" onClick={run(duplicateSelection)}>Duplicate</button>}
      {editable.length > 0 && <button role="menuitem" onClick={run(copySelection)}>Copy</button>}
      {editable.length > 0 && <button role="menuitem" onClick={run(() => s.bringToFront(menu.ids))}>Bring to front</button>}
      {editable.length > 0 && <button role="menuitem" onClick={run(() => s.sendToBack(menu.ids))}>Send to back</button>}
      <button role="menuitem" className="danger" onClick={run(() => s.remove(menu.ids))}>Delete</button>
    </div>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  return toast ? <div className="toast" role="status">{toast}</div> : null;
}
