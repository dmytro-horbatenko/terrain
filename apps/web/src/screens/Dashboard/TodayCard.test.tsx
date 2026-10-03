import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { meKey } from '../../api/hooks';
import type { Dashboard } from '../../api/types';
import TodayCard from './TodayCard';

const dash = (): Dashboard => ({
  generatedAt: '2026-10-03T00:00:00Z',
  reviewStats7d: { total: 0, again: 0, againRatio: null },
  newCards: 0,
  nextUp: {
    topic: {
      id: 'evm',
      title: 'The EVM as a state machine',
      domain: 'Web3',
      topicType: 'concept',
      status: 'planned',
      description: 'Trace the transition from pre-state to post-state.',
      summary: null,
      noteRef: null,
      parentId: 'chapter',
      nextReviewAt: null,
      learnedAt: null,
      aiProposed: true,
      aiContext: null,
      sourcePlan: null,
      createdAt: '',
      updatedAt: '',
    },
    chapterTitle: 'EVM execution model',
    chapterProgress: { started: 1, total: 5 },
    sourcePlanStats: { requiredCount: 0, estimatedMinutes: 0, hasExpired: false },
  },
  sessionQueueCount: 0,
  sessionQueueMinutes: 0,
  reviewQueue: {
    items: [],
    estimatedMinutes: 0,
    budgetMinutes: 15,
    backlogCount: 0,
    backlogMinutes: 0,
    deferredExercises: [],
  },
  reviewDay: { dayKey: '2026-10-03', completed: false },
  pendingSessions: [],
  due: { overdue: [], dueToday: [] },
  counts: { total: 21, planned: 5, active: 16, mastered: 0, archived: 0, dueToday: 0, overdue: 0 },
});
async function render(d: Dashboard) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(meKey, { id: 'learner' });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <TodayCard dash={d} /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const html = renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}
describe('current learning step', () => {
  it('does not claim curriculum completion when no next topic is queued', async () => {
    const d = dash();
    d.nextUp = null;
    d.counts.planned = 0;
    expect(await render(d)).not.toContain('Curriculum complete');
  });
  it('offers the exact current lesson scope and its chapter', async () => {
    const html = await render(dash());
    expect(html).toContain('Trace the transition from pre-state to post-state.');
    expect(html).toContain('href="/topics/evm"');
    expect(html).toContain('focus=chapter');
    expect(html).toContain('1 of 5 started');
    expect(html).not.toContain('Independent check passed');
  });
  it('continues the pending session for that lesson without changing its focus', async () => {
    const d = dash();
    d.pendingSessions = [
      {
        id: 'session',
        mode: 'learn',
        focusTopicId: 'evm',
        topicTitle: d.nextUp!.topic.title,
        generatedAt: '',
        approach: 'guided',
      },
    ];
    const html = await render(d);
    expect(html).toContain('Continue learning');
    expect(html).toContain('topic=evm');
    expect(html).toContain('not imported yet');
  });
});
