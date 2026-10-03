import { describe, expect, it } from 'vitest';
import { noteReviewDraftSchema } from './note-review';

const draft = {
  version: 1,
  id: 'ba393504-46ed-4bb0-bbe4-e446cd2f6484',
  topicId: '051ac96c-5139-41c8-9b05-c74a0447e335',
  kind: 'notes',
  baseRevision: 1,
  baseSha256: 'a'.repeat(64),
  body: '  Конспект\n',
  reason: 'Clarify reference types',
  sourcesChecked: [
    {
      url: 'https://docs.soliditylang.org/en/latest/types.html',
      checkedAt: '2026-10-03T10:00:00Z',
      scope: 'Data location',
    },
  ],
};
describe('note review boundary', () => {
  it('preserves exact UTF-8 text for revision comparison', () => {
    expect(noteReviewDraftSchema.parse(draft).body).toBe('  Конспект\n');
  });
  it.each([
    { grades: ['easy'] },
    { applicationEvents: [] },
    { baseRevision: -1 },
    { baseRevision: 2147483647 },
    { baseSha256: 'A'.repeat(64) },
    { id: 'not-a-uuid' },
    { topicId: '' },
    { kind: 'summary' },
    { body: 'x'.repeat(100001) },
    { sourcesChecked: [{ ...draft.sourcesChecked[0], url: 'javascript:alert(1)' }] },
    { sourcesChecked: [{ ...draft.sourcesChecked[0], checkedAt: 'yesterday' }] },
    { sourcesChecked: Array(31).fill(draft.sourcesChecked[0]) },
  ])('rejects malformed proposals and learning mutations: %j', (change) => {
    expect(noteReviewDraftSchema.safeParse({ ...draft, ...change }).success).toBe(false);
  });
});
