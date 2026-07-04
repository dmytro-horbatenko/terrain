import { useEffect, useReducer, useState } from 'react';
import { api, type ApiError } from '../../api/client';
import { usePrompt } from '../../api/hooks';
import type { SessionQueueItem } from '../../api/types';
import { ErrorBox, Loading, LogReviewForm, PromptRecall } from '../../components';
import { initialProgress, sessionReducer } from './session';

/** Interleaved cross-topic review session. Fetches the queue once on mount
 *  (deliberately NOT a react-query query: each grade invalidates dashboard
 *  queries, and a cached queue refetching mid-session would shift the
 *  cursor under the user). Every grade persists immediately, so closing
 *  mid-session loses nothing. */
export default function ReviewSession({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SessionQueueItem[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [progress, dispatch] = useReducer(sessionReducer, initialProgress);

  useEffect(() => {
    let alive = true;
    api.getSessionQueue().then(
      (q) => alive && setItems(q.items),
      (e) => alive && setError(e instanceof Error ? e : new Error('Failed to load queue')),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading label="Building your session…" />;

  const item = items[progress.cursor];

  if (!item) {
    return (
      <div className="col gap-3" style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: 40 }} aria-hidden>
          {items.length === 0 ? '🌤️' : '🎉'}
        </div>
        <div className="card-title" style={{ margin: 0 }}>
          {items.length === 0 ? 'Nothing due — all caught up' : 'Session complete'}
        </div>
        {items.length > 0 && (
          <div className="muted">
            {progress.reviewed} card{progress.reviewed === 1 ? '' : 's'} reviewed
            {progress.newStarted > 0 && ` · ${progress.newStarted} new started`}
          </div>
        )}
        <button className="btn btn-primary" style={{ alignSelf: 'center' }} onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="col gap-3">
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="pill nowrap">
          {progress.cursor + 1} / {items.length}
        </span>
        <span className="faint nowrap" style={{ marginLeft: 8 }}>
          {item.chapterTitle}
        </span>
        {item.isNew && (
          <span className="pill nowrap" style={{ marginLeft: 8 }}>
            new
          </span>
        )}
        <button className="btn btn-ghost btn-sm right" onClick={() => dispatch({ type: 'skip' })}>
          Skip
        </button>
      </div>
      <div className="card-title" style={{ margin: 0 }}>
        {item.topicTitle}
      </div>
      <SessionCard
        key={item.promptId}
        item={item}
        onGraded={() => dispatch({ type: 'graded', isNew: item.isNew })}
        onMissing={() => dispatch({ type: 'skip' })}
      />
    </div>
  );
}

function SessionCard({
  item,
  onGraded,
  onMissing,
}: {
  item: SessionQueueItem;
  onGraded: () => void;
  onMissing: () => void;
}) {
  const promptQ = usePrompt(item.promptId);
  const missing = promptQ.isError && (promptQ.error as ApiError).status === 404;

  // Card deleted since the queue was built — skip it silently.
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  if (promptQ.isLoading || missing) return <Loading label="Loading card…" />;
  if (promptQ.isError) return <ErrorBox error={promptQ.error} />;
  if (!promptQ.data) return null;

  return (
    <PromptRecall prompt={promptQ.data.prompt} previewIntervals={promptQ.data.previewIntervals}>
      {(promptId, previewIntervals) => (
        <LogReviewForm
          topic={{ id: item.topicId, title: item.topicTitle }}
          promptId={promptId}
          previewIntervals={previewIntervals}
          onLogged={onGraded}
        />
      )}
    </PromptRecall>
  );
}
