import { Link } from '@tanstack/react-router';
import { useTopics } from '../../api/hooks';
import type { ImportPlan, ImportResult, TopicWithMeta } from '../../api/types';

type TopicLink = Pick<TopicWithMeta, 'id' | 'title'>;

export function importedNoteTopics(
  plan: ImportPlan,
  result: ImportResult,
  topics: Pick<TopicWithMeta, 'id' | 'title' | 'topicType'>[],
): TopicLink[] {
  const links = new Map<string, TopicLink>();
  const add = (id: string | null, title: string | null) => {
    if (id)
      links.set(id, {
        id,
        title: topics.find((topic) => topic.id === id)?.title ?? title ?? 'Topic',
      });
  };
  const norm = (title: string) => title.trim().toLowerCase();
  const addByTitle = (title: string) => {
    const matches = topics.filter((topic) =>
      [topic.title, `${topic.title} [${topic.topicType}]`].some((ref) => norm(ref) === norm(title)),
    );
    if (matches.length === 1) add(matches[0].id, matches[0].title);
  };
  for (const item of [
    ...plan.noteSummaries,
    ...plan.activations,
    ...(plan.applicationEvents ?? []),
    ...(plan.sourceEvidence ?? []),
  ]) {
    if (item.resolvedTopicId) add(item.resolvedTopicId, item.topicTitle);
    else addByTitle(item.topicTitle);
  }
  for (const review of plan.reviews) {
    if (review.kind === 'card') add(review.topicId, review.topicTitle);
    else if (review.resolvedTopicId) add(review.resolvedTopicId, review.topicTitle);
    else addByTitle(review.topicTitle);
  }
  for (const prompt of plan.newPrompts) {
    if (!prompt.duplicate) addByTitle(prompt.topicTitle);
  }
  result.topicsCreated.forEach((id, index) => add(id, `New topic ${index + 1}`));
  return [...links.values()];
}

export function NotesHandoff({ plan, result }: { plan: ImportPlan; result: ImportResult }) {
  const topics = useTopics();
  const links = importedNoteTopics(plan, result, topics.data ?? []);
  return (
    <div className="col gap-2">
      <b>Save your topic notes</b>
      <p className="muted" style={{ margin: 0 }}>
        The import stores the compact session summary. Copy the longer topic notes from the chat,
        open the matching topic below, then paste and save them in Topic notes.
      </p>
      <div className="row wrap gap-2">
        {links.map((topic) => (
          <Link
            key={topic.id}
            to="/topics/$topicId"
            params={{ topicId: topic.id }}
            hash="notes"
            className="btn btn-sm"
          >
            Notes: {topic.title}
          </Link>
        ))}
        {links.length === 0 && (
          <Link to="/topics" className="btn btn-sm">
            Open topics
          </Link>
        )}
      </div>
    </div>
  );
}
