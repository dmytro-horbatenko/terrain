import { expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { PracticeLesson } from '@terrain/types';
import { qk } from '../../api/hooks';
import PracticeScreen from './index';

it('exposes recovery, next study and blocked coverage without inventing references', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const base: PracticeLesson = {
    id: 'studied',
    title: 'Raw RPC',
    domain: 'Web3',
    chapterTitle: 'Nodes',
    status: 'active',
    eligible: true,
    scope: 'Build a client',
    revision: 0,
    latest: null,
    reference: null,
  };
  client.setQueryData(qk.practice, {
    lessons: [
      base,
      { ...base, id: 'next', title: 'Storage slots', status: 'planned' },
      { ...base, id: 'later', title: 'MPT', status: 'planned', eligible: false },
    ],
  });
  const router = createRouter({
    routeTree: createRootRoute({ component: PracticeScreen }),
    history: createMemoryHistory({ initialEntries: ['/practice'] }),
  });
  await router.load();
  const html = renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  expect(html).toContain('Revisit studied topics');
  expect(html).toContain('href="/practice/studied"');
  expect(html).toContain('Storage slots');
  expect(html).toContain('MPT');
  expect(html).toContain('Upcoming');
  expect(html).not.toContain('Reference saved');
  expect(html).toContain('Full coverage');
});
