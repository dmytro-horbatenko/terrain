import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { Dashboard, NextUp, Topic } from '../../api/types';
import { Card } from '../../components';
import { timeAgo } from '../../lib/format';

/**
 * The daily-ritual surface: step 1 clear today's review queue, step 2 learn
 * the next topic (server-picked, curriculum order), plus a breadcrumb for any
 * copied session context that hasn't come back through Import yet. Step 2's
 * primary action is the AI loop (copy context → Claude → Import); manual
 * activation stays as a demoted escape hatch for topics studied elsewhere.
 */
export default function TodayCard({
  dash,
  onOpenSession,
  starting,
  onActivate,
  copying,
  onCopyRepeat,
  onCopyLearn,
}: {
  dash: Dashboard;
  onOpenSession: () => void;
  starting: boolean;
  onActivate: (topic: Topic) => void;
  copying: boolean;
  onCopyRepeat: () => void;
  onCopyLearn: () => Promise<boolean>;
}) {
  const [learnCopied, setLearnCopied] = useState(false);
  const { nextUp, counts, sessionQueueCount, sessionQueueMinutes } = dash;
  const showLearn = !!nextUp || counts.planned > 0;
  // The post-copy strip already says "bring it to Import" — don't say it twice.
  const pending = dash.pendingSessions.filter((s) => !(learnCopied && s.mode === 'learn'));

  async function startLearning() {
    if (await onCopyLearn()) setLearnCopied(true);
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <Card title="Today">
        <div className="col gap-4">
          <StepRow n={1} label="Review">
            {sessionQueueCount === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nothing due today — all clear.
              </p>
            ) : (
              <div className="col gap-2">
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {sessionQueueCount} cards
                  {sessionQueueMinutes > 0 ? ` · ~${sessionQueueMinutes} min` : ''}
                </div>
                <div className="row gap-2">
                  <button className="btn btn-primary" onClick={onOpenSession}>
                    ▶ Review all ({sessionQueueCount})
                  </button>
                  <button className="btn" disabled={copying} onClick={onCopyRepeat}>
                    {copying ? 'Generating…' : '⧉ Copy repetition context'}
                  </button>
                </div>
              </div>
            )}
          </StepRow>

          {showLearn && (
            <StepRow n={2} label="Learn">
              {!nextUp ? (
                <p className="muted" style={{ margin: 0 }}>
                  All remaining topics are blocked — keep reviewing to unlock them.
                </p>
              ) : (
                <LearnStep
                  nextUp={nextUp}
                  starting={starting}
                  onActivate={onActivate}
                  copying={copying}
                  copied={learnCopied}
                  onStartLearning={startLearning}
                />
              )}
            </StepRow>
          )}

          {pending.length > 0 && (
            <div className="col gap-2">
              {pending.map((s) => (
                <div
                  key={s.id}
                  className="row gap-2"
                  style={{ alignItems: 'center', fontSize: 12.5 }}
                >
                  <span className="muted">
                    ⏳ {s.mode === 'learn' ? 'Learning' : 'Repetition'} context copied{' '}
                    {timeAgo(s.generatedAt)} — session not imported yet
                  </span>
                  <Link to="/import" className="btn btn-sm">
                    Paste results
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StepRow({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div className="col gap-2">
      <div
        className="row gap-2"
        style={{
          alignItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        <span className="pill">{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function LearnStep({
  nextUp: { topic, chapterTitle, chapterProgress },
  starting,
  onActivate,
  copying,
  copied,
  onStartLearning,
}: {
  nextUp: NextUp;
  starting: boolean;
  onActivate: (topic: Topic) => void;
  copying: boolean;
  copied: boolean;
  onStartLearning: () => void;
}) {
  const snippet =
    topic.description && topic.description.length > 220
      ? `${topic.description.slice(0, 220)}…`
      : topic.description;
  return (
    <div className="col gap-2">
      {chapterTitle && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          {chapterTitle}
          {chapterProgress && ` · ${chapterProgress.started} of ${chapterProgress.total} started`}
        </div>
      )}
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span style={{ fontWeight: 650, fontSize: 16 }}>{topic.title}</span>
        <span className="pill">{topic.topicType}</span>
        {topic.aiProposed && (
          <span title="Imported from Claude" style={{ color: 'var(--st-active)' }}>
            ✦
          </span>
        )}
      </div>
      {snippet && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
          {snippet}
        </p>
      )}
      {copied ? (
        <div className="col gap-2">
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            Copied ✓ — paste into a fresh Claude chat and have the session. When you&apos;re done,
            bring the <span className="mono">learning-os</span> block back to Import.
          </p>
          <div className="row gap-2">
            <Link to="/import" className="btn btn-primary btn-sm">
              Open Import
            </Link>
            <button className="btn btn-ghost btn-sm" disabled={copying} onClick={onStartLearning}>
              {copying ? 'Generating…' : 'Copy again'}
            </button>
          </div>
        </div>
      ) : (
        <div className="row gap-2">
          <button className="btn btn-primary" disabled={copying} onClick={onStartLearning}>
            {copying ? 'Generating…' : '▶ Start learning'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={starting}
            title="Skip the AI session — activate this topic and log a first self-graded review"
            onClick={() => onActivate(topic)}
          >
            {starting ? 'Activating…' : 'Studied elsewhere'}
          </button>
        </div>
      )}
    </div>
  );
}
