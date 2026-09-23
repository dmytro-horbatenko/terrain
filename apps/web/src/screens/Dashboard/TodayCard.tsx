import { Link } from '@tanstack/react-router';
import type { Dashboard } from '../../api/types';
import { Card } from '../../components';
import { ReviewFirst, ReviewPlan, useReviewChoice } from '../../components/ReviewChoice';

/**
 * The daily-ritual surface: two independent tracks — review what's due, and
 * learn the next topic — each a single "Start" that opens the routed
 * copy→Claude→import wizard (`/session/$mode`). An un-imported session in
 * flight flips that track's button to "Continue". The app never quizzes or
 * grades; it only hands off context and records the imported result.
 */
export default function TodayCard({ dash }: { dash: Dashboard }) {
  const { nextUp, counts, sessionQueueCount, pendingSessions, reviewQueue, reviewDay } = dash;
  const reviewChoice = useReviewChoice(dash);
  const repeatPending = pendingSessions.find((s) => s.mode === 'repeat');
  const learnPending =
    !!nextUp &&
    pendingSessions.some(
      (session) => session.mode === 'learn' && session.focusTopicId === nextUp.topic.id,
    );
  const showLearn = !!nextUp || counts.planned > 0;

  return (
    <div className="grid dashboard-today-grid">
      {/* ---- review track ---- */}
      <Card title="Review">
        <div className="col gap-3">
          {reviewDay.completed && <b>Today's review commitment is complete.</b>}
          {repeatPending ? (
            <>
              <b>
                Review in progress
                {repeatPending.reviewPlan &&
                  `: ${repeatPending.reviewPlan.promptIds.length} cards · ~${repeatPending.reviewPlan.estimatedMinutes} min`}
              </b>
              <Link to="/session/$mode" params={{ mode: 'repeat' }} className="btn btn-primary">
                Continue review
              </Link>
              <span className="faint">Saved session — not imported yet</span>
              {reviewQueue.backlogCount > 0 && (
                <details>
                  <summary>Other review options</summary>
                  <ReviewPlan queue={reviewQueue} />
                </details>
              )}
            </>
          ) : reviewQueue.backlogCount === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing due today — all clear.
            </p>
          ) : (
            <>
              <ReviewPlan queue={reviewQueue} />
              {sessionQueueCount > 0 && (
                <Link to="/session/$mode" params={{ mode: 'repeat' }} className="btn btn-primary">
                  {reviewDay.completed ? 'Review more' : 'Start review'}
                </Link>
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
              No learnable leaf is available — check Roadmap blockers.
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
              {nextUp.sourcePlanStats.requiredCount > 0 && (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  Source plan: {nextUp.sourcePlanStats.requiredCount} source
                  {nextUp.sourcePlanStats.requiredCount === 1 ? '' : 's'} · ~
                  {nextUp.sourcePlanStats.estimatedMinutes} min total reading
                  {nextUp.sourcePlanStats.hasExpired ? ' · catalog recheck due' : ''}
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
              {reviewChoice.reviewFirst && !learnPending ? (
                <ReviewFirst onContinue={reviewChoice.continueToday} />
              ) : (
                <Link
                  to="/session/$mode"
                  params={{ mode: 'learn' }}
                  search={{ topic: nextUp.topic.id }}
                  className="btn btn-primary"
                >
                  {learnPending ||
                  nextUp.topic.status === 'active' ||
                  nextUp.topic.status === 'mastered'
                    ? 'Continue learning'
                    : 'Start learning'}
                </Link>
              )}
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
