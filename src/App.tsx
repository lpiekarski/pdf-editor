import { useEffect } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { openFile, useDoc } from './model/docStore';
import { Viewer } from './viewer/Viewer';
import { DesktopShell, MobileShell, type ShellSlots } from './ui/layout/Shells';
import { EmptyState, PasswordDialog } from './ui/common';
import { useIsDesktop } from './ui/hooks';

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

export function App() {
  const hasDoc = useDoc((s) => !!s.pdf);
  const desktop = useIsDesktop();
  useFileDrop();

  const slots: ShellSlots = { viewer: <Viewer /> };
  return (
    <>
      {hasDoc ? desktop ? <DesktopShell {...slots} /> : <MobileShell {...slots} /> : <EmptyState />}
      <PasswordDialog />
    </>
  );
}
