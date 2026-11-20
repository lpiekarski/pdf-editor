import { useEffect } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { openFile, useDoc } from './model/docStore';
import { useEditor } from './model/editorStore';
import { Viewer } from './viewer/Viewer';
import { DesktopShell, MobileShell, type ShellSlots } from './ui/layout/Shells';
import { EmptyState, PasswordDialog } from './ui/common';
import { useIsDesktop } from './ui/hooks';
import { ObjectLayer } from './editor/ObjectLayer';
import { MarkupApplyButton, Tools, UndoRedo } from './editor/Toolbar';
import { Inspector } from './editor/Inspector';
import { ContextMenu, Toast } from './editor/ContextMenu';
import { useEditorShortcuts } from './editor/shortcuts';
import { useMarkupTool } from './editor/markup';

function useFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (!f) return;
      e.preventDefault();
      void openFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

/** Clicking/tapping outside any object or panel clears the selection. */
function useDeselectOnBackground() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.obj, .handle, .sel-frame, .text-editor, .note-popup, .inspector, .ctx-menu, .sheet, .modal, .topbar, .bottombar, .sidebar, .tool-popover, .floating-apply'))
        return;
      const s = useEditor.getState();
      if (s.selection.length) s.select([]);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
}

export function App() {
  const hasDoc = useDoc((s) => !!s.pdf);
  const desktop = useIsDesktop();
  useFileDrop();
  useDeselectOnBackground();
  useEditorShortcuts(hasDoc);
  useMarkupTool();

  const slots: ShellSlots = {
    viewer: <Viewer renderOverlay={(info, zoom) => <ObjectLayer info={info} zoom={zoom} />} />,
    tools: <Tools />,
    actions: <UndoRedo />,
    inspector: <Inspector />,
  };
  return (
    <>
      {hasDoc ? desktop ? <DesktopShell {...slots} /> : <MobileShell {...slots} /> : <EmptyState />}
      <PasswordDialog />
      <ContextMenu />
      <MarkupApplyButton />
      <Toast />
    </>
  );
}
