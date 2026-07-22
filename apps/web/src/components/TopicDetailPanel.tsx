import { useEffect, useState } from 'react';
import type { SourcePlan } from '@terrain/types';
import { useSettings, useTopic, useUpdateTopic } from '../api/hooks';
import { useToast } from './Toast';
import { StatusBadge } from './StatusBadge';
import { IntervalGrowthChart } from './IntervalGrowthChart';
import { AppEventsPanel } from './AppEventsPanel';
import { PromptsPanel } from './PromptsPanel';
import { TypeAutocomplete } from './TypeAutocomplete';
import { Loading, ErrorBox } from './Feedback';
import {
  TOPIC_STATUSES,
  type SourceEvidenceRecord,
  type TopicRef,
  type TopicStatus,
} from '../api/types';
import { STATUS_META, tint, topicColor } from './status';
import { dueLabel, formatDate, noteRefHref } from '../lib/format';
import { isSourceOptionExpired, safeHttpUrl } from '../screens/Import/sourceProjection';

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
      <span style={{ color: ok ? 'var(--ok)' : 'var(--text-faint)', fontWeight: 700 }}>
        {ok ? '✓' : '○'}
      </span>
      <div className="col">
        <span style={{ fontWeight: 550 }}>{label}</span>
        <span className="faint" style={{ fontSize: 12 }}>
          {detail}
        </span>
      </div>
    </div>
  );
}

function RefChips({ refs, empty }: { refs: TopicRef[]; empty: string }) {
  if (refs.length === 0) return <span className="faint">{empty}</span>;
  return (
    <div className="row wrap gap-2">
      {refs.map((r) => {
        const c = topicColor(r.status);
        return (
          <span
            key={r.id}
            className="pill"
            style={{ background: tint(c), color: c }}
            title={STATUS_META[r.status].label}
          >
            {r.title}
          </span>
        );
      })}
    </div>
  );
}

