import { Link, useParams } from '@tanstack/react-router';
import { TopicDetailPanel } from '../../components/TopicDetailPanel';

export default function TopicPage() {
  const { topicId } = useParams({ from: '/topics/$topicId' });
  return (
    <article className="page topic-page">
      <nav className="topic-page-nav row wrap gap-3" aria-label="Topic navigation">
        <Link to="/topics">← All topics</Link>
        <a href="#notes">Your notes</a>
        <a href="#session-summary">Session summary</a>
        <a href="#learning-evidence">Evidence</a>
      </nav>
      <TopicDetailPanel key={topicId} topicId={topicId} fullPage />
    </article>
  );
}
