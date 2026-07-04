import { useEffect, useState } from 'react';
import {
  useDashboard,
  useGenerateExport,
  useHeatmap,
  useSkipStreak,
  useStreak,
  useUpdateTopic,
} from '../../api/hooks';
import type { Topic, TopicStatus } from '../../api/types';
import NextUpCard from './NextUpCard';
import ReviewSession from './ReviewSession';
import {
  Card,
  EmptyState,
  ErrorBox,
  Gauge,
  Heatmap,
  Loading,
  LogReviewForm,
  Modal,
  ReviewGate,
  STATUS_META,
  StatusBadge,
  tint,
  topicColor,
  useToast,
} from '../../components';
import { dueLabel } from '../../lib/format';

const LIBRARY_ORDER: TopicStatus[] = ['planned', 'active', 'mastered', 'archived'];

export default function Dashboard() {
  const dashboardQ = useDashboard();
  const streakQ = useStreak();
  const heatmapQ = useHeatmap();
  const skip = useSkipStreak();
  const { toast } = useToast();
  const [logTopic, setLogTopic] = useState<Topic | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const { mutate: updateTopic, isPending: starting } = useUpdateTopic();
  const exportCtx = useGenerateExport();

  function copyContext(args: { mode: string }, label: string) {
    exportCtx.mutate(args, {
      onSuccess: (data) => {
        if (!navigator.clipboard?.writeText) {
          toast('Clipboard unavailable — use the Export screen to copy manually', 'info');
          return;
        }
        navigator.clipboard
          .writeText(data.exportMd)
          .then(() => toast(`${label} copied — paste into a fresh Claude chat`, 'success'))
          .catch(() => toast('Could not copy — use the Export screen to copy manually', 'error'));
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Export failed', 'error'),
    });
  }

  // Telegram digest deep link: /?session=1 auto-opens the review session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session') !== '1') return;
    setSessionOpen(true);
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (dashboardQ.isLoading || streakQ.isLoading) return <Loading label="Loading dashboard…" />;
  if (dashboardQ.isError) return <ErrorBox error={dashboardQ.error} />;
  if (streakQ.isError) return <ErrorBox error={streakQ.error} />;
  if (!dashboardQ.data || !streakQ.data) return <ErrorBox error="No dashboard data" />;

  const dash = dashboardQ.data;
  const streak = streakQ.data;
  const { counts, due } = dash;

  function useFreeze() {
    skip.mutate(undefined, {
      onSuccess: () => toast('Freeze used', 'success'),
      onError: (e) => toast(e instanceof Error ? e.message : 'Could not skip today', 'error'),
    });
  }

  function startTopic(topic: Topic) {
    updateTopic(
      { id: topic.id, input: { status: 'active', aiProposed: false } },
      {
        onSuccess: () => setLogTopic({ ...topic, status: 'active' }),
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not start topic', 'error'),
      },
    );
  }

  const dueCount = due.overdue.length + due.dueToday.length;

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">{today}</p>

      {/* ---- KPI row ---- */}
      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}
      >
        <Card>
          <div className="kpi" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span aria-hidden>🔥</span>
            <span>{streak.currentStreak}</span>
          </div>
          <div className="kpi-label">day streak — best {streak.longestStreak}</div>
        </Card>

        <Card>
          <div className="kpi" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span aria-hidden>🛡️</span>
            <span>{streak.freezeBalance}</span>
          </div>
          <div className="kpi-label">freezes available</div>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            disabled={skip.isPending || streak.freezeBalance <= 0}
            onClick={useFreeze}
          >
            {skip.isPending ? 'Using…' : 'Use freeze (skip today)'}
          </button>
        </Card>

        <Card>
          <div className="kpi">{counts.dueToday}</div>
          <div className="kpi-label">
            due today
            {counts.overdue > 0 && <span className="faint"> · + {counts.overdue} overdue</span>}
            <span className="pill" style={{ marginLeft: 6 }}>
              New: {dash.newCards}
            </span>
          </div>
        </Card>

        <Card>
          <div className="kpi">{counts.mastered}</div>
          <div className="kpi-label">of {counts.total} topics mastered</div>
        </Card>
      </div>

      {/* ---- next up ---- */}
      <NextUpCard
        nextUp={dash.nextUp}
        plannedCount={counts.planned}
        starting={starting}
        onStart={startTopic}
        copying={exportCtx.isPending}
        onCopyContext={() => copyContext({ mode: 'learn' }, 'Learning context')}
      />

      {/* ---- struggle + library ---- */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <Card title="Struggle ratio (7d)">
          <Gauge value={dash.struggleRatio7d} />
          <p className="muted" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            The 40–60% band is the desirable-difficulty zone: hard enough to build durable memory,
            not so hard you stall. Drifting low means reviews are too easy; high means you may be
            overreaching.
          </p>
        </Card>

        <Card title="Library">
          <div className="row wrap gap-2">
            {LIBRARY_ORDER.map((status) => {
              const color = topicColor(status);
              return (
                <span key={status} className="badge" style={{ background: tint(color), color }}>
                  <span aria-hidden>{STATUS_META[status].glyph}</span>
                  {STATUS_META[status].label}
                  <b style={{ marginLeft: 2 }}>{counts[status]}</b>
                </span>
              );
            })}
          </div>
          <div className="kpi-label" style={{ marginTop: 14 }}>
            {counts.total} topics total
          </div>
        </Card>
      </div>

      {/* ---- activity heatmap ---- */}
      <div style={{ marginBottom: 18 }}>
        <Card title="Review activity">
          {heatmapQ.data ? (
            <Heatmap cells={heatmapQ.data} />
          ) : (
            <span className="faint">Loading activity…</span>
          )}
        </Card>
      </div>

      {/* ---- due for review ---- */}
      {dash.sessionQueueCount > 0 && (
        <div className="row gap-2" style={{ marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={() => setSessionOpen(true)}>
            ▶ Review all ({dash.sessionQueueCount})
          </button>
          <button
            className="btn"
            disabled={exportCtx.isPending}
            onClick={() => copyContext({ mode: 'repeat' }, 'Repetition context')}
          >
            {exportCtx.isPending ? 'Generating…' : '⧉ Copy repetition context'}
          </button>
        </div>
      )}
      <h2 className="card-title" style={{ marginBottom: 10 }}>
        Due for review
      </h2>
      {dueCount === 0 ? (
        <EmptyState title="All clear" hint="Nothing due today — a quiet day keeps your streak." />
      ) : (
        <div className="col gap-4">
          {due.overdue.length > 0 && (
            <DueGroup
              label="Overdue"
              labelColor="var(--st-blocked)"
              topics={due.overdue}
              onLog={setLogTopic}
            />
          )}
          {due.dueToday.length > 0 && (
            <DueGroup label="Due today" topics={due.dueToday} onLog={setLogTopic} />
          )}
        </div>
      )}

      <Modal open={!!logTopic} onClose={() => setLogTopic(null)} title={logTopic?.title}>
        {logTopic && (
          <ReviewGate topic={logTopic}>
            {(promptId, previewIntervals) => (
              <LogReviewForm
                topic={logTopic}
                onLogged={() => setLogTopic(null)}
                autoFocusNote
                promptId={promptId}
                previewIntervals={previewIntervals}
              />
            )}
          </ReviewGate>
        )}
      </Modal>

      <Modal open={sessionOpen} onClose={() => setSessionOpen(false)} title="Review session">
        {sessionOpen && <ReviewSession onClose={() => setSessionOpen(false)} />}
      </Modal>
    </div>
  );
}

function DueGroup({
  label,
  labelColor,
  topics,
  onLog,
}: {
  label: string;
  labelColor?: string;
  topics: Topic[];
  onLog: (t: Topic) => void;
}) {
  return (
    <div className="col gap-2">
      <div
        className="row"
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: labelColor ?? 'var(--text-muted)',
        }}
      >
        {label}
        <span className="pill" style={{ marginLeft: 8 }}>
          {topics.length}
        </span>
      </div>
      <Card pad={false}>
        {topics.map((t) => {
          const due = dueLabel(t.nextReviewAt);
          return (
            <div key={t.id} className="list-row" style={{ cursor: 'default' }}>
              <StatusBadge status={t.status} />
              <span className="grow" style={{ fontWeight: 550 }}>
                {t.title}
              </span>
              <span className="pill nowrap">{t.domain}</span>
              <span
                className="nowrap"
                style={{
                  fontSize: 12.5,
                  color: due.overdue ? 'var(--st-blocked)' : 'var(--text-muted)',
                  minWidth: 90,
                  textAlign: 'right',
                }}
              >
                {due.text}
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => onLog(t)}>
                Log
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
