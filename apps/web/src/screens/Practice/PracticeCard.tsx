import { Link } from '@tanstack/react-router';
import { practiceQueue } from '@terrain/types';
import { usePractice } from '../../api/hooks';
import { Card, ErrorBox } from '../../components';

export function PracticeCard() {
  const query = usePractice();
  const all = query.data?.lessons ?? [];
  const web3 = all.filter((t) => t.domain.toLowerCase() === 'web3');
  const lessons = web3.length ? web3 : all;
  const queue = practiceQueue(lessons);
  const next = queue.active[0] ?? queue.recovery[0];
  return (
    <Card title="Learn by doing">
      <div className="col gap-3">
        {query.isPending && <p className="muted">Loading your practice…</p>}
        {query.isError && (
          <ErrorBox error="Practice could not load. Open Practice to retry; your review and study sessions are still available." />
        )}
        {query.data && (
          <>
            <p className="muted">
              {queue.active.length} in progress · {queue.recovery.length} studied topics to revisit
              · {queue.library.length} saved references
            </p>
            {next ? (
              <>
                <b>{next.title}</b>
                <p>
                  {next.latest?.checkpoint.nextAction ||
                    'Try a small implementation, check it, and keep a runnable reference.'}
                </p>
                <Link
                  className="btn btn-primary"
                  to="/practice/$topicId"
                  params={{ topicId: next.id }}
                >
                  {next.latest ? 'Continue implementation' : 'Revisit through practice'}
                </Link>
              </>
            ) : (
              <p>Choose the next lesson below, then keep its implementation in Practice.</p>
            )}
          </>
        )}
        <Link className="btn btn-ghost" to="/practice">
          Practice queue & reference library
        </Link>
      </div>
    </Card>
  );
}
