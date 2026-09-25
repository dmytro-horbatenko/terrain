import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { meKey, qk } from '../api/hooks';
import { router as appRouter } from '../app/router';
import { TopicDetailPanel } from './TopicDetailPanel';

async function renderTopic(refreshError = false, cached = true, directUrl = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } },
  });
  client.setQueryData(meKey, { id: 'learner-a' });
  client.setQueryData(qk.topic('t1'), {
    id: 't1',
    title: 'Merkle proof',
    domain: 'Web3',
    topicType: 'concept',
    status: 'active',
    description: 'Verify inclusion',
    summary: '**Key insight:** Hash the sibling path.',
    noteRef: 'https://example.com/reference',
    learnedAt: '2026-09-20T10:00:00Z',
    children: [],
    blockers: [],
    labels: { blocked: false, reviewing: false },
    prompts: [],
    mastery: { retention: false, application: false, teaching: true, eligible: false },
    appEventCount: 0,
    appEvents: [],
    prerequisites: [],
    dependents: [],
    reviews: [],
    sourceEvidence: [],
  });
  if (refreshError) {
    client
      .getQueryCache()
      .find({ queryKey: qk.topic('t1') })!
      .setState({
        status: 'error',
        error: new Error('Network interrupted'),
        fetchStatus: 'idle',
        ...(!cached ? { data: undefined } : {}),
      });
  }
  client.setQueryData(qk.topicNotes('t1'), {
    body: 'My own explanation',
    revision: 1,
    updatedAt: null,
  });
  client.setQueryData(qk.settings, { timezone: 'UTC', obsidianVault: null });
  client.setQueryData(qk.skillChecks, { today: '2026-09-25', timezone: 'UTC', checks: [] });
  client.setQueryData(qk.streak, { currentStreak: 0, longestStreak: 0, freezeBalance: 0 });
  const route = createRootRoute({ component: () => <TopicDetailPanel topicId="t1" /> });
  const router = createRouter({
    routeTree: directUrl ? appRouter.routeTree : route,
    history: createMemoryHistory({ initialEntries: [directUrl ? '/topics/t1#notes' : '/'] }),
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

describe('topic knowledge comes before management', () => {
  it('opens a bookmarked topic URL directly with its notes and full reading layout', async () => {
    const html = await renderTopic(false, true, true);
    expect(html).toContain('class="page topic-page"');
    expect(html).toContain('<h1 class="topic-title">Merkle proof</h1>');
    expect(html).toContain('My own explanation');
    expect(html).toContain('href="#session-summary"');
    expect(html).not.toContain('Open full page');
  });
  it('offers a permanent reading URL from the quick view and anchors the note separately', async () => {
    const html = await renderTopic();
    expect(html).toContain('href="/topics/t1"');
    expect(html).toContain('id="notes"');
    expect(html).toContain('id="session-summary"');
  });
  it('surfaces learner notes, readable summary and dated evidence before collapsed editing', async () => {
    const html = await renderTopic();
    expect(html).toContain('My own explanation');
    expect(html).toContain('<strong>Key insight:</strong>');
    expect(html).toContain('href="https://example.com/reference"');
    expect(html.indexOf('My own explanation')).toBeLessThan(html.indexOf('Manage topic'));
    expect(html).toContain('Recall evidence');
    expect(html).toContain('No independent check recorded');
  });

  it('keeps the notes subtree present when a cached topic refresh fails, preventing draft unmount', async () => {
    const html = await renderTopic(true);
    expect(html).toContain('aria-label="Your notes"');
    expect(html).toContain('My own explanation');
    expect(html).toContain('aria-label="Notes view"');
    expect(html).toContain('Network interrupted');
  });

  it('shows an initial error when no cached topic exists', async () => {
    const html = await renderTopic(true, false);
    expect(html).toContain('Network interrupted');
    expect(html).not.toContain('aria-label="Your notes"');
  });
});
