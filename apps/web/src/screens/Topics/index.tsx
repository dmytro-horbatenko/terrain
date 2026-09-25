import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link } from '@tanstack/react-router';
import {
  useTopics,
  useTopicSearch,
  useRecentNotes,
  useSettings,
  useDeleteTopic,
} from '../../api/hooks';
import {
  Card,
  Modal,
  Loading,
  ErrorBox,
  EmptyState,
  StatusBadge,
  TopicDetailPanel,
  canLeaveTopicPanel,
  useToast,
} from '../../components';
import { TOPIC_STATUSES } from '../../api/types';
import type { TopicSearchMatch, TopicStatus, TopicWithMeta } from '../../api/types';
import { dueLabel, formatDateTime } from '../../lib/format';
import { TopicForm } from './TopicForm';
import './topics.css';

type StatusFilter = 'all' | TopicStatus;

export default function Topics() {
  const { data: topics, isLoading, isError, error } = useTopics();
  const { data: settings } = useSettings();
  const recentNotes = useRecentNotes();
  const del = useDeleteTopic();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const searchResult = useTopicSearch(
    searchQuery,
    domainFilter === 'all' ? undefined : domainFilter,
    statusFilter === 'all' ? undefined : statusFilter,
  );
  const matches = useMemo(
    () => new Map((searchResult.data ?? []).map((match) => [match.id, match])),
    [searchResult.data],
  );

  const all = topics ?? [];

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of all) if (t.domain) set.add(t.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [all]);

  const filtered = useMemo(() => {
    return all.filter((t) => {
      if (search.trim() && (searchQuery !== search.trim() || !matches.has(t.id))) return false;
      if (domainFilter !== 'all' && t.domain !== domainFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      return true;
    });
  }, [all, search, searchQuery, matches, domainFilter, statusFilter]);

  // Group filtered topics by domain, ordered alphabetically; titles sorted within.
  const groups = useMemo(() => {
    const map = new Map<string, TopicWithMeta[]>();
    for (const t of filtered) {
      const key = t.domain || 'Uncategorized';
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([domain, items]) => ({
        domain,
        items: [...items].sort((a, b) => a.title.localeCompare(b.title)),
      }));
  }, [filtered]);

  const multipleDomains = groups.length > 1;

  const handleDelete = (e: MouseEvent, t: TopicWithMeta) => {
    e.stopPropagation();
    if (selectedId === t.id && !canLeaveTopicPanel()) return;
    if (!window.confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
    del.mutate(t.id, {
      onSuccess: () => {
        if (selectedId === t.id) setSelectedId(null);
        toast('Topic deleted', 'success');
      },
      onError: (err) =>
        toast(err instanceof Error ? err.message : 'Failed to delete topic', 'error'),
    });
  };

  const closeCreate = () => setShowCreate(false);

  return (
    <div className="page">
      <div className="row page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Topics
        </h1>
        <button className="btn btn-primary right" onClick={() => setShowCreate(true)}>
          + Add topic
        </button>
      </div>

      {isLoading ? (
        <Loading label="Loading topics…" />
      ) : isError ? (
        <ErrorBox error={error} />
      ) : all.length === 0 ? (
        <EmptyState
          title="No topics yet"
          hint="Add your first topic to start building the roadmap."
          action={
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Add topic
            </button>
          }
        />
      ) : (
        <>
          {!search.trim() && (
            <Card title="Recently edited notes" style={{ marginBottom: 20 }}>
              {recentNotes.isPending ? (
                <Loading label="Loading recent notes…" />
              ) : recentNotes.isError ? (
                <ErrorBox error={recentNotes.error} />
              ) : recentNotes.data.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No saved notes yet. Open a topic to write your first explanation.
                </p>
              ) : (
                <div className="topic-recent-grid">
                  {recentNotes.data.map((note) => (
                    <div key={note.id} className="topic-recent-note">
                      <button
                        className="topic-open-title"
                        onClick={() => {
                          if (selectedId === note.id || canLeaveTopicPanel())
                            setSelectedId(note.id);
                        }}
                        aria-label={`Quick view ${note.title}`}
                      >
                        {note.title}
                      </button>
                      <p className="topic-note-preview muted">{note.excerpt}</p>
                      <div className="row wrap gap-3">
                        <time className="faint" dateTime={note.updatedAt}>
                          {formatDateTime(note.updatedAt, settings?.timezone)}
                        </time>
                        <Link
                          className="topic-page-link"
                          to="/topics/$topicId"
                          params={{ topicId: note.id }}
                          hash="notes"
                          aria-label={`Open notes for ${note.title}`}
                        >
                          Open notes →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {/* Filters */}
          <div className="row wrap gap-3 topic-filters" style={{ marginBottom: 14 }}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={200}
              placeholder="Search titles, notes and summaries…"
              aria-label="Search topics"
            />

            {domains.length > 1 && (
              <select
                className="select"
                style={{ maxWidth: 200 }}
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                aria-label="Filter by domain"
              >
                <option value="all">All domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}

            <div className="seg" role="group" aria-label="Filter by status">
              <button
                className={statusFilter === 'all' ? 'on' : ''}
                onClick={() => setStatusFilter('all')}
              >
                All
              </button>
              {TOPIC_STATUSES.map((s) => (
                <button
                  key={s}
                  className={statusFilter === s ? 'on' : ''}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            <span className="muted right" style={{ alignSelf: 'center' }}>
              {filtered.length} of {all.length}
            </span>
          </div>

          {search.trim() && searchResult.data?.length === 100 && (
            <p className="muted">
              Showing the first 100 matches. Refine your search to narrow them down.
            </p>
          )}

          {/* List */}
          <Card pad={false}>
            {search.trim() && (search.trim() !== searchQuery || searchResult.isPending) ? (
              <Loading label="Searching notes and topics…" />
            ) : search.trim() && searchResult.error ? (
              <ErrorBox error={searchResult.error} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No matching topics" hint="Try clearing the search or filters." />
            ) : (
              groups.map((group) => (
                <div key={group.domain}>
                  {multipleDomains && (
                    <div
                      className="faint mono"
                      style={{
                        padding: '8px 14px',
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        background: 'var(--surface-2)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {group.domain} · {group.items.length}
                    </div>
                  )}
                  {group.items.map((t) => (
                    <TopicRow
                      key={t.id}
                      topic={t}
                      match={search.trim() ? matches.get(t.id) : undefined}
                      timezone={settings?.timezone}
                      onOpen={() => {
                        if (selectedId === t.id || canLeaveTopicPanel()) setSelectedId(t.id);
                      }}
                      onDelete={(e) => handleDelete(e, t)}
                      deleting={del.isPending}
                    />
                  ))}
                </div>
              ))
            )}
          </Card>
        </>
      )}

      {/* Create modal */}
      <Modal open={showCreate} onClose={closeCreate} title="Add topic">
        <TopicForm topics={all} domains={domains} onClose={closeCreate} />
      </Modal>

      {/* Detail drawer */}
      {selectedId && (
        <div
          className="drawer-overlay"
          onMouseDown={() => {
            if (canLeaveTopicPanel()) setSelectedId(null);
          }}
        >
          <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
            <TopicDetailPanel topicId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function TopicRow({
  topic,
  onOpen,
  onDelete,
  deleting,
  timezone,
  match,
}: {
  topic: TopicWithMeta;
  onOpen: () => void;
  onDelete: (e: MouseEvent) => void;
  deleting: boolean;
  timezone?: string;
  match?: TopicSearchMatch;
}) {
  const due = dueLabel(topic.nextReviewAt, timezone);
  return (
    <div className="list-row topic-discovery-row">
      <StatusBadge status={topic.status} labels={topic.labels} />
      <div className="topic-row-content">
        <div className="row wrap gap-3">
          <button
            className="topic-open-title"
            onClick={onOpen}
            aria-label={`Quick view ${topic.title}`}
          >
            {topic.title}
          </button>
          {topic.topicType && <span className="pill">{topic.topicType}</span>}
        </div>
        {match && (
          <div className="topic-search-excerpt">
            <span className="faint">
              {
                {
                  notes: 'Your notes',
                  summary: 'AI summary',
                  description: 'Description',
                  title: 'Title',
                }[match.matchedField]
              }
              {match.matchedField === 'notes' && match.notesUpdatedAt && (
                <> · Edited {formatDateTime(match.notesUpdatedAt, timezone)}</>
              )}
            </span>
            <p>{match.excerpt}</p>
          </div>
        )}
      </div>

      <span className="right row gap-3" style={{ alignItems: 'center' }}>
        <Link
          className="topic-page-link"
          to="/topics/$topicId"
          params={{ topicId: topic.id }}
          hash={match?.matchedField === 'notes' ? 'notes' : undefined}
          aria-label={`Open page for ${topic.title}`}
        >
          Open page →
        </Link>
        <span
          style={{
            fontSize: 12.5,
            color: due.overdue
              ? 'var(--st-blocked)'
              : due.quiet
                ? 'var(--text-faint)'
                : 'var(--text-muted)',
          }}
        >
          {due.text}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${topic.title}`}
          title="Delete topic"
        >
          ✕
        </button>
      </span>
    </div>
  );
}
