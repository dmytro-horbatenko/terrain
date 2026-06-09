import { sm2, type SRState } from '@terrain/sr-engine';

export interface SrBearing {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: string | null;
}

export function srStateOf(t: SrBearing): SRState {
  return {
    easeFactor: t.easeFactor,
    interval: t.interval,
    repetitions: t.repetitions,
    nextReviewAt: t.nextReviewAt ? new Date(t.nextReviewAt) : null,
  };
}

/** Pure client-side SM-2 projection — mirrors what the server will persist. */
export function previewReview(t: SrBearing, quality: number, now: Date = new Date()): SRState {
  return sm2(quality, srStateOf(t), now);
}
