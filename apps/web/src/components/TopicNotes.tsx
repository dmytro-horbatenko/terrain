import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import type { TopicNotes as Notes } from '../api/types';
import { useMe, useSaveTopicNotes, useTopicNotes } from '../api/hooks';
import { formatDate } from '../lib/format';
import { safeHttpUrl } from '../screens/Import/sourceProjection';
import { ErrorBox, Loading } from './Feedback';
import './TopicNotes.css';

type View = 'read' | 'edit' | 'preview';
type Draft = {
  base: Notes;
  draft: string | null;
  latest: Notes | null;
  conflict: boolean;
  view: View;
};
type Action =
  | { type: 'loaded' | 'saved'; notes: Notes }
  | { type: 'change'; body: string }
  | { type: 'view'; view: View }
  | { type: 'template' | 'cancel' | 'rebase' | 'conflict' };

const emptyDraft = (base: Notes): Draft => ({
  base,
  draft: null,
  latest: null,
  conflict: false,
  view: 'read',
});
const isDirty = (state: Draft) => state.draft !== null && state.draft !== state.base.body;
const draftKey = (accountId: string, topicId: string) =>
  `terrain:notes-draft:${JSON.stringify([accountId, topicId])}`;

export function loadNotesDraft(accountId: string, topicId: string, notes: Notes) {
  const result = { state: emptyDraft(notes), recovered: false, storageAvailable: true };
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(draftKey(accountId, topicId));
  } catch {
    return { ...result, storageAvailable: false };
  }
  if (!raw) return result;
  try {
    const stored = JSON.parse(raw);
    if (
      stored?.version !== 1 ||
      typeof stored.draft !== 'string' ||
      stored.draft.length > 100_000 ||
      typeof stored.base?.body !== 'string' ||
      stored.base.body.length > 100_000 ||
      !Number.isSafeInteger(stored.base.revision) ||
      stored.base.revision < 0 ||
      !(stored.base.updatedAt === null || typeof stored.base.updatedAt === 'string') ||
      typeof stored.conflict !== 'boolean' ||
      stored.draft === notes.body
    )
      return result;
    const changed = stored.base.revision !== notes.revision || stored.base.body !== notes.body;
    return {
      state: {
        base: stored.base as Notes,
        draft: stored.draft as string,
        latest: changed ? notes : null,
        conflict: changed || stored.conflict,
        view: 'edit' as const,
      },
      recovered: true,
      storageAvailable: true,
    };
  } catch {
    return result;
  }
}

export function persistNotesDraft(accountId: string, topicId: string, state: Draft): boolean {
  try {
    if (isDirty(state) || state.conflict) {
      sessionStorage.setItem(
        draftKey(accountId, topicId),
        JSON.stringify({
          version: 1,
          base: state.base,
          draft: state.draft,
          conflict: state.conflict,
        }),
      );
    } else {
      sessionStorage.removeItem(draftKey(accountId, topicId));
    }
    return true;
  } catch {
    return false;
  }
}

