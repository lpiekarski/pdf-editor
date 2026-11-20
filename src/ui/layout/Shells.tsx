import type { ReactNode } from 'react';
import { useDoc } from '../../model/docStore';
import { useView } from '../../model/viewStore';
import { Thumbnails } from '../../viewer/Thumbnails';
import { BottomSheet, IconButton, OpenButton, PageIndicator, ZoomControls } from '../common';
import { IconPages, IconShield, IconSliders } from '../icons';

/** Pieces each feature contributes to the chrome; both shells arrange the same slots. */
export interface ShellSlots {
  viewer: ReactNode;
  /** Tool buttons (select, text, image, ...). */
  tools?: ReactNode;
  /** Document actions shown in the header (undo/redo, save, sign...). */
  actions?: ReactNode;
  /** Property editor for the selection. */
  inspector?: ReactNode;
  /** Signature list. */
  signatures?: ReactNode;
  /** Banner above the document (e.g. signature status). */
  banner?: ReactNode;
}

export function DesktopShell({ viewer, tools, actions, inspector, signatures, banner }: ShellSlots) {
  const name = useDoc((s) => s.file?.name);
  const sheet = useView((s) => s.sheet);
  const left = sheet === 'signatures' ? 'signatures' : 'pages';
  return (
    <div className="shell desktop">
      <header className="topbar">
        <OpenButton />
        <span className="doc-name" title={name}>{name}</span>
        <div className="toolbar-tools" role="toolbar" aria-label="Tools">{tools}</div>
        <div className="spacer" />
        <PageIndicator />
        <ZoomControls />
        <div className="toolbar-actions">{actions}</div>
      </header>
      <div className="workspace">
        <aside className="sidebar left">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={left === 'pages'} onClick={() => useView.setState({ sheet: null })}>
              Pages
            </button>
            {signatures && (
              <button role="tab" aria-selected={left === 'signatures'} onClick={() => useView.setState({ sheet: 'signatures' })}>
                Signatures
              </button>
            )}
          </div>
          <div className="sidebar-body">{left === 'pages' ? <Thumbnails /> : signatures}</div>
        </aside>
        <main className="main">
          {banner}
          {viewer}
        </main>
        {inspector && <aside className="sidebar right">{inspector}</aside>}
      </div>
    </div>
  );
}

export function MobileShell({ viewer, tools, actions, inspector, signatures, banner }: ShellSlots) {
  const name = useDoc((s) => s.file?.name);
  const sheet = useView((s) => s.sheet);
  const { setSheet } = useView.getState();
  const close = () => useView.setState({ sheet: null });
  return (
    <div className="shell mobile">
      <header className="topbar">
        <OpenButton />
        <span className="doc-name" title={name}>{name}</span>
        <div className="spacer" />
        <PageIndicator />
        <IconButton label="Pages" onClick={() => setSheet('pages')} active={sheet === 'pages'}>
          <IconPages />
        </IconButton>
        {signatures && (
          <IconButton label="Signatures" onClick={() => setSheet('signatures')} active={sheet === 'signatures'}>
            <IconShield />
          </IconButton>
        )}
        <div className="toolbar-actions">{actions}</div>
      </header>
      {banner}
      <main className="main">{viewer}</main>
      <nav className="bottombar" role="toolbar" aria-label="Tools">
        {tools}
        {inspector && (
          <IconButton label="Properties" onClick={() => setSheet('inspector')} active={sheet === 'inspector'}>
            <IconSliders />
          </IconButton>
        )}
        <ZoomControls compact />
      </nav>
      <BottomSheet title="Pages" open={sheet === 'pages'} onClose={close}>
        <Thumbnails onPick={close} />
      </BottomSheet>
      <BottomSheet title="Signatures" open={sheet === 'signatures'} onClose={close}>
        {signatures}
      </BottomSheet>
      <BottomSheet title="Properties" open={sheet === 'inspector'} onClose={close}>
        {inspector}
      </BottomSheet>
    </div>
  );
}
