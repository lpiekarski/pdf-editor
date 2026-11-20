import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { injectFontFaces } from './fonts';

injectFontFaces();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development aid: the live stores and export helpers, for debugging in the browser console.
if (import.meta.env.DEV) {
  void Promise.all([import('./model/docStore'), import('./model/editorStore'), import('./model/viewStore'), import('./export/save')]).then(
    ([doc, editor, view, save]) => Object.assign(window, { __app: { useDoc: doc.useDoc, useEditor: editor.useEditor, useView: view.useView, buildOutput: save.buildOutput } }),
  );
}
