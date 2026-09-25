import { useEffect, useReducer, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import type { TopicNotes as Notes } from '../api/types';
import { useSaveTopicNotes, useTopicNotes } from '../api/hooks';
import { formatDate } from '../lib/format';
import { safeHttpUrl } from '../screens/Import/sourceProjection';
import { ErrorBox, Loading } from './Feedback';

type Draft = { base: Notes; draft: string | null; latest: Notes | null; conflict: boolean };
type Action =
  | { type: 'loaded' | 'saved'; notes: Notes }
  | { type: 'change'; body: string }
  | { type: 'edit' | 'template' | 'cancel' | 'rebase' | 'conflict' };

export function notesDraftReducer(state: Draft, action: Action): Draft {
  switch (action.type) {
    case 'template':
      return (state.draft ?? state.base.body).trim()
        ? state
        : {
            ...state,
            draft:
              '## Question\n\n\n## My explanation\n\n\n## Preconditions & invariants\n\n\n## Example & counterexample\n\n\n## What changed my understanding\n\n\n## Sources & artifact links\n\n\n## Open question\n\n',
          };
    case 'edit':
      return { ...state, draft: state.base.body };
    case 'change':
      return { ...state, draft: action.body };
    case 'loaded':
      if (action.notes.revision <= state.base.revision) return state;
      if (state.draft !== null) return { ...state, latest: action.notes, conflict: true };
      return { base: action.notes, draft: null, latest: null, conflict: false };
    case 'saved':
      return { base: action.notes, draft: null, latest: null, conflict: false };
    case 'conflict':
      return { ...state, conflict: true };
    case 'rebase':
      return state.latest ? { ...state, base: state.latest, latest: null, conflict: false } : state;
    case 'cancel':
      return { base: state.latest ?? state.base, draft: null, latest: null, conflict: false };
  }
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\][\n]+\]\([^()\s]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return link && safeHttpUrl(link[2]) ? (
      <a key={i} href={link[2]} target="_blank" rel="noreferrer">
        {link[1]}
      </a>
    ) : (
      part
    );
  });
}

// Limited Markdown; React escapes all text. Raw HTML is never interpreted.
export function NoteText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      blocks.push(
        <pre key={i} style={{ overflowX: 'auto', whiteSpace: 'pre' }}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <h3 key={i} style={{ fontSize: 15, margin: '8px 0 0' }}>
          {inline(heading[1])}
        </h3>,
      );
      continue;
    }
    const list = /^(?:[-*]|\d+\.)\s+/.test(line);
    if (list) {
      const ordered = /^\d+\./.test(line);
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items: ReactNode[] = [];
      do {
        items.push(<li key={i}>{inline(lines[i].replace(marker, ''))}</li>);
        i++;
      } while (i < lines.length && marker.test(lines[i]));
      blocks.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>);
      i--;
      continue;
    }
    blocks.push(
      <p key={i} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {inline(line)}
      </p>,
    );
  }
  return (
    <div className="col gap-2" style={{ overflowWrap: 'anywhere', fontSize: 13 }}>
      {blocks}
    </div>
  );
}

