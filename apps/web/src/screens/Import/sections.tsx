import type { ReactNode } from 'react';
import { Card, GRADES, tint, useToast } from '../../components';
import { formatDate } from '../../lib/format';
import type {
  Grade,
  ImportPlan,
  NewPromptPlan,
  NewTopicPlan,
  NoteSummaryPlan,
  ResolvedReview,
  Unresolved,
} from '../../api/types';

/** Grade chip in the app's GradePicker colors (again/hard/good/easy). */
function GradeBadge({ grade }: { grade: Grade }) {
  const meta = GRADES.find((g) => g.grade === grade);
  const color = meta?.color ?? 'var(--text-muted)';
  return (
    <span className="badge mono" style={{ color, background: tint(color, 14), borderColor: color }}>
      {meta?.label ?? grade}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="pill" style={{ fontSize: 12 }}>
      {children}
    </span>
  );
}

function SectionShell({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card
      title={
        <span className="row gap-2">
          {title}
          <span className="badge mono">{count}</span>
        </span>
      }
    >
      {children}
    </Card>
  );
}

// ---- a) Reviews ----

function ReviewRow({ r }: { r: ResolvedReview }) {
  // Card reviews resolve by promptId: topicId null means the id didn't
  // resolve (a matching Unresolved entry blocks apply). Evidence reviews
  // with resolvedTopicId null are NOT flagged here — that's either an
  // in-batch topic (fine) or covered by the Unresolved panel.
  const unresolved = r.kind === 'card' && r.topicId === null;
  const title = r.kind === 'card' ? (r.topicTitle ?? `prompt ${r.promptId}`) : r.topicTitle;
  return (
    <div
      className="list-row row wrap gap-2"
      style={
        unresolved
          ? { borderLeft: '3px solid var(--st-blocked)', background: tint('var(--st-blocked)', 8) }
          : undefined
      }
    >
      <span className="grow" style={{ fontWeight: 600 }}>
        {title}
      </span>
      {r.kind === 'evidence' && (
        <span
          className="pill"
          style={{ fontSize: 12 }}
          title="Logged against the topic; nothing is scheduled"
        >
          evidence
        </span>
      )}
      <GradeBadge grade={r.grade} />
      {r.kind === 'card' && r.cardPreview && (
        <span className="sr-preview mono">
          interval {r.cardPreview.intervalBefore}d → {r.cardPreview.intervalAfter}d
          {r.cardPreview.nextReviewAt ? ` · next ${formatDate(r.cardPreview.nextReviewAt)}` : ''}
        </span>
      )}
      {unresolved && (
        <span className="badge" style={{ color: 'var(--st-blocked)' }}>
          unresolved
        </span>
      )}
      {r.kind === 'card' && r.promptText && (
        <div className="muted" style={{ flexBasis: '100%', fontSize: 13 }}>
          {r.promptText}
        </div>
      )}
      {r.note && (
        <div className="muted" style={{ flexBasis: '100%', fontSize: 13 }}>
          {r.note}
        </div>
      )}
    </div>
  );
}

