import type { PendingSession } from '../../api/types';

/**
 * Which wizard step to open on entry. `pendingSessions` is already scoped
 * server-side to the un-imported, <48h, latest-per-mode set, so presence of a
 * matching mode means "a session is in flight" → resume at the paste step.
 */
export function initialStep(pending: PendingSession[], mode: string): 'copy' | 'paste' {
  return pending.some((s) => s.mode === mode) ? 'paste' : 'copy';
}
