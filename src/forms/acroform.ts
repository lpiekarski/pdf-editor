/**
 * AcroForm support: reading widgets (via pdf.js) for the on-page form layer, and writing the
 * user's values back (via pdf-lib) with appearances generated from an embedded Unicode font.
 */
import {
  PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, PDFName,
} from 'pdf-lib';
import type { FormValue } from '../model/editorStore';
import type { ResourceCache } from '../export/writeContent';
import type { PDFDocumentProxy } from '../viewer/pdfjs';

export type WidgetKind = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'signature' | 'button';

export interface Widget {
  id: string;
  name: string;
  kind: WidgetKind;
  page: number;
  /** PDF user space [x0, y0, x1, y1]. */
  rect: [number, number, number, number];
  value: FormValue;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  comb: boolean;
  maxLen: number | null;
  password: boolean;
  /** Checkbox/radio: the "on" export value of this widget. */
  onValue: string | null;
  options: { value: string; label: string }[];
  multiSelect: boolean;
  editable: boolean; // combo with custom text
  align: 'left' | 'center' | 'right';
  fontSize: number | null; // null/0 = auto
  /** For signature widgets: whether the field already holds a signature. */
  signed: boolean;
}

// Shape of the parts of pdf.js annotation data we use.
interface PdfjsAnnot {
  id: string;
  subtype: string;
  fieldName?: string;
  fieldType?: string;
  rect: number[];
  fieldValue?: unknown;
  readOnly?: boolean;
  required?: boolean;
  multiLine?: boolean;
  comb?: boolean;
  maxLen?: number;
  password?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  combo?: boolean;
  multiSelect?: boolean;
  hasOwnCanvas?: boolean;
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
  hidden?: boolean;
}

export async function hasAcroForm(pdf: PDFDocumentProxy): Promise<boolean> {
  const fields = await pdf.getFieldObjects();
  return !!fields && Object.keys(fields).length > 0;
}

export async function loadWidgets(pdf: PDFDocumentProxy, pageIndex: number): Promise<Widget[]> {
  const page = await pdf.getPage(pageIndex + 1);
  const annots = (await page.getAnnotations()) as PdfjsAnnot[];
  const out: Widget[] = [];
  for (const a of annots) {
    if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue;
    let kind: WidgetKind;
    if (a.fieldType === 'Tx') kind = 'text';
    else if (a.fieldType === 'Btn') kind = a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : 'button';
    else if (a.fieldType === 'Ch') kind = a.combo ? 'combo' : 'list';
    else if (a.fieldType === 'Sig') kind = 'signature';
    else continue;
    const fv = a.fieldValue;
    let value: FormValue;
    if (kind === 'checkbox') value = !!fv && fv !== 'Off' && fv === a.exportValue;
    else if (kind === 'radio') value = typeof fv === 'string' && fv !== 'Off' ? fv : '';
    else if (kind === 'list') value = Array.isArray(fv) ? (fv as string[]) : fv ? [String(fv)] : [];
    else value = Array.isArray(fv) ? String(fv[0] ?? '') : fv == null ? '' : String(fv);
    out.push({
      id: a.id,
      name: a.fieldName,
      kind,
      page: pageIndex,
      rect: a.rect as Widget['rect'],
      value,
      readOnly: !!a.readOnly,
      required: !!a.required,
      multiline: !!a.multiLine,
      comb: !!a.comb,
      maxLen: a.maxLen || null,
      password: !!a.password,
      onValue: kind === 'checkbox' ? (a.exportValue ?? 'Yes') : kind === 'radio' ? (a.buttonValue ?? null) : null,
      options: (a.options ?? []).map((o) => ({ value: o.exportValue, label: o.displayValue })),
      multiSelect: !!a.multiSelect,
      editable: kind === 'combo' && !a.readOnly && !!(a as { customValue?: boolean }).customValue,
      align: (['left', 'center', 'right'] as const)[a.textAlignment ?? 0] ?? 'left',
      fontSize: a.defaultAppearanceData?.fontSize || null,
      signed: kind === 'signature' && !!fv,
    });
  }
  return out;
}

const UNICODE_FONT = 'NotoSans-Regular.ttf';

/**
 * Writes form values with pdf-lib. Appearances are regenerated with an embedded Unicode font,
 * so values with Polish (or any non-Latin-1) characters display correctly in every viewer.
 */
export async function applyFormValues(
  doc: PDFDocument,
  values: Record<string, FormValue>,
  opts: { flatten: boolean; fonts: ResourceCache },
) {
  const form = doc.getForm();
  const font = await opts.fonts.font(UNICODE_FONT);
  for (const [name, v] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField) {
      const text = String(v ?? '');
      const max = field.getMaxLength();
      field.setText(max !== undefined ? text.slice(0, max) : text);
    } else if (field instanceof PDFCheckBox) {
      if (v) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (typeof v === 'string' && v) {
        const options = field.getOptions();
        const match = options.find((o) => o === v) ?? options.find((o) => o.trim() === v.trim());
        if (match) field.select(match);
        else selectRadioByOnState(field, v);
      } else field.clear();
    } else if (field instanceof PDFDropdown) {
      const s = Array.isArray(v) ? v[0] : String(v ?? '');
      if (s) field.select(s, true);
      else field.clear();
    } else if (field instanceof PDFOptionList) {
      const arr = (Array.isArray(v) ? v : [String(v)]).filter(Boolean);
      if (arr.length) field.select(arr, false);
      else field.clear();
    }
  }
  // Regenerate appearances for the fields we changed (pdf-lib tracks them as dirty).
  form.updateFieldAppearances(font);
  if (opts.flatten) {
    // Signature fields must never be flattened away.
    const sigs = form.getFields().filter((f) => f instanceof PDFSignature);
    if (sigs.length) {
      for (const f of form.getFields()) if (!(f instanceof PDFSignature)) form.removeField(f);
    } else form.flatten({ updateFieldAppearances: false });
  }
}

/** Radio groups whose widgets use on-state names that differ from /Opt: select by appearance name. */
function selectRadioByOnState(field: PDFRadioGroup, onState: string) {
  const name = PDFName.of(onState);
  field.acroField.setValue(name);
  for (const w of field.acroField.getWidgets()) {
    const on = w.getOnValue();
    w.setAppearanceState(on === name ? name : PDFName.of('Off'));
  }
}
