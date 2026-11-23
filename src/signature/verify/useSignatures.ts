import { create } from 'zustand';
import { useDoc } from '../../model/docStore';
import { analyzeSignatures, isFieldLocked, type DocSignatures, type SignatureInfo } from './analyze';

export type Status = 'valid' | 'warning' | 'invalid' | 'unknown';

/** One-word verdict per signature, used for badges, banner and cards. */
export function statusOf(s: SignatureInfo): Status {
  if (s.integrity === 'mismatch' || s.integrity === 'malformed' || s.signatureValid === false) return 'invalid';
  if (s.integrity === 'unknown' || s.signatureValid === null) return 'unknown';
  if (!s.coversWholeFile && !s.changesAllowed) return 'warning';
  return 'valid';
}

interface SigState extends Partial<DocSignatures> {
  loading: boolean;
  forBytes: Uint8Array | null;
}

export const useSignatures = create<SigState>(() => ({ loading: false, forBytes: null }));

/** Name of the signer whose FieldMDP lock covers this form field, or null when it is editable. */
export function lockedBy(signatures: SignatureInfo[] | undefined, field: string): string | null {
  const s = signatures?.find((x) => isFieldLocked(x.fieldLock, field));
  return s ? (s.signerName ?? 'a signer') : null;
}

/** Re-analyse whenever a different file is opened. */
useDoc.subscribe(async (s, prev) => {
  if (s.file?.bytes === prev.file?.bytes) return;
  const bytes = s.file?.bytes ?? null;
  useSignatures.setState({ loading: !!bytes, forBytes: bytes, signatures: undefined, docMdp: undefined, hasDss: undefined });
  if (!bytes) return;
  const result = await analyzeSignatures(bytes, s.file?.password ?? '').catch(() => ({ signatures: [], docMdp: null, hasDss: false }));
  if (useSignatures.getState().forBytes === bytes) useSignatures.setState({ ...result, loading: false });
});
