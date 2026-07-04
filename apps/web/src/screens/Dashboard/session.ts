/** Pure cursor/counters state for a review session. The queue itself is
 *  fetched once at session start and never mutated; `cursor` walks it.
 *  "Done" is derived by the component as `cursor >= items.length`. */

export interface SessionProgress {
  cursor: number;
  reviewed: number;
  newStarted: number;
}

export const initialProgress: SessionProgress = { cursor: 0, reviewed: 0, newStarted: 0 };

export type SessionAction = { type: 'graded'; isNew: boolean } | { type: 'skip' };

export function sessionReducer(s: SessionProgress, a: SessionAction): SessionProgress {
  switch (a.type) {
    case 'graded':
      return {
        cursor: s.cursor + 1,
        reviewed: s.reviewed + 1,
        newStarted: s.newStarted + (a.isNew ? 1 : 0),
      };
    case 'skip':
      return { ...s, cursor: s.cursor + 1 };
  }
}
