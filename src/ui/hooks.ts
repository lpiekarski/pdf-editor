import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Desktop layout from 900px wide; below that the phone layout (bottom bar + sheets). */
export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');
