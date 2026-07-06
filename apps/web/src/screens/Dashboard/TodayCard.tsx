import { Link } from '@tanstack/react-router';
import type { Dashboard } from '../../api/types';
import { Card } from '../../components';

/**
 * The daily-ritual surface: two independent tracks — review what's due, and
 * learn the next topic — each a single "Start" that opens the routed
 * copy→Claude→import wizard (`/session/$mode`). An un-imported session in
 * flight flips that track's button to "Continue". The app never quizzes or
 * grades; it only hands off context and records the imported result.
 */
export default function TodayCard({ dash }: { dash: Dashboard }) {
  const { nextUp, counts, sessionQueueCount, sessionQueueMinutes, pendingSessions } = dash;
  const repeatPending = pendingSessions.some((s) => s.mode === 'repeat');
  const learnPending = pendingSessions.some((s) => s.mode === 'learn');
  const showLearn = !!nextUp || counts.planned > 0;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
      {/* ---- review track ---- */}
      <Card title="Review">
        <div className="col gap-3">
          {sessionQueueCount === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing due today — all clear.
            </p>
          ) : (
            <>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {sessionQueueCount} cards
                {sessionQueueMinutes > 0 ? ` · ~${sessionQueueMinutes} min` : ''}
              </div>
              <Link to="/session/$mode" params={{ mode: 'repeat' }} className="btn btn-primary">
                {repeatPending ? 'Continue review' : 'Start review'}
              </Link>
              {repeatPending && (
                <span className="faint" style={{ fontSize: 12 }}>
                  session in progress — not imported yet
                </span>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ---- learn track ---- */}
      <Card title="Learn">
        <div className="col gap-3">
          {!showLearn ? (
            <p className="muted" style={{ margin: 0 }}>
              Curriculum complete — nothing new to learn right now.
            </p>
          ) : !nextUp ? (
            <p className="muted" style={{ margin: 0 }}>
              All remaining topics are blocked — keep reviewing to unlock them.
            </p>
          ) : (
            <>
              {nextUp.chapterTitle && (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {nextUp.chapterTitle}
                  {nextUp.chapterProgress &&
                    ` · ${nextUp.chapterProgress.started} of ${nextUp.chapterProgress.total} started`}
                </div>
              )}
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <span style={{ fontWeight: 650, fontSize: 16 }}>{nextUp.topic.title}</span>
                <span className="pill">{nextUp.topic.topicType}</span>
                {nextUp.topic.aiProposed && (
                  <span title="Imported from Claude" style={{ color: 'var(--st-active)' }}>
                    ✦
                  </span>
                )}
              </div>
              <Link to="/session/$mode" params={{ mode: 'learn' }} className="btn btn-primary">
                {learnPending ? 'Continue learning' : 'Start learning'}
              </Link>
              {learnPending && (
                <span className="faint" style={{ fontSize: 12 }}>
                  session in progress — not imported yet
                </span>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
