import { useState } from 'react';
import { useDoc } from '../model/docStore';

/**
 * Encrypted PDFs can carry author restrictions ("no editing", "no comments"…). They are advisory:
 * the app tells the user and lets them decide. Saved files keep the encryption and the flags.
 */
export function RestrictionBanner() {
  const restrictions = useDoc((s) => s.restrictions);
  const bytes = useDoc((s) => s.file?.bytes);
  const [dismissedFor, setDismissedFor] = useState<Uint8Array | null>(null);
  if (!restrictions.length || dismissedFor === bytes) return null;
  return (
    <div className="sig-banner info" role="status" data-testid="restriction-banner">
      <span aria-hidden>🔒</span>
      <span>
        The author of this PDF restricted {restrictions.join(', ')}. You can still make changes; the saved file stays encrypted with the
        same restrictions.
      </span>
      <button className="link-btn" onClick={() => setDismissedFor(bytes ?? null)}>
        OK
      </button>
    </div>
  );
}