export function ReviewsSection({ reviews }: { reviews: ResolvedReview[] }) {
  return (
    <SectionShell title="Reviews" count={reviews.length}>
      {reviews.length === 0 ? (
        <div className="muted">No reviews in this session.</div>
      ) : (
        <div className="col gap-2">
          {reviews.map((r, i) => (
            <ReviewRow key={r.kind === 'card' ? r.promptId + i : `${r.topicTitle}-${i}`} r={r} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ---- b) New topics ----

function NewTopicRow({ t }: { t: NewTopicPlan }) {
  return (
    <div className="list-row col gap-1" style={t.alreadyExists ? { opacity: 0.6 } : undefined}>
      <div className="row wrap gap-2">
        <span className="grow" style={{ fontWeight: 600 }}>
          {t.title}
        </span>
        <Chip>{t.topicType}</Chip>
        <Chip>{t.domain}</Chip>
        {t.alreadyExists && (
          <span className="badge faint" title="Already exists — will be skipped">
            already exists · skipped
          </span>
        )}
      </div>
      {t.description && (
        <div className="muted" style={{ fontSize: 13 }}>
          {t.description}
        </div>
      )}
      {(t.parentTitle || t.prerequisiteTitles.length > 0) && (
        <div className="row wrap gap-2" style={{ fontSize: 12 }}>
          {t.parentTitle && (
            <span className="row gap-1">
              <span className="faint">parent</span>
              <Chip>{t.parentTitle}</Chip>
            </span>
          )}
          {t.prerequisiteTitles.length > 0 && (
            <span className="row wrap gap-1">
              <span className="faint">needs</span>
              {t.prerequisiteTitles.map((p) => (
                <Chip key={p}>{p}</Chip>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function NewTopicsSection({ topics }: { topics: NewTopicPlan[] }) {
  return (
    <SectionShell title="New topics" count={topics.length}>
      {topics.length === 0 ? (
        <div className="muted">No new topics proposed.</div>
      ) : (
        <div className="col gap-2">
          {topics.map((t, i) => (
            <NewTopicRow key={`${t.title}-${i}`} t={t} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ---- b2) Proposed cards ----

function ProposedCardRow({ p }: { p: NewPromptPlan }) {
  return (
    <div className="list-row col gap-1">
      <div className="row wrap gap-2">
        <span className="grow" style={{ fontWeight: 600 }}>
          {p.topicTitle}
        </span>
        <Chip>{p.promptKind}</Chip>
        {p.problemDifficulty && <Chip>{p.problemDifficulty}</Chip>}
        {p.estimatedMinutes != null && <Chip>~{p.estimatedMinutes}m</Chip>}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {p.promptText}
      </div>
      {p.url && (
        <div className="faint mono" style={{ fontSize: 12 }}>
          {p.url}
        </div>
      )}
    </div>
  );
}

export function ProposedCardsSection({ prompts }: { prompts: NewPromptPlan[] }) {
  return (
    <SectionShell title="Proposed cards" count={prompts.length}>
      {prompts.length === 0 ? (
        <div className="muted">No new cards proposed.</div>
      ) : (
        <div className="col gap-2">
          {prompts.map((p, i) => (
            <ProposedCardRow key={`${p.topicTitle}-${i}`} p={p} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ---- c) Note summaries ----

function NoteSummaryRow({ n }: { n: NoteSummaryPlan }) {
  const { toast } = useToast();
  const copy = () => {
    void navigator.clipboard
      .writeText(n.composedSummary)
      .then(() => toast('Summary copied', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  };
  return (
    <div className="col gap-1">
      <div className="row wrap gap-2">
        <span className="grow" style={{ fontWeight: 600 }}>
          {n.topicTitle}
        </span>
        {n.resolvedTopicId === null && (
          <span className="badge" style={{ color: 'var(--st-blocked)' }}>
            unresolved
          </span>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>
          Copy
        </button>
      </div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 12px',
          background: 'var(--bg-soft, #fafafa)',
          fontSize: 13,
        }}
      >
        {n.composedSummary}
      </div>
      {n.suggestedNoteRef && (
        <div className="faint mono" style={{ fontSize: 12 }}>
          noteRef → {n.suggestedNoteRef}
        </div>
      )}
    </div>
  );
}

export function NoteSummariesSection({ notes }: { notes: NoteSummaryPlan[] }) {
  return (
    <SectionShell title="Note summaries" count={notes.length}>
      {notes.length === 0 ? (
        <div className="muted">No note summaries.</div>
      ) : (
        <div className="col gap-4">
          {notes.map((n, i) => (
            <NoteSummaryRow key={`${n.topicTitle}-${i}`} n={n} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ---- d) Next session ----

export function NextSessionSection({ next }: { next: ImportPlan['nextSession'] }) {
  const hasContent = !!(next && (next.focusTitle || next.coldChallenge));
  return (
    <Card title="Next session">
      {!hasContent ? (
        <span className="faint">none</span>
      ) : (
        <div className="col gap-2">
          {next?.focusTitle && (
            <div className="row gap-2">
              <span className="faint" style={{ minWidth: 110 }}>
                Focus
              </span>
              <span style={{ fontWeight: 600 }}>{next.focusTitle}</span>
            </div>
          )}
          {next?.coldChallenge && (
            <div className="row gap-2">
              <span className="faint" style={{ minWidth: 110 }}>
                Cold challenge
              </span>
              <span>{next.coldChallenge}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---- Unresolved panel ----

export function UnresolvedPanel({ items }: { items: Unresolved[] }) {
  return (
    <Card
      title={
        <span className="row gap-2" style={{ color: 'var(--st-blocked)' }}>
          Unresolved
          <span className="badge mono">{items.length}</span>
        </span>
      }
      style={{ borderColor: 'var(--st-blocked)' }}
    >
      <div className="col gap-2">
        {items.map((u, i) => (
          <div
            key={`${u.kind}-${u.title ?? u.ref}-${i}`}
            className="list-row col gap-1"
            style={{ borderLeft: '3px solid var(--st-blocked)' }}
          >
            <div className="row wrap gap-2">
              <span className="badge">{u.kind}</span>
              <span className={'grow' + (u.title ? '' : ' mono')} style={{ fontWeight: 600 }}>
                {u.title ?? `prompt ${u.ref}`}
              </span>
              <span className="badge" style={{ color: 'var(--st-blocked)' }}>
                {u.reason}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {u.context}
            </div>
          </div>
        ))}
        <div style={{ fontWeight: 600, marginTop: 4 }}>
          Resolve these before importing — fix titles in your paste and Preview again (a missing
          prompt id usually means the card was deleted or belongs to another account).
        </div>
      </div>
    </Card>
  );
}
