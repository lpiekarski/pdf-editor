import { useEffect, useState } from 'react';
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
import { FormLayer } from './forms/FormLayer';
import { SaveButton } from './ui/SaveDialog';
import { RestrictionBanner } from './ui/RestrictionBanner';
import { pdfjs } from './viewer/pdfjs';
import { FillLayer } from './forms/FillLayer';
import { FillBar, FillToggle } from './forms/FillBar';
import { SignatureDialog } from './signature/graphic/SignatureDialog';
import { placeImage } from './editor/images';
import { SignDialog } from './signature/SignDialog';
import { EditGuard } from './signature/EditGuard';
import { SignatureBadgeLayer, SignatureBanner, SignaturePanel } from './signature/verify/SignatureUI';
import { IconButton } from './ui/common';
import { IconSeal } from './ui/icons';
import { lockedBy, useSignatures } from './signature/verify/useSignatures';

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
      if (t.closest('.obj, .handle, .sel-frame, .text-editor, .note-popup, .inspector, .ctx-menu, .sheet, .modal, .topbar, .bottombar, .sidebar, .tool-popover, .floating-apply, .field, .hotspot, .fill-bar, .sig-zone, .sig-banner'))
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
  const hasForm = useDoc((s) => s.hasForm);
  const desktop = useIsDesktop();
  useFileDrop();
  useDeselectOnBackground();
  useEditorShortcuts(hasDoc);
  useMarkupTool();
  const [sigOpen, setSigOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const hasSignatures = useSignatures((s) => (s.signatures?.length ?? 0) > 0);

  const slots: ShellSlots = {
    viewer: (
      <Viewer
        // With form fields, pdf.js leaves widget appearances off the canvas and we draw live inputs instead.
        annotationMode={hasForm ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE}
        renderOverlay={(info, zoom) => (
          <>
            {hasForm && <FormLayer info={info} zoom={zoom} lockedBy={(name) => lockedBy(useSignatures.getState().signatures, name)} />}
            <ObjectLayer info={info} zoom={zoom} />
            <FillLayer info={info} zoom={zoom} />
            <SignatureBadgeLayer info={info} zoom={zoom} />
          </>
        )}
      />
    ),
    tools: (
      <>
        <FillToggle />
        <Tools onSignature={() => setSigOpen(true)} />
      </>
    ),
    banner: (
      <>
        <RestrictionBanner />
        <SignatureBanner />
        <FillBar />
      </>
    ),
    // Desktop always offers the Signatures tab; phones show the button only when there is something to see.
    signatures: desktop || hasSignatures ? <SignaturePanel /> : undefined,
    actions: (
      <>
        <UndoRedo />
        <IconButton label="Sign digitally" onClick={() => setSignOpen(true)} showLabel={desktop} testId="sign">
          <IconSeal />
        </IconButton>
        <SaveButton showLabel={desktop} />
      </>
    ),
    inspector: <Inspector />,
  };
  return (
    <>
      {hasDoc ? desktop ? <DesktopShell {...slots} /> : <MobileShell {...slots} /> : <EmptyState />}
      <PasswordDialog />
      <ContextMenu />
      <MarkupApplyButton />
      <Toast />
      <EditGuard />
      {signOpen && <SignDialog onClose={() => setSignOpen(false)} />}
      {sigOpen && (
        <SignatureDialog
          onClose={() => setSigOpen(false)}
          onDone={(sig) => {
            setSigOpen(false);
            const img = useEditor.getState().addImage({ bytes: sig.bytes, mime: 'image/png', width: sig.width, height: sig.height });
            placeImage(img, { signature: true, maxWidth: 160 });
          }}
        />
      )}
    </>
  );
}
