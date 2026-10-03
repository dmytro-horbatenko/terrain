import { useEffect, useState } from 'react';
import type { NoteReviewDraft } from '@terrain/types';
import {
  useApplyNoteReview,
  useMe,
  useNoteReviewPreview,
  useSessionImportStatus,
} from '../api/hooks';
import { ErrorBox, Loading } from './Feedback';
import { NoteReviewDiff } from './NoteReviewDiff';
import {
  readPendingReviews,
  removePendingReview,
  storePendingReview,
} from '../screens/Import/noteReviewDraft';

export function NoteReviewPanel({
  draft,
  ready,
  sessionId,
  onDone,
}: {
  draft: NoteReviewDraft;
  ready: boolean;
  sessionId?: string;
  onDone?: () => void;
}) {
  const userId = useMe().data?.id;
  if (!userId) return <Loading />;
  return (
    <OwnedNoteReviewPanel
      key={`${userId}:${JSON.stringify(draft)}`}
      userId={userId}
      draft={draft}
      ready={ready}
      sessionId={sessionId}
      onDone={onDone}
    />
  );
}
function OwnedNoteReviewPanel({
  userId,
  draft,
  ready,
  sessionId: linkedSession,
  onDone,
}: {
  userId: string;
  draft: NoteReviewDraft;
  ready: boolean;
  sessionId?: string;
  onDone?: () => void;
}) {
  const preview = useNoteReviewPreview(draft);
  const [restoredSession] = useState(
    () =>
      readPendingReviews(userId).find(
        (item) => JSON.stringify(item.draft) === JSON.stringify(draft),
      )?.sessionId,
  );
  const sessionId = linkedSession ?? restoredSession;
  const status = useSessionImportStatus(sessionId, !ready);
  const readyToApply = ready || !!status.data?.imported;
  const apply = useApplyNoteReview();
  const [finished, setFinished] = useState<'saved' | 'kept' | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    if (!finished)
      setStorageAvailable(storePendingReview(userId, { draft, ready: readyToApply, sessionId }));
  }, [draft, readyToApply, sessionId, userId, finished]);
  const done = (outcome: 'saved' | 'kept') => {
    removePendingReview(userId, draft.id);
    setFinished(outcome);
    onDone?.();
  };
  if (finished)
    return (
      <p role="status">
        {finished === 'saved'
          ? draft.kind === 'notes'
            ? 'Reviewed notes saved.'
            : 'Reviewed reference saved.'
          : 'Current text kept; proposal dismissed.'}
      </p>
    );
  if (preview.isLoading) return <Loading />;
  if (!preview.data)
    return (
      <ErrorBox
        error={
          preview.error ?? new Error('Unable to load the current note. Your proposal is retained.')
        }
      />
    );
  return (
    <div className="col gap-2">
      {!storageAvailable && (
        <p role="status">
          Draft recovery is unavailable. Copy your proposal before leaving this page.
        </p>
      )}
      {!readyToApply && sessionId && !preview.data.applied && (
        <div className="col gap-2">
          <p role="status">
            {status.isLoading
              ? 'Checking whether the session was saved…'
              : 'The linked session is not confirmed saved yet.'}
          </p>
          {!!status.error && <ErrorBox error={status.error} />}
          <button
            className="btn"
            disabled={status.isFetching}
            onClick={() => {
              void status.refetch();
            }}
          >
            Check session save
          </button>
        </div>
      )}
      <NoteReviewDiff
        draft={draft}
        current={preview.data.current}
        applied={preview.data.applied}
        ready={readyToApply}
        pending={apply.isPending}
        error={apply.error}
        onKeep={() => done(preview.data.applied ? 'saved' : 'kept')}
        onApply={() => apply.mutate(draft, { onSuccess: () => done('saved') })}
      />
    </div>
  );
}

export function PendingNoteReviews({ topicId }: { topicId?: string } = {}) {
  const userId = useMe().data?.id;
  const [version, setVersion] = useState(0);
  const pending = userId
    ? readPendingReviews(userId).filter((item) => !topicId || item.draft.topicId === topicId)
    : [];
  if (!pending.length) return null;
  return (
    <section className="col gap-3" aria-label="Pending note proposals" key={`${userId}:${version}`}>
      <h2>Pending note reviews</h2>
      {pending.map((item) => (
        <NoteReviewPanel
          key={`${userId}:${item.draft.id}`}
          draft={item.draft}
          ready={item.ready}
          sessionId={item.sessionId}
          onDone={() => setVersion((n) => n + 1)}
        />
      ))}
    </section>
  );
}
