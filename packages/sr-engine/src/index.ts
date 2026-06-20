import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface CardSrState {
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
}

export const INITIAL_CARD_STATE: CardSrState = {
  stability: null,
  difficulty: null,
  reps: 0,
  lapses: 0,
  state: 'new',
  lastReviewedAt: null,
  nextReviewAt: null,
};

const RATING: Record<Grade, Rating.Again | Rating.Hard | Rating.Good | Rating.Easy> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const STATE_TO_DB: Record<State, CardSrState['state']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const engine = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9 }));

function toFsrsCard(s: CardSrState, now: Date): Card {
  if (s.state === 'new' && s.reps === 0) return createEmptyCard(now);
  const last = s.lastReviewedAt ?? now;
  const due = s.nextReviewAt ?? now;
  return {
    ...createEmptyCard(last),
    due,
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    elapsed_days: Math.max(0, Math.round((now.getTime() - last.getTime()) / 86_400_000)),
    scheduled_days: Math.max(0, Math.round((due.getTime() - last.getTime()) / 86_400_000)),
    reps: s.reps,
    lapses: s.lapses,
    // CardSrState doesn't persist ts-fsrs's internal `learning_steps` ladder
    // position (New/Learning/Relearning short-term minute-scale steps), so
    // it can't be reconstructed faithfully. Rebuilding with the DB-derived
    // state (State.Learning/State.Relearning) and a reset learning_steps=0
    // makes the scheduler re-run the ladder from its first rung on every
    // call, which can never graduate a card out of Learning on repeated
    // 'good' grades. Instead, treat any already-reviewed card (reps > 0) as
    // State.Review: it drives ts-fsrs's day-scale review formula, which
    // still transitions to Relearning (and increments lapses) on 'again' —
    // matching this app's day-granularity review model with no hidden
    // per-card ladder state to lose.
    state: State.Review,
    last_review: s.lastReviewedAt ?? undefined,
  };
}

function fromFsrsCard(card: Card, now: Date): CardSrState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_DB[card.state],
    lastReviewedAt: now,
    nextReviewAt: card.due,
  };
}

export function applyGrade(state: CardSrState, grade: Grade, now: Date): CardSrState {
  const next = engine.next(toFsrsCard(state, now), now, RATING[grade]);
  return fromFsrsCard(next.card, now);
}

export function previewIntervals(state: CardSrState, now: Date): Record<Grade, number> {
  const card = toFsrsCard(state, now);
  const days = (g: Grade) =>
    Math.max(
      0,
      Math.round(
        (engine.next(card, now, RATING[g]).card.due.getTime() - now.getTime()) / 86_400_000,
      ),
    );
  return { again: days('again'), hard: days('hard'), good: days('good'), easy: days('easy') };
}
