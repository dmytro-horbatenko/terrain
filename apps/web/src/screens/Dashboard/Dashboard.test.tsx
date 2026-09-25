import { expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { meKey, qk } from '../../api/hooks';
import type { Dashboard as DashboardData } from '../../api/types';
import curriculum from '../../../../../content/projects/web3-products.json';
import Dashboard from './index';

it('keeps study and active work accessible when secondary statistics fail', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } },
  });
  const dash: DashboardData = {
    generatedAt: '2026-09-25T10:00:00Z',
    reviewStats7d: { total: 0, again: 0, againRatio: null },
    newCards: 0,
    nextUp: null,
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
    reviewDay: { dayKey: '2026-09-25', completed: false },
    pendingSessions: [],
    due: { overdue: [], dueToday: [] },
    counts: { total: 0, planned: 0, active: 0, mastered: 0, archived: 0, dueToday: 0, overdue: 0 },
  };
  client.setQueryData(meKey, { id: 'learner-a' });
  client.setQueryData(qk.dashboard(), dash);
  client.setQueryData(qk.settings, { timezone: 'UTC' });
  client.setQueryData(qk.topics, []);
  client.setQueryData(qk.heatmap(), []);
  client.setQueryData(qk.skillChecks, { today: '2026-09-25', timezone: 'UTC', checks: [] });
  client.setQueryData(qk.recentNotes, [
    {
      id: 't1',
      title: 'My Merkle notes',
      updatedAt: '2026-09-25T10:00:00Z',
      excerpt: 'Sibling paths',
    },
  ]);
  const project = curriculum.projects[0];
  client.setQueryData(qk.projects, [
    {
      projectId: project.id,
      checkpoints: [
        {
          projectId: project.id,
          milestoneId: project.milestones[0].id,
          status: 'active',
          nextAction: 'Resume this active experiment',
          createdAt: '2026-09-24T10:00:00Z',
        },
        {
          projectId: project.id,
          milestoneId: project.milestones[1].id,
          status: 'completed',
          nextAction: 'Already completed',
          createdAt: '2026-09-25T10:00:00Z',
        },
      ],
    },
  ]);
  client
    .getQueryCache()
    .build(client, { queryKey: qk.streak })
    .setState({ status: 'error', error: new Error('Statistics unavailable'), fetchStatus: 'idle' });
  const router = createRouter({
    routeTree: createRootRoute({ component: Dashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const html = renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  expect(html).toContain('Nothing due today');
  expect(html).toContain('Resume this active experiment');
  expect(html).not.toContain('Already completed');
  expect(html).toContain('href="/topics/t1#notes"');
  expect(html).toContain(
    '<details class="dashboard-details"><summary>Progress, review activity &amp; backlog</summary>',
  );
  expect(html).toContain('Review streak could not load or refresh.');
});
