import { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  useDashboard,
  useHeatmap,
  useSkipStreak,
  useStreak,
  useTopics,
  useProjectProgress,
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
import { dueLabel } from '../../lib/format';
import { SkillChecksPanel } from '../../components/SkillChecksPanel';

const LIBRARY_ORDER: TopicStatus[] = ['planned', 'active', 'mastered', 'archived'];

export default function Dashboard() {
  const dashboardQ = useDashboard();
  const streakQ = useStreak();
  const heatmapQ = useHeatmap();
  const topicsQ = useTopics();
  const projectsQ = useProjectProgress();
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
  const chapterIds = new Set(topicsQ.data?.map((topic) => topic.parentId));
  const learningTopics = topicsQ.data?.filter((topic) => !chapterIds.has(topic.id));
  const lastCheckpoint = latestProjectCheckpoint(projectsQ.data ?? []);
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
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">{today}</p>

      <div className="col gap-4">
        <TodayCard dash={dash} />
        <SkillChecksPanel />
        <Card title="Product engineering">
          <p className="muted">
            Build complete Web3 systems alongside deep topic study. 12 projects · 76 assessed
            milestones.
          </p>
          <div className="row wrap gap-2">
            <Link className="btn btn-primary" to="/projects">
              Open projects
            </Link>
            {currentProject && (
              <Link
                className="btn"
                to="/projects/$projectId"
                params={{ projectId: currentProject.id }}
              >
                Continue {currentProject.title}
              </Link>
            )}
          </div>
        </Card>

        {/* ---- KPI row ---- */}
        <div className="grid dashboard-kpi-grid">
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
            <Gauge value={dash.reviewStats7d.againRatio} reviewCount={dash.reviewStats7d.total} />
            <p className="muted" style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.5 }}>
              Again records a difficult recall attempt. These self-ratings help plan practice; they
              do not establish independent mastery or a target failure rate.
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
              {counts.total} entries, including chapters
            </div>
          </Card>
        </div>

        {/* ---- activity heatmap ---- */}
        <Card title="Review activity">
          {heatmapQ.data ? (
            <Heatmap cells={heatmapQ.data} />
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
              hint="Nothing due today — a quiet day keeps your streak."
            />
          ) : (
            <div className="col gap-4">
              {due.overdue.length > 0 && (
                <DueGroup label="Overdue" labelColor="var(--st-blocked)" topics={due.overdue} />
              )}
              {due.dueToday.length > 0 && <DueGroup label="Due today" topics={due.dueToday} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DueGroup({
  label,
  labelColor,
  topics,
}: {
  label: string;
  labelColor?: string;
  topics: Topic[];
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
            </div>
          );
        })}
      </Card>
    </div>
  );
}
