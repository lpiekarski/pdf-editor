import { create } from 'zustand';
import { useDoc } from '../../model/docStore';
import { analyzeSignatures, type DocSignatures, type SignatureInfo } from './analyze';

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

/** Re-analyse whenever a different file is opened. */
useDoc.subscribe(async (s, prev) => {
  if (s.file?.bytes === prev.file?.bytes) return;
  const bytes = s.file?.bytes ?? null;
  useSignatures.setState({ loading: !!bytes, forBytes: bytes, signatures: undefined, docMdp: undefined, hasDss: undefined });
  if (!bytes) return;
  const result = await analyzeSignatures(bytes).catch(() => ({ signatures: [], docMdp: null, hasDss: false }));
  if (useSignatures.getState().forBytes === bytes) useSignatures.setState({ ...result, loading: false });
});
