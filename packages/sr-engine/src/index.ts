export interface SRState {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date | null;
}

export const INITIAL_SR_STATE: SRState = {
  easeFactor: 2.5,
  interval: 0,
  repetitions: 0,
  nextReviewAt: null,
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function sm2(quality: number, state: SRState, now: Date): SRState {
  if (quality < 3) {
    return { ...state, repetitions: 0, interval: 1, nextReviewAt: addDays(now, 1) };
  }
  const easeFactor = Math.max(
    1.3,
    state.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );
  const interval =
    state.repetitions === 0
      ? 1
      : state.repetitions === 1
        ? 6
        : Math.round(state.interval * easeFactor);
  return {
    easeFactor,
    interval,
    repetitions: state.repetitions + 1,
    nextReviewAt: addDays(now, interval),
  };
}

export function shouldEscalate(
  reviews: { quality: number; reviewedAt: Date }[],
  now: Date,
): boolean {
  const cutoff = addDays(now, -7).getTime();
  const recentPoor = reviews.filter((r) => r.quality <= 2 && r.reviewedAt.getTime() >= cutoff);
  return recentPoor.length >= 3;
}