function LearningSources({
  plan,
  evidence,
}: {
  plan: SourcePlan | null | undefined;
  evidence: SourceEvidenceRecord[];
}) {
  const history = [...evidence].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <div className="col gap-2">
      <div className="card-title" style={{ margin: 0 }}>
        Learning sources
      </div>
      {!plan ? (
        <span className="faint">Source plan missing</span>
      ) : plan.policy === 'none' ? (
        <span className="faint">No intake source — {plan.rationale}</span>
      ) : (
        <div className="col gap-3">
          {plan.requirements.map((requirement) => (
            <div key={requirement.id} className="list-row col gap-1">
              <div className="row wrap gap-2">
                <b>{requirement.purpose}</b>
                <span className="badge">{requirement.requiredWhen.replace('_', ' ')}</span>
              </div>
              {requirement.options.map((option) => (
                <div key={option.id} className="col gap-1" style={{ paddingTop: 6 }}>
                  <div className="row wrap gap-2">
                    {safeHttpUrl(option.url) ? (
                      <a href={option.url} target="_blank" rel="noreferrer">
                        {option.title}
                      </a>
                    ) : (
                      <span>{option.title}</span>
                    )}
                    <span className="pill">
                      {option.format} · ~{option.estimatedMinutes}m
                    </span>
                    {isSourceOptionExpired(option) && <span className="badge">expired</span>}
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Exact scope: {option.scope}
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    Why: {option.why}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {plan.optional?.map((option) => (
            <div key={option.id} className="list-row col gap-1">
              <div className="row wrap gap-2">
                {safeHttpUrl(option.url) ? (
                  <a href={option.url} target="_blank" rel="noreferrer">
                    {option.title}
                  </a>
                ) : (
                  <span>{option.title}</span>
                )}
                <span className="badge">optional</span>
                {isSourceOptionExpired(option) && <span className="badge">expired</span>}
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                Exact scope: {option.scope}
              </span>
              <span className="faint" style={{ fontSize: 12 }}>
                Why: {option.why}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card-title" style={{ margin: '8px 0 0' }}>
        Source evidence history ({history.length})
      </div>
      {history.length === 0 ? (
        <span className="faint">No source evidence stored.</span>
      ) : (
        <div className="col gap-2">
          {history.map((entry, index) => {
            const date = formatDate(entry.createdAt);
            const showDate = index === 0 || date !== formatDate(history[index - 1].createdAt);
            return (
              <div key={entry.id} className="col gap-1">
                {showDate && <b>{date}</b>}
                <div className="list-row col gap-1">
                  <div className="row wrap gap-2">
                    {safeHttpUrl(entry.sourceUrl) ? (
                      <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                        {entry.sourceTitle}
                      </a>
                    ) : (
                      <span>{entry.sourceTitle}</span>
                    )}
                    <span className="pill">requirement {entry.requirementId}</span>
                    {entry.substitutionReason && <span className="badge">substitution</span>}
                  </div>
                  <span style={{ fontSize: 13 }}>{entry.mainClaim}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Mechanism: {entry.supportingMechanism}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Open question: {entry.openQuestion ?? 'none'}
                  </span>
                  {entry.substitutionReason && (
                    <span className="faint" style={{ fontSize: 12 }}>
                      Substitution rationale: {entry.substitutionReason}
                    </span>
                  )}
                  {entry.verifiedLiveAt && entry.verificationNote && (
                    <span className="faint" style={{ fontSize: 12 }}>
                      Live verified {formatDate(entry.verifiedLiveAt)} — {entry.verificationNote}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TopicDetailPanel({ topicId, onClose }: { topicId: string; onClose?: () => void }) {
  const { data: t, isLoading, error } = useTopic(topicId);
  const { data: settings } = useSettings();
  const update = useUpdateTopic();
  const { toast } = useToast();

  const [noteRef, setNoteRef] = useState('');
  const [summary, setSummary] = useState('');
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('');
  const [topicType, setTopicType] = useState('');
  const [description, setDescription] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);

  useEffect(() => {
    if (t) {
      setNoteRef(t.noteRef ?? '');
      setSummary(t.summary ?? '');
      setTitle(t.title);
      setDomain(t.domain);
      setTopicType(t.topicType);
      setDescription(t.description ?? '');
    }
  }, [t?.id]); // re-seed when a different topic loads

  // Keep the read-only summary's save payload in sync with server truth even
  // while the panel stays mounted on the same topic, so a reference-only save
  // never clobbers a freshly session-authored summary. Skip while mid-edit.
  useEffect(() => {
    if (t && !editingSummary) setSummary(t.summary ?? '');
  }, [t?.summary, editingSummary]);

  if (isLoading) return <Loading />;
  if (error || !t) return <ErrorBox error={error ?? 'Topic not found'} />;

  const setStatus = (status: TopicStatus) =>
    update.mutate(
      { id: t.id, input: { status } },
      { onSuccess: () => toast('Status updated', 'success') },
    );

  const saveNotes = () =>
    update.mutate(
      { id: t.id, input: { noteRef: noteRef.trim(), summary: summary.trim() } },
      { onSuccess: () => toast('Saved', 'success') },
    );

  const saveFields = () =>
    update.mutate(
      {
        id: t.id,
        input: {
          title: title.trim(),
          domain: domain.trim(),
          topicType: topicType.trim(),
          description: description.trim(),
        },
      },
      {
        onSuccess: () => toast('Topic updated', 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Update failed', 'error'),
      },
    );

  const due = dueLabel(t.nextReviewAt);
  const noteHref = noteRefHref(t.noteRef, settings?.obsidianVault);

  const cardsTotal = t.prompts.length;
  const cardsNew = t.prompts.filter((p) => p.state === 'new' && !p.suspended).length;
  const cardsDue = t.prompts.filter((p) => {
    if (p.suspended) return false;
    const d = dueLabel(p.nextReviewAt);
    return d.days !== null && d.days <= 0;
  }).length;
  const activeStabilities = t.prompts
    .filter((p) => !p.suspended && p.stability != null)
    .map((p) => p.stability as number);
  const minStability =
    activeStabilities.length > 0 ? Math.round(Math.min(...activeStabilities)) : null;

  return (
    <div className="col gap-4 detail-panel">
      {/* header */}
      <div className="col gap-2">
        <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
          <h2 style={{ fontSize: 19, lineHeight: 1.25 }}>{t.title}</h2>
          {onClose && (
            <button className="btn btn-ghost btn-sm right" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="row wrap gap-2">
          <StatusBadge status={t.status} labels={t.labels} />
          <span className="pill">{t.topicType}</span>
          <span className="pill">{t.domain}</span>
          {t.aiProposed && (
            <span
              className="pill"
              style={{ background: tint('var(--primary)'), color: 'var(--primary)' }}
            >
              ✦ AI-proposed
            </span>
          )}
        </div>
        {t.description && (
          <p className="muted" style={{ margin: 0 }}>
            {t.description}
          </p>
        )}
        {t.aiProposed && t.aiContext && (
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            AI context: {t.aiContext}
          </p>
        )}
      </div>

      {/* editable fields */}
      <div className="col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Edit topic
        </div>
        <input
          className="input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="row gap-3">
          <input
            className="input grow"
            placeholder="Domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <div className="grow">
            <TypeAutocomplete value={topicType} onChange={setTopicType} />
          </div>
        </div>
        <textarea
          className="textarea"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={update.isPending || !title.trim()}
          onClick={saveFields}
        >
          Save changes
        </button>
      </div>

      {/* SR state */}
      <div className="row wrap gap-4 stat-strip">
        <div className="col">
          <span className="faint">Status</span>
          <select
            className="select"
            style={{ width: 150, marginTop: 2 }}
            value={t.status}
            onChange={(e) => setStatus(e.target.value as TopicStatus)}
          >
            {TOPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <div className="col">
          <span className="faint">Next review</span>
          <b style={{ color: due.overdue ? 'var(--danger)' : undefined }}>
            {t.nextReviewAt
              ? `${formatDate(t.nextReviewAt)}${due.text !== 'not scheduled' ? ` (${due.text})` : ''}`
              : '—'}
          </b>
        </div>
        <div className="col">
          <span className="faint">Cards</span>
          <b>
            cards: {cardsTotal} ({cardsDue} due, {cardsNew} new)
          </b>
        </div>
      </div>

      {/* mastery */}
      <div className="card card-pad col gap-3">
        <div className="card-title" style={{ margin: 0 }}>
          Mastery conditions{' '}
          {t.mastery.eligible && <span style={{ color: 'var(--ok)' }}>· eligible ✓</span>}
        </div>
        <Check
          ok={t.mastery.retention}
          label="Retention"
          detail={
            minStability !== null
              ? `all active cards at stability ≥ 30d (min now ${minStability}d)`
              : 'all active cards at stability ≥ 30d'
          }
        />
        <Check
          ok={t.mastery.application}
          label="Application"
          detail={`≥1 application event (have ${t.appEventCount})`}
        />
        <Check
          ok={t.mastery.teaching}
          label="Teaching"
          detail="a written summary or note reference exists"
        />
        {t.mastery.eligible && t.status !== 'mastered' && (
          <button
            className="btn btn-primary btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setStatus('mastered')}
          >
            Mark mastered
          </button>
        )}
      </div>

      {/* application events */}
      <AppEventsPanel topicId={t.id} events={t.appEvents} />

      <LearningSources plan={t.sourcePlan} evidence={t.sourceEvidence ?? []} />

      {/* prompts */}
      <PromptsPanel topicId={t.id} prompts={t.prompts} />

      {/* relations */}
      <div className="grid topic-relations-grid">
        <div className="col gap-1">
          <span className="card-title" style={{ margin: 0 }}>
            Prerequisites
          </span>
          <RefChips refs={t.prerequisites} empty="none" />
        </div>
        <div className="col gap-1">
          <span className="card-title" style={{ margin: 0 }}>
            Unlocks
          </span>
          <RefChips refs={t.dependents} empty="none" />
        </div>
        <div className="col gap-1">
          <span className="card-title" style={{ margin: 0 }}>
            Parent
          </span>
          <RefChips refs={t.parent ? [t.parent] : []} empty="top-level" />
        </div>
        <div className="col gap-1">
          <span className="card-title" style={{ margin: 0 }}>
            Sub-topics
          </span>
          <RefChips refs={t.children} empty="none" />
        </div>
      </div>

      {/* notes */}
      <div className="col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Notes & reference
        </div>
        <input
          className="input"
          placeholder="noteRef — Obsidian/OneNote path or URL"
          value={noteRef}
          onChange={(e) => setNoteRef(e.target.value)}
        />
        {noteHref && (
          <a
            className="faint"
            style={{ fontSize: 12 }}
            href={noteHref}
            target="_blank"
            rel="noreferrer"
          >
            ↗ {noteHref.startsWith('obsidian://') ? 'open in Obsidian' : 'open current reference'}
          </a>
        )}
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={update.isPending}
          onClick={saveNotes}
        >
          Save reference
        </button>
        {/* Summary is authored by Claude sessions (composeSummary on import),
            not hand-typed. Show it read-only; manual edits are an escape hatch. */}
        {t.summary ? (
          <div className="card card-pad" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {t.summary}
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>
            No summary yet — a Claude learning session writes one on import.
          </span>
        )}
        {editingSummary ? (
          <>
            <textarea
              className="textarea"
              placeholder="Manual summary override (teaching condition)"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <div className="row gap-2">
              <button
                className="btn btn-sm"
                disabled={update.isPending}
                onClick={() => {
                  saveNotes();
                  setEditingSummary(false);
                }}
              >
                Save notes
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSummary(t.summary ?? '');
                  setEditingSummary(false);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setEditingSummary(true)}
          >
            Edit manually
          </button>
        )}
      </div>

      {/* review history */}
      <div className="col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Review history ({t.reviews.length})
        </div>
        {t.reviews.length > 1 && (
          <div className="card card-pad">
            <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
              Interval growth (FSRS)
            </div>
            <IntervalGrowthChart reviews={t.reviews} />
          </div>
        )}
        {t.reviews.length === 0 ? (
          <span className="faint">No reviews logged yet.</span>
        ) : (
          <div className="col gap-1 history-list scroll-y" style={{ maxHeight: 160 }}>
            {t.reviews.map((r) => (
              <div key={r.id} className="row history-row">
                <span className="mono" style={{ width: 46 }}>
                  {r.grade}
                </span>
                <span className="faint" style={{ width: 150 }}>
                  {r.intervalBefore != null && r.intervalAfter != null
                    ? `${r.intervalBefore}d → ${r.intervalAfter}d`
                    : '—'}
                </span>
                <span
                  className="faint grow nowrap"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {r.note ?? ''}
                </span>
                <span className="faint right">{formatDate(r.reviewedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