export function notesDraftReducer(state: Draft, action: Action): Draft {
  switch (action.type) {
    case 'template':
      return (state.draft ?? state.base.body).trim()
        ? state
        : {
            ...state,
            view: 'edit',
            draft:
              '## Question\n\n\n## My explanation\n\n\n## Preconditions & invariants\n\n\n## Example & counterexample\n\n\n## What changed my understanding\n\n\n## Sources & artifact links\n\n\n## Open question\n\n',
          };
    case 'view':
      return {
        ...state,
        view: action.view,
        draft: action.view === 'edit' ? (state.draft ?? state.base.body) : state.draft,
      };
    case 'change':
      return { ...state, draft: action.body };
    case 'loaded':
      if (action.notes.revision <= state.base.revision) return state;
      if (isDirty(state) || state.conflict)
        return { ...state, latest: action.notes, conflict: true };
      return {
        ...state,
        base: action.notes,
        draft: state.draft === null ? null : action.notes.body,
        latest: null,
        conflict: false,
      };
    case 'saved':
      return emptyDraft(action.notes);
    case 'conflict':
      return { ...state, conflict: true };
    case 'rebase':
      return state.latest ? { ...state, base: state.latest, latest: null, conflict: false } : state;
    case 'cancel':
      return emptyDraft(state.latest ?? state.base);
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
        <pre key={i}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Heading = `h${Math.min(heading[1].length + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Heading key={i}>{inline(heading[2])}</Heading>);
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
    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(?:```|#{1,6}\s|[-*]\s|\d+\.\s)/.test(lines[i + 1])
    )
      paragraph.push(lines[++i]);
    blocks.push(<p key={i}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="note-prose">{blocks}</div>;
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
  const me = useMe();
  const query = useTopicNotes(topicId);
  if (!me.data)
    return me.error ? <ErrorBox error={me.error} /> : <Loading label="Loading notes…" />;
  if (!query.data)
    return query.error ? <ErrorBox error={query.error} /> : <Loading label="Loading notes…" />;
  return (
    <NotesEditor
      key={JSON.stringify([me.data.id, topicId])}
      accountId={me.data.id}
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
  accountId,
  topicId,
  notes,
  timezone,
  reload,
  loading,
  reloadError,
}: {
  accountId: string;
  topicId: string;
  notes: Notes;
  timezone?: string;
  reload: () => Promise<void>;
  loading: boolean;
  reloadError: Error | null;
}) {
  const [recovery] = useState(() => loadNotesDraft(accountId, topicId, notes));
  const [recovered, setRecovered] = useState(recovery.recovered);
  const [state, dispatch] = useReducer(notesDraftReducer, recovery.state);
  const [storageAvailable, setStorageAvailable] = useState(recovery.storageAvailable);
  const save = useSaveTopicNotes(topicId);
  useEffect(() => {
    dispatch({ type: 'loaded', notes });
  }, [notes]);
  useEffect(() => {
    setStorageAvailable(persistNotesDraft(accountId, topicId, state));
  }, [accountId, topicId, state.base, state.draft, state.conflict]);
  const dirty = isDirty(state);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      (current.pathname !== next.pathname ||
        JSON.stringify(current.search) !== JSON.stringify(next.search)) &&
      (dirty || save.isPending) &&
      !window.confirm(
        'Your notes have unsaved work. Save or download your draft before leaving. Leave anyway?',
      ),
    enableBeforeUnload: dirty || save.isPending,
  });
  const body = state.draft ?? state.base.body;
  const submit = () => {
    if (!dirty || state.conflict || save.isPending) return;
    save.mutate(
      { body, revision: state.base.revision },
      {
        onSuccess: (saved) => {
          setRecovered(false);
          dispatch({ type: 'saved', notes: saved });
        },
        onError: (error) => {
          if ('status' in error && error.status === 409) {
            dispatch({ type: 'conflict' });
            void reload();
          }
        },
      },
    );
  };
  return (
    <section
      className="card card-pad col gap-4 topic-notes"
      aria-label="Your notes"
      data-notes-dirty={dirty || save.isPending ? true : undefined}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.altKey) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="row wrap gap-2">
        <h2 className="notes-title">Your notes</h2>
        <span className="notes-status muted" role="status">
          {save.isPending
            ? 'Saving…'
            : state.conflict
              ? 'Review needed · draft preserved'
              : dirty
                ? 'Unsaved changes'
                : state.base.updatedAt
                  ? 'All changes saved'
                  : 'No notes saved yet'}
        </span>
      </div>
      <p className="notes-help muted">
        Your full notes sync across devices when you save. Learning imports update the session
        summary separately.
      </p>
      <div className="row wrap gap-2 notes-toolbar" role="group" aria-label="Notes view">
        {(['read', 'edit', 'preview'] as const).map((view) => (
          <button
            key={view}
            type="button"
            className={`btn${state.view === view ? ' notes-view-active' : ' btn-ghost'}`}
            aria-pressed={state.view === view}
            onClick={() => dispatch({ type: 'view', view })}
          >
            {view === 'read' ? 'Read' : view === 'edit' ? 'Edit' : 'Preview'}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-primary notes-save"
          disabled={save.isPending || state.conflict || !dirty}
          onClick={submit}
        >
          {save.isPending ? 'Saving…' : 'Save notes'}
        </button>
      </div>
      {recovered && state.draft !== null && (
        <p className="notes-notice" role="status">
          Recovered your unsaved draft from this tab. Review it and save when ready.
        </p>
      )}
      {!storageAvailable && (
        <p className="notes-notice" role="alert">
          Tab draft recovery is unavailable. Keep this page open and save or download your draft
          before leaving.
        </p>
      )}
      {state.view === 'read' && dirty && (
        <p className="notes-help muted">
          Reading the saved version. Your unsaved draft is kept in Edit and Preview.
        </p>
      )}
      <div className="notes-writing" hidden={state.view !== 'edit'}>
        <label htmlFor={`notes-${topicId}`}>Your explanation</label>
        <textarea
          id={`notes-${topicId}`}
          className="textarea notes-textarea"
          rows={22}
          maxLength={100_000}
          value={body}
          disabled={save.isPending}
          onChange={(event) => dispatch({ type: 'change', body: event.target.value })}
        />
        <p className="notes-help muted">
          Headings, lists, bold text, code fences and web links are supported.{' '}
          {body.length.toLocaleString()} / 100,000 characters. Ctrl/Cmd + S to save.
        </p>
      </div>
      {state.view !== 'edit' && (
        <div className="notes-reading">
          {(state.view === 'read' ? (state.latest ?? state.base).body : body) ? (
            <NoteText text={state.view === 'read' ? (state.latest ?? state.base).body : body} />
          ) : (
            <p className="muted">
              Write your explanation, examples, questions and next steps here.
            </p>
          )}
        </div>
      )}
      {state.conflict && (
        <div className="card card-pad col gap-2" role="alert">
          <b>These notes changed on another device. Your draft is preserved.</b>
          <p>
            Compare the latest saved notes below. Merge any changes into your draft before saving.
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
      <div className="notes-footer col gap-2">
        <span className="notes-help muted">
          {dirty && storageAvailable
            ? 'Draft kept in this tab · save or download before closing'
            : state.base.updatedAt
              ? `Last saved ${formatDate(state.base.updatedAt, undefined, timezone)}`
              : 'No notes saved yet'}
        </span>
        <div className="row wrap gap-2">
          {!body.trim() && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                save.reset();
                dispatch({ type: 'template' });
              }}
            >
              Start with a template
            </button>
          )}
          {state.draft !== null && (
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
                  setRecovered(false);
                  dispatch({ type: 'cancel' });
                }
              }}
            >
              Discard draft
            </button>
          )}
          {(body || state.draft !== null) && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => downloadDraft(topicId, body)}
            >
              {state.draft !== null ? 'Download draft' : 'Download notes'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
