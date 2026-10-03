import type { NoteReviewDraft, TopicWriting, NoteReviewResult } from '@terrain/types';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorBox } from './Feedback';
export type NoteReviewDiffProps = {
  draft: NoteReviewDraft;
  current: TopicWriting;
  ready: boolean;
  pending: boolean;
  onApply: () => void;
  onKeep: () => void;
  error?: unknown;
  applied?: NoteReviewResult | null;
};
export function NoteReviewDiff({
  draft,
  current,
  ready,
  pending,
  onApply,
  onKeep,
  error,
  applied,
}: NoteReviewDiffProps) {
  const stale = current.revision !== draft.baseRevision || current.sha256 !== draft.baseSha256;
  const [copied, setCopied] = useState(false);
  return (
    <section className="card card-pad col gap-3 note-review-panel" aria-label="AI note review">
      <h2 style={{ margin: 0 }}>
        AI proposal for {draft.kind === 'notes' ? 'your notes' : 'the reference'}
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        {draft.reason}
      </p>
      <small className="faint">
        Saved version {current.revision} · Proposal based on version {draft.baseRevision}
      </small>
      {!!applied && (
        <p role="status">
          This proposal was already saved as version {applied.revision}. The latest saved text is
          kept.
        </p>
      )}
      {!ready && !applied && (
        <p role="status">Save the session record first. This note proposal stays pending.</p>
      )}
      {stale && !applied && (
        <p role="status">
          Newer text is saved.{' '}
          {draft.kind === 'notes'
            ? 'Copy the proposal and merge it in the notes editor, or request a fresh review.'
            : 'Request a fresh review of the latest reference.'}
        </p>
      )}
      {current.body === draft.body ? (
        <p>No text changes. Applying records this review without changing the text version.</p>
      ) : (
        <div className="note-review-comparison">
          <section>
            <h3>Currently saved</h3>
            <pre className="note-review-text">{current.body || 'No note yet'}</pre>
          </section>
          <section>
            <h3>Proposed by AI</h3>
            <pre className="note-review-text">{draft.body || 'Empty note'}</pre>
          </section>
        </div>
      )}
      {draft.sourcesChecked.length > 0 && (
        <details>
          <summary>Sources the AI reports checking</summary>
          <ul>
            {draft.sourcesChecked.map((source, i) => (
              <li key={i}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.scope}
                </a>{' '}
                · {source.checkedAt.slice(0, 10)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!error && <ErrorBox error={error} />}
      <div className="row wrap gap-2">
        {applied ? (
          <button className="btn" onClick={onKeep}>
            Dismiss saved proposal
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={!ready || stale || pending}
              onClick={onApply}
            >
              {pending
                ? 'Saving…'
                : draft.kind === 'notes'
                  ? 'Apply reviewed notes'
                  : 'Apply reference review'}
            </button>
            <button className="btn" disabled={pending} onClick={onKeep}>
              Keep current text
            </button>
            {stale && (
              <>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft.body);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? 'Proposal copied' : 'Copy proposal'}
                </button>
                <Link
                  to="/topics/$topicId"
                  params={{ topicId: draft.topicId }}
                  hash={draft.kind === 'notes' ? 'notes' : 'reference'}
                  className="btn"
                >
                  {draft.kind === 'notes' ? 'Open notes editor' : 'Open reference'}
                </Link>
              </>
            )}
          </>
        )}
      </div>
      <small className="faint">
        This checks the text. It records no recall grade or proof of independent skill.
      </small>
    </section>
  );
}
