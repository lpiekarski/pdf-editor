# PDF Editor — Implementation Plan

## Status (2026-11-20)

All 11 steps are implemented and covered by tests: 33 unit/integration tests, plus Playwright end-to-end tests on desktop Chromium, Android Chromium and iPhone WebKit emulation. Signed outputs are validated with pyHanko and qpdf.

**Deviations from the plan:**
- The incremental writer lives in `src/pdf/incremental.ts`, because export uses it too, not only signing. *All* saves are incremental, not just saves of signed files.
- PKCS#12 files are read with node-forge, because WebCrypto can't decrypt the legacy 3DES files that Windows exports. The key is then imported into WebCrypto as non-extractable. Only RSA keys are supported.
- Field detection runs on pdf.js v6 operator lists (a new path encoding).

**Not done yet:**
- An export option to keep text/shapes as editable annotations (FreeText/Stamp/Square/Ink). They are always flattened.
- Selecting and deleting annotations that already exist in a PDF (the `locked` flag exists, but existing annotations aren't loaded into the editor).
- Enforcing FieldMDP field locks set by earlier signers. DocMDP is enforced.
- Tiled re-rendering at very high zoom. Canvases are capped by pixel count instead, so deep zoom is softer.
- Manual checks on real iPhone/Android devices and in Adobe Acrobat Reader.

## Context
`C:\Users\lukasz\projects\pdf-editor` is empty except for `PLAN.md`, the earlier design notes. The goal is a **static, fully client-side web app** that works well in **desktop browsers and on phones**. It should:
- **Edit like a WYSIWYG editor:** add any text, images, shapes and freehand drawings; highlight, underline and strike out existing text; add sticky notes; cover content with white-out.
- **Fill forms:** real AcroForm fields, and flat PDFs without fields (placing text, checkmarks and dates, plus automatically detected blanks).
- **Add graphical signatures:** drawn, typed or uploaded.
- **Sign digitally:** a .p12/.pfx file at **PAdES-B-B** only. That means **no network calls at all**, so there are no CORS problems.
- **Detect and display existing signatures when a file opens:** banner, badges on the page, signature panel, "view signed version", and a guard against edits.

Out of scope:
- editing or retyping the PDF's own existing text (white-out plus new text covers that);
- B-T, B-LT and B-LTA signing (signing with timestamp, OCSP or CRL);
- eIDAS, smart cards, cloud signing, Profil Zaufany;
- trust-store validation and XFA.

Environment: Node 24 and Python 3.14 are installed; the folder isn't a git repository yet.

## Stack
- TypeScript, React 18, Vite. Static build, deployed to GitHub Pages or any static host.
- `pdfjs-dist` renders pages, the text layer and existing annotations, and reads fields and drawing operators.
- `pdf-lib` + `@pdf-lib/fontkit` writes to the PDF. Embedded fonts: Noto Sans, Serif and Mono (full Polish/Latin-Extended support), plus 2–3 OFL script fonts for typed signatures.
- `pkijs`, `asn1js` and WebCrypto handle CMS/CAdES and certificate parsing, and read PKCS#12 files (`node-forge` only as a fallback).
- `zustand` for state, `perfect-freehand` for ink, `idb-keyval` for local storage, `@use-gesture/react` for pinch-zoom, drag and pan on touch and mouse.
- Vitest and Playwright (desktop Chrome/Firefox/WebKit plus mobile emulation: iPhone 14 and Pixel 7). pyHanko and qpdf, installed in a Python venv, check the output files.

## Project layout
```
package.json, vite.config.ts, tsconfig.json, .github/workflows/deploy.yml
public/fonts/            Noto Sans/Serif/Mono, script fonts (OFL)
src/main.tsx, src/App.tsx
src/viewer/              PdfDocument.ts, PageView.tsx, Thumbnails.tsx, coords.ts, renderQueue.ts
src/model/               types.ts (EditorObject union), store.ts, history.ts
src/editor/              ObjectLayer.tsx, Handles.tsx, tools/ (text, image, shape, ink, highlight, note, whiteout)
                         textSelection.ts (text-layer selection -> quads), Inspector.tsx (properties)
src/forms/               acroform.ts, overlay.ts, detect.ts, convert.ts
src/signature/graphic/   DrawPad.tsx, TypePad.tsx, UploadPad.tsx, library.ts
src/signature/pdf/       incremental.ts, sigField.ts, placeholder.ts, parse.ts
src/signature/cms/       cades.ts, p12.ts
src/signature/signer.ts  Signer interface + P12Signer
src/signature/verify/    detect.ts, validate.ts, mdp.ts, revisions.ts
src/export/              pipeline.ts, writeContent.ts (page content), writeAnnots.ts (annotations)
src/ui/                  layout/ (DesktopShell, MobileShell), Toolbar, Sidebar/BottomSheet,
                         SignaturePanel, SignatureBanner, dialogs
tests/fixtures/          PDFs + test CA/p12 (scripts/make-test-certs.ts)
tests/e2e/               Playwright specs (desktop + mobile projects)
tools/validate.py        pyHanko/qpdf helper
```

## Key design rules
1. **The editor model is kept separate from the PDF bytes.** Every edit is stored as an `EditorObject` in PDF user-space coordinates and is only written on export.
2. **How each kind of object is saved:**
   - Highlight, underline, strikeout and sticky notes are saved as **real PDF annotations** (Highlight/Underline/StrikeOut with QuadPoints, and Text), so other readers can still see and edit them.
   - Text boxes, images, shapes, ink and white-out are drawn into the **page content** by default. An export option keeps them as annotations instead (FreeText/Stamp/Square/Ink) so they stay editable elsewhere.
   - Annotations that already exist in the PDF stay where they are. The user can select and delete them.
3. **Export order is fixed:**
   1. pdf-lib applies form values, content objects and annotations. This step runs only when the file is not yet signed.
   2. Save.
   3. Append the signature field and placeholder as an incremental update.
   4. Hash the ByteRange, call `Signer.signHash`, build the CMS, and inject it.
4. **After a file is signed, every change is an incremental update.** That uses `incremental.ts`; pdf-lib never rewrites a signed file.
5. **`Signer` interface:** `getCertificateChain()` and `signHash(digest, alg)`.
6. **The app never makes network calls.** Fonts and the pdf.js worker are bundled. A service worker makes the app work offline.

## Desktop and phone
- **Responsive layout:**
  - At 900px and wider: top toolbar, a left sidebar for thumbnails and signatures, and a right Inspector for properties.
  - Narrower: a compact top bar, a **bottom tool bar**, and **bottom sheets** for thumbnails, the inspector and the signature panel. The signature banner collapses to a single line.
- **Touch:**
  - pinch to zoom, two-finger pan, tap to place;
  - one-finger drag pans the page, unless a tool is active or an object is selected;
  - large touch targets (44px or more) for handles;
  - long-press opens the context menu;
  - text selection for highlighting uses the native selection handles on the pdf.js text layer.
- **Performance and memory:**
  - render only the visible pages plus or minus one;
  - limit canvas size (iOS caps a canvas at about 16.7M pixels) and lower the resolution when zoomed in, re-rendering tiles when needed;
  - free canvases for pages that are off-screen.
- **Files:**
  - open with `<input type=file>` (works on iOS and Android) or drag-and-drop on desktop;
  - save with the File System Access API where available, otherwise **Web Share API** (share sheet) on mobile, otherwise a download.
- **Signature pad:** full-screen in landscape on phones, with pressure support where available.
- **PWA manifest**, so the app can be installed on the home screen.

## Implementation steps
Each step ends with unit and e2e tests passing, in both the desktop and mobile Playwright projects.

1. **Scaffold**
   - Run `git init`, create the Vite React-TS app, set up ESLint/Prettier, Vitest and Playwright (desktop and mobile projects).
   - GitHub Pages deploy workflow, PWA manifest and service worker.
   - `scripts/make-test-certs.ts` generates a test CA and a signer `.p12`.
   - Fixture PDFs: with fields, flat, rotated, multi-page, Polish text, xref-stream files, and files that already have annotations.
2. **Viewer and responsive shell**
   - `PdfDocument.ts`, `PageView.tsx` (canvas, text layer and annotation layer), `renderQueue.ts` (lazy rendering with memory limits).
   - Zoom (pinch, wheel, buttons) and thumbnails.
   - `coords.ts` maps screen ↔ PDF positions, handling /Rotate and CropBox. It gets unit tests.
   - `DesktopShell` and `MobileShell`.
3. **Incremental writer (risk spike)**
   - `incremental.ts` parses the last xref (table or stream), appends objects, writes the matching xref type, and writes the trailer with `/Prev`.
   - Tests: append to every fixture, then check with `qpdf --check`, and confirm pdf.js reopens the file.
4. **Editor core**
   - `types.ts`, `store.ts` and `history.ts` (undo/redo).
   - `ObjectLayer` and `Handles`: select, multi-select, move, resize, rotate, delete, nudge, copy/paste, z-order. Mouse and touch.
   - `Inspector` for font, size, color, bold/italic, alignment, opacity, line width and fill.
5. **WYSIWYG tools**
   - **Text box:** contentEditable while editing. Text is laid out with fontkit metrics so the screen matches the export.
   - **Image:** PNG/JPEG, keeps aspect ratio.
   - **Shapes:** rectangle, ellipse, line, arrow.
   - **Ink:** perfect-freehand.
   - **White-out.**
   - **Highlight, underline and strikeout:** `textSelection.ts` turns the selection into QuadPoints.
   - **Sticky note.**
   - Export: `writeContent.ts` writes content operators with the embedded font subset; `writeAnnots.ts` writes annotations with appearance streams.
6. **AcroForm filling**
   - `acroform.ts` reads fields with `getFieldObjects()` and shows HTML inputs over the page: text, checkbox, radio, choice, multiline, comb and maxLen.
   - On export, write values with pdf-lib and regenerate appearances with Noto Sans. Option to flatten.
   - XFA-only files show a warning.
7. **Filling flat PDFs**
   - `overlay.ts`: one-tap check / X / dot and date / initials stamps, built on the text tool.
   - Snap to text baselines.
   - `detect.ts` uses `getOperatorList()` to find lines and boxes, and the text layer to find `Label:` and `___` patterns, and shows click-to-fill hotspots.
   - `convert.ts` can create real AcroForm fields from them.
8. **Graphical signature**
   - Draw, Type and Upload pads. Upload removes the background and crops the image.
   - `library.ts` stores saved signatures in IndexedDB.
   - Signatures are placed as an image object.
9. **Digital signing (PAdES-B-B)**
   - `p12.ts` reads the file, `P12Signer` signs.
   - `sigField.ts` adds a visible or invisible widget; a visible one shows the graphic plus name and date.
   - `placeholder.ts` reserves `/Contents` (16 KB) and `/ByteRange`.
   - `cades.ts` builds SignedData with signingCertificateV2, using SubFilter `ETSI.CAdES.detached`.
   - Dialog: choose the P12, enter the password, reason, location, and visible or invisible.
   - Multiple signatures are added as incremental updates. Certification signature with permission levels 1, 2 or 3. Respect FieldMDP locks.
10. **Detect and display signatures**
    - `detect.ts` runs on every file open: finds `/FT /Sig` fields with a `/V`, `/Perms`, and document timestamps.
    - `validate.ts` checks ByteRange coverage, the digest, and the CMS signature against the signer certificate. It also reads embedded timestamps, DSS and OCSP/CRL from files signed elsewhere, offline and for display only.
    - `revisions.ts` splits the file at each `%%EOF`. `mdp.ts` classifies the changes after each signature.
    - UI:
      - `SignatureBanner`;
      - badges on the widgets that open details when tapped or clicked;
      - `SignaturePanel` cards (a bottom sheet on mobile) showing signer, certificate, times, reason and location, level, integrity, validity, changes after signing, an expandable chain with export, and revocation info;
      - "View signed version" opens a revision read-only.
    - Editing guard: warn before editing a signed file; allowed edits go through the incremental path (form fill, plus annotations when P=3), forbidden ones are blocked.
11. **Save and polish**
    - Save via FS Access, Web Share or download.
    - Password-protected PDFs: a prompt to open them.
    - Keyboard shortcuts, accessibility basics, and performance checks on a 200-page file.

## Verification
- **Unit (Vitest):**
  - `coords.ts`;
  - the incremental writer on every fixture;
  - text layout metrics (on-screen width = exported width, within 1%);
  - QuadPoints from the selection;
  - CMS structure and digest;
  - `detect.ts`, `validate.ts` and `mdp.ts` on fixtures signed by us and by pyHanko.
- **Validating the output (`tools/validate.py`):**
  - pyHanko `validate` on every signed output, expecting "intact, valid, unmodified" (with the test CA trusted);
  - `qpdf --check` passes.
- **E2E (Playwright, against `vite preview`, run on both desktop and mobile emulation):**
  1. Add a text box with Polish text, an image and a rectangle; export; reopen; the text can be extracted and the image is present.
  2. Highlight existing text; export; the Highlight annotation is present with correct QuadPoints.
  3. Fill AcroForm fields; then fill a flat form using detected hotspots.
  4. Draw a signature (touch drag on mobile) and place it.
  5. Sign with the test P12; pyHanko says valid; reopening shows the banner "1 signature · valid".
  6. Sign twice, and fill a field after a P=2 certification signature; all signatures stay valid.
  7. Tamper with the bytes; the banner shows the signature as invalid.
- **Manual:**
  - real iPhone (Safari) and Android (Chrome): open, pinch-zoom, edit, sign, share or save;
  - signed outputs opened in Adobe Acrobat Reader.
- **Deploy:** the GitHub Pages build loads, works offline after the first visit, and makes no network requests (checked in DevTools).
