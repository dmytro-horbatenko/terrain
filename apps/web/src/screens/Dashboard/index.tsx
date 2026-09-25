import { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  useDashboard,
  useHeatmap,
  useSkipStreak,
  useStreak,
  useTopics,
  useProjectProgress,
  useSettings,
  useRecentNotes,
} from '../../api/hooks';
import { latestProjectCheckpoint } from '@terrain/types';
import curriculum from '../../../../../content/projects/web3-products.json';
import type { Topic, TopicStatus } from '../../api/types';
import TodayCard from './TodayCard';
import {
  Card,
  EmptyState,
  ErrorBox,
  Gauge,
  Heatmap,
  Loading,
  STATUS_META,
  StatusBadge,
  tint,
  topicColor,
  useToast,
} from '../../components';
import { dueLabel, formatDate } from '../../lib/format';
import { SkillChecksPanel } from '../../components/SkillChecksPanel';

const LIBRARY_ORDER: TopicStatus[] = ['planned', 'active', 'mastered', 'archived'];

export default function Dashboard() {
  const dashboardQ = useDashboard();
  const timezone = useSettings().data?.timezone ?? 'UTC';
  const streakQ = useStreak();
  const heatmapQ = useHeatmap();
  const topicsQ = useTopics();
  const projectsQ = useProjectProgress();
  const recentNotes = useRecentNotes();
  const skip = useSkipStreak();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Telegram digest deep link: /?session=1 opens the review wizard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session') !== '1') return;
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    navigate({ to: '/session/$mode', params: { mode: 'repeat' } });
  }, [navigate]);

  const today = new Date().toLocaleDateString(undefined, {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (dashboardQ.isLoading) return <Loading label="Loading dashboard…" />;
  if (dashboardQ.isError) return <ErrorBox error={dashboardQ.error} />;
  if (!dashboardQ.data) return <ErrorBox error="No dashboard data" />;

  const dash = dashboardQ.data;
  const streak = streakQ.data;
  const { counts, due } = dash;
  const chapterIds = new Set(topicsQ.data?.map((topic) => topic.parentId));
  const learningTopics = topicsQ.data?.filter((topic) => !chapterIds.has(topic.id));
  const lastCheckpoint = latestProjectCheckpoint(
    (projectsQ.data ?? []).map((project) => ({
      ...project,
      checkpoints: project.checkpoints.filter((checkpoint) => checkpoint.status === 'active'),
    })),
  );
  const currentProject = curriculum.projects.find(
    (project) => project.id === lastCheckpoint?.projectId,
  );

  function useFreeze() {
    skip.mutate(undefined, {
      onSuccess: () => toast('Freeze used', 'success'),
      onError: (e) => toast(e instanceof Error ? e.message : 'Could not skip today', 'error'),
    });
  }

  const dueCount = due.overdue.length + due.dueToday.length;

  return (
    <div className="page">
      <h1 className="page-title">Today</h1>
      <p className="page-sub">
        {today} · {timezone}
      </p>

      <div className="col gap-4">
        <TodayCard dash={dash} />
        <div className="grid dashboard-analysis-grid">
          <Card title={currentProject ? 'Your active project' : 'Project work'}>
            {projectsQ.isError && (
              <ErrorBox error="Project progress could not load. Open Projects to retry." />
            )}
            {currentProject && lastCheckpoint ? (
              <div className="col gap-2">
                <b>{currentProject.title}</b>
                <span className="muted">
                  {
                    currentProject.milestones.find(
                      (milestone) => milestone.id === lastCheckpoint.milestoneId,
                    )?.title
                  }
                </span>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {lastCheckpoint.nextAction}
                </p>
                <Link
                  className="btn btn-primary"
                  to="/projects/$projectId"
                  params={{ projectId: currentProject.id }}
                  search={{ milestone: lastCheckpoint.milestoneId }}
                >
                  Continue milestone
                </Link>
              </div>
            ) : (
              <p className="muted">Keep one product milestone active alongside your topic study.</p>
            )}
            <div className="row wrap gap-2" style={{ marginTop: 12 }}>
              <Link className="btn" to="/projects">
                Open projects
              </Link>
              <Link className="btn btn-ghost" to="/courses" hash="study-guide">
                Study routine
              </Link>
            </div>
          </Card>
          <Card title="Recently edited notes">
            {recentNotes.isError ? (
              <ErrorBox error="Recent notes could not load. You can still open Topics." />
            ) : recentNotes.isLoading ? (
              <span className="muted">Loading notes…</span>
            ) : recentNotes.data?.length ? (
              <div className="col gap-3">
                {recentNotes.data.slice(0, 3).map((note) => (
                  <Link
                    key={note.id}
                    to="/topics/$topicId"
                    params={{ topicId: note.id }}
                    hash="notes"
                    className="dashboard-note-link"
                  >
                    <b>{note.title}</b>
                    <span className="muted">{formatDate(note.updatedAt, undefined, timezone)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">Save your first topic note to find it here next time.</p>
            )}
            <Link className="btn" to="/topics" style={{ marginTop: 12 }}>
              Find a topic or note
            </Link>
          </Card>
        </div>
        <SkillChecksPanel overview />

        <details className="dashboard-details">
          <summary>Progress, review activity &amp; backlog</summary>
          <div className="col gap-4" style={{ marginTop: 16 }}>
            {streakQ.isError && <ErrorBox error="Review streak could not load or refresh." />}
            {/* ---- KPI row ---- */}
            <div className="grid dashboard-kpi-grid">
              <Card>
                <div className="kpi" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden>🔥</span>
                  <span>{streak?.currentStreak ?? '—'}</span>
                </div>
                <div className="kpi-label">
                  day review streak — best {streak?.longestStreak ?? '—'}
                </div>
                <p className="faint">
                  Completed days only. Quiet days with no active topics due also extend this streak;
                  freezes preserve it. Project work and source study are tracked separately.
                </p>
              </Card>

              <Card>
                <div className="kpi" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden>🛡️</span>
                  <span>{streak?.freezeBalance ?? '—'}</span>
                </div>
                <div className="kpi-label">freezes available</div>
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 10 }}
                  disabled={skip.isPending || (streak?.freezeBalance ?? 0) <= 0}
                  onClick={useFreeze}
                >
                  {skip.isPending ? 'Using…' : 'Use freeze (skip today)'}
                </button>
              </Card>

              <Card>
                <div className="kpi">{counts.dueToday}</div>
                <div className="kpi-label">
                  due today
                  {counts.overdue > 0 && (
                    <span className="faint"> · + {counts.overdue} overdue</span>
                  )}
                  <span className="pill" style={{ marginLeft: 6 }}>
                    Awaiting first review: {dash.newCards}
                  </span>
                </div>
              </Card>

              <Card>
                <div className="kpi">
                  {learningTopics?.filter((topic) => topic.status === 'mastered').length ?? '—'}
                </div>
                <div className="kpi-label">
                  of {learningTopics?.length ?? '—'} learning topics meet mastery conditions
                </div>
                <p className="faint">
                  Chapters are excluded. Independent practice is recorded in skill checks.
                </p>
              </Card>
            </div>

            {/* ---- struggle + library ---- */}
            <div className="grid dashboard-analysis-grid">
              <Card title="Self-rated reviews (7d)">
                <Gauge
                  value={dash.reviewStats7d.againRatio}
                  reviewCount={dash.reviewStats7d.total}
                />
                <p className="muted" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5 }}>
                  Again records a difficult recall attempt. These self-ratings help plan practice;
                  they do not establish independent mastery or a target failure rate.
                </p>
              </Card>

              <Card title="Library">
                <div className="row wrap gap-2">
                  {LIBRARY_ORDER.map((status) => {
                    const color = topicColor(status);
                    return (
                      <span
                        key={status}
                        className="badge"
                        style={{ background: tint(color), color }}
                      >
                        <span aria-hidden>{STATUS_META[status].glyph}</span>
                        {STATUS_META[status].label}
                        <b style={{ marginLeft: 2 }}>{counts[status]}</b>
                      </span>
                    );
                  })}
                </div>
                <div className="kpi-label" style={{ marginTop: 14 }}>
                  {counts.total} entries, including chapters
                </div>
              </Card>
            </div>

            {/* ---- activity heatmap ---- */}
            <Card title="Review activity">
              {heatmapQ.isError ? (
                <ErrorBox error="Review activity could not load." />
              ) : heatmapQ.data ? (
                <Heatmap cells={heatmapQ.data} timezone={timezone} />
              ) : (
                <span className="faint">Loading activity…</span>
              )}
            </Card>

            {/* ---- due for review ---- */}
            <div className="col gap-2">
              <h2 className="card-title" style={{ margin: 0 }}>
                Due for review
              </h2>
              {dueCount === 0 ? (
                <EmptyState
                  title="All clear"
                  hint="No topic reviews due today. A quiet day extends your review streak without recording study."
                />
              ) : (
                <div className="col gap-4">
                  {due.overdue.length > 0 && (
                    <DueGroup
                      label="Overdue"
                      labelColor="var(--st-blocked)"
                      topics={due.overdue}
                      timezone={timezone}
                    />
                  )}
                  {due.dueToday.length > 0 && (
                    <DueGroup label="Due today" topics={due.dueToday} timezone={timezone} />
                  )}
                </div>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function DueGroup({
  label,
  labelColor,
  topics,
  timezone,
}: {
  label: string;
  labelColor?: string;
  topics: Topic[];
  timezone: string;
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
          const due = dueLabel(t.nextReviewAt, timezone);
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
            </div>
          );
        })}
      </Card>
    </div>
  );
}
