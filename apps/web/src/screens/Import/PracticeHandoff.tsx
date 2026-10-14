import { Link } from '@tanstack/react-router';
import { useTopics } from '../../api/hooks';
import type { ImportPlan, ImportResult, TopicWithMeta } from '../../api/types';

type PracticeTopic = Pick<TopicWithMeta, 'id' | 'title'>;

export function importedPracticeTopics(
  plan: ImportPlan,
  result: ImportResult,
  topics: Pick<TopicWithMeta, 'id' | 'title' | 'topicType'>[],
): PracticeTopic[] {
  if (!result.appEventsApplied) return [];
  const practiced = new Map<string, PracticeTopic>();
  const norm = (title: string) => title.trim().toLowerCase();
  for (const event of plan.applicationEvents ?? []) {
    if (event.resolvedTopicId) {
      practiced.set(event.resolvedTopicId, {
        id: event.resolvedTopicId,
        title:
          topics.find((topic) => topic.id === event.resolvedTopicId)?.title ?? event.topicTitle,
      });
    } else {
      const matches = topics.filter(
        (topic) =>
          result.topicsCreated.includes(topic.id) &&
          [topic.title, `${topic.title} [${topic.topicType}]`].some(
            (title) => norm(title) === norm(event.topicTitle),
          ),
      );
      if (matches.length === 1) {
        const topic = matches[0];
        practiced.set(topic.id, { id: topic.id, title: topic.title });
      }
    }
  }
  return [...practiced.values()];
}

export function PracticeHandoff({ plan, result }: { plan: ImportPlan; result: ImportResult }) {
  const topics = useTopics();
  const practiced = importedPracticeTopics(plan, result, topics.data ?? []);
  if (!result.appEventsApplied) return null;
  return (
    <section className="col gap-2" aria-label="Practice after import">
      <b>Try a changed case later</b>
      <p className="muted" style={{ margin: 0 }}>
        You recorded practice. Choose one mechanism to check again after a delay. Review the task,
        allowed tools and date before saving; importing practice does not schedule a check.
      </p>
      <div className="row wrap gap-2">
        {practiced.map((topic) => (
          <Link
            key={topic.id}
            to="/topics/$topicId"
            params={{ topicId: topic.id }}
            search={{ practice: 'plan' }}
            hash="practice"
            className="btn btn-sm"
          >
            Plan a changed case: {topic.title}
          </Link>
        ))}
        {!practiced.length && (
          <>
            <Link to="/topics" className="btn btn-sm">
              Open the practiced topic
            </Link>
            <button className="btn btn-sm" onClick={() => void topics.refetch()}>
              Refresh topic links
            </button>
          </>
        )}
      </div>
    </section>
  );
}
