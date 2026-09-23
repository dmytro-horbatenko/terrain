import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMe } from '../api/hooks';
import type { Dashboard, SessionQueue } from '../api/types';

const choices = new Map<string, string>();
const storageKey = (userId: string) => `terrain:review-continue:${userId}`;

export function hasContinuedToday(userId: string, dayKey: string): boolean {
  if (choices.get(userId) === dayKey) return true;
  try {
    return localStorage.getItem(storageKey(userId)) === dayKey;
  } catch {
    return false;
  }
}

export function rememberContinueToday(userId: string, dayKey: string) {
  choices.set(userId, dayKey);
  try {
    localStorage.setItem(storageKey(userId), dayKey);
  } catch {
    /* The explicit choice still works for this visit. */
  }
}

export function useReviewChoice(dash: Dashboard | undefined) {
  const me = useMe();
  const [, setRevision] = useState(0);
  const userId = me.data?.id;
  const dayKey = dash?.reviewDay.dayKey;
  const continued = !!userId && !!dayKey && hasContinuedToday(userId, dayKey);
  return {
    reviewFirst:
      !!dash && dash.reviewQueue.backlogCount > 0 && !dash.reviewDay.completed && !continued,
    continueToday: () => {
      if (!userId || !dayKey) return;
      rememberContinueToday(userId, dayKey);
      setRevision((n) => n + 1);
    },
  };
}

export function ReviewFirst({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="col gap-2">
      <p className="muted" style={{ margin: 0 }}>
        Review first, then study. You can also choose to continue today.
      </p>
      <div className="row wrap gap-2">
        <Link to="/session/$mode" params={{ mode: 'repeat' }} className="btn btn-primary">
          Review today's slice
        </Link>
        <button className="btn btn-ghost" onClick={onContinue}>
          Continue today
        </button>
      </div>
    </div>
  );
}

export function ReviewPlan({ queue }: { queue: SessionQueue }) {
  const [exercise, setExercise] = useState('');
  return (
    <div className="col gap-2">
      <b>
        Today's slice: {queue.items.length} cards · ~{queue.estimatedMinutes} min
      </b>
      {queue.items.some((card) => card.isNew) && (
        <span className="muted">
          Includes {queue.items.filter((card) => card.isNew).length} first reviews of studied
          topics.
        </span>
      )}
      <span className="faint">
        Full backlog: {queue.backlogCount} cards · ~{queue.backlogMinutes} min
      </span>
      {queue.items.length > 0 && (
        <details>
          <summary>See selected cards</summary>
          <ul>
            {queue.items.map((card) => (
              <li key={card.promptId}>
                {card.topicTitle}: {card.promptText} · ~{card.estimatedMinutes} min
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row wrap gap-2" aria-label="Review time budget">
        {([15, 20] as const).map((reviewMinutes) => (
          <Link
            key={reviewMinutes}
            to="/session/$mode"
            params={{ mode: 'repeat' }}
            search={{ reviewMinutes }}
            className="btn btn-sm"
            aria-current={queue.budgetMinutes === reviewMinutes ? 'true' : undefined}
          >
            {reviewMinutes} minutes
          </Link>
        ))}
      </div>
      {queue.deferredExercises.length > 0 && (
        <>
          <label className="col gap-1">
            Focused exercises
            <select
              className="input"
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
            >
              <option value="">Choose a separate review</option>
              {queue.deferredExercises.map((card) => (
                <option key={card.promptId} value={card.promptId}>
                  {card.topicTitle}: {card.promptText} · ~{card.estimatedMinutes} min
                </option>
              ))}
            </select>
          </label>
          {exercise && (
            <Link
              to="/session/$mode"
              params={{ mode: 'repeat' }}
              search={{ reviewPromptId: exercise }}
              className="btn"
            >
              Review this exercise
            </Link>
          )}
        </>
      )}
      {queue.items.length === 0 && queue.backlogCount > 0 && (
        <span className="muted">
          The remaining work needs a focused session. Choose an exercise or continue today.
        </span>
      )}
    </div>
  );
}
