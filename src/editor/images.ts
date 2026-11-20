import { useEditor } from '../model/editorStore';
import { useDoc } from '../model/docStore';
import { useView } from '../model/viewStore';
import { newId, type ImageObject, type StoredImage } from '../model/types';
import { viewSize } from '../viewer/coords';

/** Decodes any browser-supported image; PNG/JPEG are kept as-is, anything else is converted to PNG. */
export async function importImage(file: Blob): Promise<StoredImage> {
  const bitmap = await createImageBitmap(file);
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime: StoredImage['mime'];
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    mime = file.type;
  } else {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = 'image/png';
  }
  const img = useEditor.getState().addImage({ bytes, mime, width: bitmap.width, height: bitmap.height });
  bitmap.close();
  return img;
}

/** Places an image centred on the current page, at most `maxWidth` wide. Returns the new object. */
export function placeImage(img: StoredImage, opts: { maxWidth?: number; signature?: boolean; page?: number } = {}): ImageObject {
  const pages = useDoc.getState().pages;
  const page = opts.page ?? useView.getState().currentPage;
  const size = viewSize(pages[page], 1);
  const maxW = Math.min(opts.maxWidth ?? 220, size.width * 0.8);
  const scale = Math.min(maxW / img.width, (size.height * 0.5) / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const obj: ImageObject = {
    id: newId(),
    kind: 'image',
    page,
    imageId: img.id,
    rect: { x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h },
    rotation: 0,
    opacity: 1,
    signature: opts.signature,
  };
  const st = useEditor.getState();
  st.add(obj);
  st.select([obj.id]);
  useEditor.setState({ tool: 'select' });
  return obj;
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
