import { Link, useParams } from '@tanstack/react-router';
import { TopicDetailPanel } from '../../components/TopicDetailPanel';
import { useTopic } from '../../api/hooks';

export default function TopicPage() {
  const { topicId } = useParams({ from: '/topics/$topicId' });
  const topic = useTopic(topicId).data;
  return (
    <article className="page topic-page">
      <nav className="topic-page-nav row wrap gap-3" aria-label="Topic navigation">
        <Link to="/topics">← All topics</Link>
        <Link to="/roadmap" search={{ focus: topic?.parentId ?? 'all' }}>
          Chapter roadmap
        </Link>
        <a href="#notes">Your notes</a>
        <a href="#reference">AI reference</a>
        <a href="#session-summary">Session summary</a>
        <a href="#learning-evidence">Evidence</a>
      </nav>
      <TopicDetailPanel key={topicId} topicId={topicId} fullPage />
    </article>
  );
}
