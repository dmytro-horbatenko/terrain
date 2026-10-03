import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { NoteReviewDiff, type NoteReviewDiffProps } from './NoteReviewDiff';
const props: NoteReviewDiffProps = {
  draft: {
    version: 1,
    id: 'ba393504-46ed-4bb0-bbe4-e446cd2f6484',
    topicId: '051ac96c-5139-41c8-9b05-c74a0447e335',
    kind: 'notes',
    baseRevision: 1,
    baseSha256: 'a'.repeat(64),
    body: 'Clearer explanation',
    reason: 'Clarify aliasing',
    sourcesChecked: [],
  },
  current: {
    body: 'Existing learner explanation',
    revision: 1,
    sha256: 'a'.repeat(64),
    updatedAt: null,
    origin: 'learner',
    review: null,
  },
  ready: true,
  pending: false,
  onApply: () => {},
  onKeep: () => {},
};
async function render(over: Partial<NoteReviewDiffProps> = {}) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <NoteReviewDiff {...props} {...over} /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}
describe('AI proposal acceptance', () => {
  it('shows both actual texts and disables acceptance when the saved base changed', async () => {
    const html = await render({
      current: { ...props.current, revision: 2, body: 'Latest device edit' },
    });
    expect(html).toContain('Latest device edit');
    expect(html).toContain('Clearer explanation');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply reviewed notes/);
    expect(html).toContain('href="/topics/051ac96c-5139-41c8-9b05-c74a0447e335#notes"');
  });
  it('waits for the learning record before enabling a session note save', async () => {
    expect(await render({ ready: false })).toMatch(
      /<button[^>]*disabled=""[^>]*>Apply reviewed notes/,
    );
    expect(await render()).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply reviewed notes/);
  });
  it('permits a no-change review without presenting it as new learning', async () => {
    const html = await render({ draft: { ...props.draft, body: props.current.body } });
    expect(html).toContain('No text changes');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply reviewed notes/);
    expect(html).not.toContain('Independent check passed');
  });
  it('recognizes a committed proposal after a lost response while preserving a newer edit', async () => {
    const html = await render({
      current: { ...props.current, revision: 3, body: 'Later manual edit' },
      applied: {
        reviewId: props.draft.id,
        topicId: props.draft.topicId,
        kind: 'notes',
        body: props.draft.body,
        revision: 2,
        updatedAt: null,
        changed: true,
      },
    });
    expect(html).toContain('This proposal was already saved');
    expect(html).toContain('Later manual edit');
    expect(html).toContain('Dismiss saved proposal');
    expect(html).not.toContain('>Apply reviewed notes<');
  });
});
