/** Saved signatures, kept only in this browser (IndexedDB). */
import { get, set } from 'idb-keyval';

export interface SavedSignature {
  id: string;
  createdAt: number;
  kind: 'draw' | 'type' | 'upload';
  png: Uint8Array;
  width: number;
  height: number;
}

const KEY = 'signatures.v1';

export async function listSignatures(): Promise<SavedSignature[]> {
  try {
    return ((await get<SavedSignature[]>(KEY)) ?? []).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return []; // private mode / storage blocked
  }
}

export async function saveSignature(s: Omit<SavedSignature, 'id' | 'createdAt'>): Promise<void> {
  try {
    const all = await listSignatures();
    all.unshift({ ...s, id: Math.random().toString(36).slice(2), createdAt: Date.now() });
    await set(KEY, all.slice(0, 12));
  } catch {
    /* storage unavailable: signature still works for this session */
  }
}

export async function deleteSignature(id: string): Promise<void> {
  try {
    await set(KEY, (await listSignatures()).filter((s) => s.id !== id));
  } catch {
    /* ignore */
  }
}
