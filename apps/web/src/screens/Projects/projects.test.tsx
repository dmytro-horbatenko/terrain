import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { router } from '../../app/router';
import { qk } from '../../api/hooks';
import type { ProjectProgress } from '@terrain/types';

async function render(path: string, progress: ProjectProgress[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(qk.projects, progress);
  client.setQueryData(qk.topics, []);
  client.setQueryData(qk.skillChecks, {
    today: '2026-09-03',
    timezone: 'Europe/Warsaw',
    checks: [],
  });
  const instance = createRouter({
    routeTree: router.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await instance.load();
  const result = renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={instance} />
    </QueryClientProvider>,
  );
  client.clear();
  return result;
}

describe('visible product curriculum', () => {
  it('renders the complete catalog with direct access to wallet W1', async () => {
    const html = await render('/projects');
    expect(html).toContain('Web3 Product Engineering');
    expect(html).toContain('76');
    expect(html).toContain('Open wallet milestone W1');
    expect(html).toContain('Cross-chain order fulfillment');
    expect(html).toContain('Production-style capstone');
  });

  it('opens a deep-linked wallet milestone with its specific assessment and checkpoint form', async () => {
    const html = await render('/projects/wallet-console?milestone=w4');
    expect(html).toContain('W4 · Nonce, replacement');
    expect(html).toContain('Disable automining');
    expect(html).toContain('Independent defense');
    expect(html).toContain('Next concrete action');
    expect(html).toContain('Save checkpoint');
    expect(html).toContain('Plan a delayed skill check');
    expect(html).toContain('<option value="" selected="">Choose actual help</option>');
  });

  it('resumes this project’s active milestone independently of topic study', async () => {
    const html = await render('/projects/wallet-console', [
      {
        projectId: 'wallet-console',
        revision: 1,
        repositoryUrl: '',
        checkpoints: [
          {
            id: '9ddc8b31-8d49-4aad-b6ac-887095d3bb88',
            curriculumVersion: '2026-09-03.1',
            projectId: 'wallet-console',
            milestoneId: 'w2',
            expectedRevision: 0,
            status: 'active',
            repositoryUrl: '',
            notes: 'Provider selection implemented.',
            evidence: '',
            reflection: '',
            nextAction: 'Reproduce an account change during connection.',
            assistance: 'hints',
            checkedCriteria: [],
            createdAt: '2026-09-03T12:00:00.000Z',
          },
          {
            id: '7caf348d-46a2-4b67-a688-c0e1d8445daf',
            curriculumVersion: '2026-09-03.1',
            projectId: 'wallet-console',
            milestoneId: 'w1',
            expectedRevision: 0,
            status: 'active',
            repositoryUrl: '',
            notes: 'An older unfinished milestone.',
            evidence: '',
            reflection: '',
            nextAction: 'Older next action.',
            assistance: 'independent',
            checkedCriteria: [],
            createdAt: '2026-09-03T11:00:00.000Z',
          },
        ],
      },
    ]);
    expect(html).toContain('Provider selection implemented.');
    expect(html).toContain('Reproduce an account change during connection.');
    expect(html).toContain('In progress');
  });
});
