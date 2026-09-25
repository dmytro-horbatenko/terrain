import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { SkillCheck } from '@terrain/types';
import { qk } from '../api/hooks';
import { SkillChecksPanel } from './SkillChecksPanel';

const pending: SkillCheck = {
  plan: {
    id: '00000000-0000-4000-8000-000000000001',
    target: { kind: 'milestone', projectId: 'wallet-console', milestoneId: 'w1' },
    kind: 'diagnosis',
    learnedOn: '2026-09-03',
    dueOn: '2026-09-10',
    task: 'Find the stale account balance response in the supplied trace.',
    successCriteria: 'Explain the incorrect identity and verify the regression.',
    allowedTools: 'documentation',
  },
  targetTitle: 'Wallet W1',
  attempt: null,
  result: null,
  createdAt: '2026-09-03T12:00:00.000Z',
  attemptedAt: null,
  assessedAt: null,
  cancelledAt: null,
};
const attempt = {
  firstAttempt: 'I traced the two requests and found that the old account response arrived last.',
  evidence: 'The supplied trace confirms the account mismatch.',
  assistance: 'hints',
  helpDetails: 'The tutor suggested tracing the account identity.',
} as const;

async function render(checks: SkillCheck[], scoped = false, overview = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(qk.skillChecks, { today: '2026-09-10', timezone: 'Europe/Warsaw', checks });
  const route = createRootRoute({
    component: () => (
      <SkillChecksPanel target={scoped ? pending.plan.target : undefined} overview={overview} />
    ),
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const html = renderToString(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  client.clear();
  return html.replace(/<!-- -->/g, '');
}

describe('skill check workflow visibility', () => {
  it('puts ready work first and keeps future work in a closed overview group', async () => {
    const future = {
      ...pending,
      targetTitle: 'Future check',
      plan: { ...pending.plan, id: 'future-check', dueOn: '2026-10-01' },
    };
    const html = await render([future, pending], false, true);
    expect(html).toContain('<details><summary>Upcoming and completed checks');
    expect(html.indexOf('Wallet W1')).toBeLessThan(html.indexOf('Upcoming and completed checks'));
    expect(html.indexOf('Future check')).toBeGreaterThan(
      html.indexOf('Upcoming and completed checks'),
    );
  });
  it('shows an unattempted check without a pass or feedback control', async () => {
    const html = await render([pending]);
    expect(html).toContain('Due · no attempt yet');
    expect(html).toContain('Save first attempt');
    expect(html).not.toContain('Save assessment');
    expect(html).not.toContain('Copy saved attempt for feedback');
  });

  it('shows the saved attempt before feedback and disables passing with hints', async () => {
    const html = await render([{ ...pending, attempt, attemptedAt: '2026-09-10T12:00:00.000Z' }]);
    expect(html).toContain(attempt.firstAttempt);
    expect(html).toContain('Copy saved attempt for feedback');
    expect(html).toContain('Save assessment');
    expect(html).toMatch(/<option value="passed" disabled="">/);
    expect(html).not.toContain('Save first attempt');
  });

  it('keeps assessed history visible and identifies the actual feedback source', async () => {
    const html = await render([
      {
        ...pending,
        attempt,
        attemptedAt: '2026-09-10T12:00:00.000Z',
        assessedAt: '2026-09-10T12:10:00.000Z',
        result: {
          outcome: 'needs_practice',
          reviewer: 'human',
          feedback: 'The diagnosis needed a hint and the regression did not cover a second switch.',
          nextAction: 'Write the missing second-switch regression.',
        },
      },
    ]);
    expect(html).toContain('Needs practice · human feedback');
    expect(html).toContain('Plan a fresh variant');
    expect(html).toContain('Terrain has not independently verified it');
    expect(html).not.toContain('Save assessment');
  });

  it('filters by milestone without mixing independent topic checks', async () => {
    const topic = {
      ...pending,
      targetTitle: 'Separate nonce topic',
      plan: {
        ...pending.plan,
        id: '00000000-0000-4000-8000-000000000002',
        target: { kind: 'topic' as const, topicId: pending.plan.id },
      },
    };
    const html = await render([pending, topic], true);
    expect(html).toContain('Wallet W1');
    expect(html).not.toContain('Separate nonce topic');
    expect(html).toContain('Plan a delayed skill check');
  });
});
