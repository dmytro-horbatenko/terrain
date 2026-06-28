import type { NextUp, Topic } from '../../api/types';
import { Card } from '../../components';

/**
 * The guided "what now" surface: exactly one suggested topic (server-picked,
 * curriculum order) with a one-click Start. Renders a blocked explainer when
 * planned topics remain but none is startable, and nothing at all when the
 * curriculum is exhausted.
 */
export default function NextUpCard({
  nextUp,
  plannedCount,
  starting,
  onStart,
}: {
  nextUp: NextUp | null;
  plannedCount: number;
  starting: boolean;
  onStart: (topic: Topic) => void;
}) {
  if (!nextUp && plannedCount === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <Card title="Next up">
        {!nextUp ? (
          <p className="muted" style={{ margin: 0 }}>
            All remaining topics are blocked — keep reviewing to unlock them.
          </p>
        ) : (
          <NextUpBody nextUp={nextUp} starting={starting} onStart={onStart} />
        )}
      </Card>
    </div>
  );
}

function NextUpBody({
  nextUp: { topic, chapterTitle, chapterProgress },
  starting,
  onStart,
}: {
  nextUp: NextUp;
  starting: boolean;
  onStart: (topic: Topic) => void;
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
      <div>
        <button className="btn btn-primary" disabled={starting} onClick={() => onStart(topic)}>
          {starting ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  );
}