function downloadDraft(topicId: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `terrain-notes-${topicId}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TopicNotes({ topicId, timezone }: { topicId: string; timezone?: string }) {
  const query = useTopicNotes(topicId);
  if (!query.data)
    return query.error ? <ErrorBox error={query.error} /> : <Loading label="Loading notes…" />;
  return (
    <NotesEditor
      key={topicId}
      topicId={topicId}
      notes={query.data}
      timezone={timezone}
      reload={async () => {
        await query.refetch();
      }}
      loading={query.isFetching}
      reloadError={query.error}
    />
  );
}

function NotesEditor({
  topicId,
  notes,
  timezone,
  reload,
  loading,
  reloadError,
}: {
  topicId: string;
  notes: Notes;
  timezone?: string;
  reload: () => Promise<void>;
  loading: boolean;
  reloadError: Error | null;
}) {
  const [state, dispatch] = useReducer(notesDraftReducer, {
    base: notes,
    draft: null,
    latest: null,
    conflict: false,
  });
  const save = useSaveTopicNotes(topicId);
  useEffect(() => {
    dispatch({ type: 'loaded', notes });
  }, [notes]);
  const dirty = state.draft !== null && state.draft !== state.base.body;
  useBlocker({
    shouldBlockFn: () =>
      (dirty || save.isPending) &&
      !window.confirm(
        'Your notes have unsaved work. Save or download your draft before leaving. Leave anyway?',
      ),
    enableBeforeUnload: dirty || save.isPending,
  });
  const body = state.draft ?? state.base.body;
  return (
    <section className="card card-pad col gap-2" aria-label="Your notes">
      <div className="row wrap gap-2">
        <h3 style={{ fontSize: 16 }}>Your notes</h3>
        <span className="faint" style={{ fontSize: 12 }}>
          {state.base.updatedAt
            ? `Saved ${formatDate(state.base.updatedAt, undefined, timezone)}`
            : 'Not saved yet'}
        </span>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
        Your full notes live in Terrain across devices. Learning imports update the session summary
        below and leave these notes alone.
      </p>
      {state.draft === null ? (
        <>
          {body ? (
            <NoteText text={body} />
          ) : (
            <p className="muted">
              Write your explanation, examples, questions and next steps here.
            </p>
          )}
          <div className="row wrap gap-2">
            <button
              className="btn btn-sm"
              onClick={() => {
                save.reset();
                dispatch({ type: 'edit' });
              }}
            >
              Edit notes
            </button>
            {!body.trim() && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  save.reset();
                  dispatch({ type: 'template' });
                }}
              >
                Start with a template
              </button>
            )}
            {body && (
              <button className="btn btn-ghost btn-sm" onClick={() => downloadDraft(topicId, body)}>
                Download notes
              </button>
            )}
          </div>
        </>
      ) : (
        <form
          className="col gap-2"
          data-notes-dirty={dirty || save.isPending ? true : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (state.conflict || save.isPending) return;
            save.mutate(
              { body, revision: state.base.revision },
              {
                onSuccess: (saved) => dispatch({ type: 'saved', notes: saved }),
                onError: (error) => {
                  if ('status' in error && error.status === 409) {
                    dispatch({ type: 'conflict' });
                    void reload();
                  }
                },
              },
            );
          }}
        >
          <label htmlFor={`notes-${topicId}`}>Your explanation</label>
          <textarea
            id={`notes-${topicId}`}
            className="textarea"
            rows={16}
            maxLength={100_000}
            value={body}
            disabled={save.isPending}
            onChange={(event) => dispatch({ type: 'change', body: event.target.value })}
          />
          <span className="faint" style={{ fontSize: 12 }}>
            Headings, lists, bold text, code fences and web links are supported.{' '}
            {body.length.toLocaleString()} / 100,000 characters.
          </span>
          {state.conflict && (
            <div className="card card-pad col gap-2" role="alert">
              <b>These notes changed on another device. Your draft is preserved.</b>
              <p>
                Compare the latest saved notes below. Merge any changes into your draft before
                saving.
              </p>
              {state.latest ? (
                <>
                  <details open>
                    <summary>Latest saved notes</summary>
                    <NoteText text={state.latest.body || '(Empty notes)'} />
                  </details>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      save.reset();
                      dispatch({ type: 'rebase' });
                    }}
                  >
                    I reviewed the latest notes — keep my draft
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={loading}
                  onClick={() => void reload()}
                >
                  Load latest saved notes
                </button>
              )}
            </div>
          )}
          {save.error && !state.conflict && <ErrorBox error={save.error} />}
          {reloadError && <ErrorBox error={reloadError} />}
          <div className="row wrap gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={save.isPending || state.conflict || !dirty}
            >
              {save.isPending ? 'Saving…' : 'Save notes'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm(
                    'Discard your unsaved notes? Download the draft first if you want to keep it.',
                  )
                ) {
                  save.reset();
                  dispatch({ type: 'cancel' });
                }
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => downloadDraft(topicId, body)}
            >
              Download draft
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
