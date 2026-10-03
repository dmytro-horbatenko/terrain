import { describe, expect, it } from 'vitest';
import {
  parseNoteReview,
  readPendingReviews,
  storePendingReview,
  removePendingReview,
} from './noteReviewDraft';
const draft = {
  version: 1,
  id: 'ba393504-46ed-4bb0-bbe4-e446cd2f6484',
  topicId: '051ac96c-5139-41c8-9b05-c74a0447e335',
  kind: 'notes',
  baseRevision: 1,
  baseSha256: 'a'.repeat(64),
  body: 'Мой конспект',
  reason: 'Clarify',
  sourcesChecked: [],
} as const;
const block = '```note-review\n' + JSON.stringify(draft) + '\n```';
describe('note proposals outside learning-os v2', () => {
  it('reads the single proposal alongside learning data and unrelated code', () => {
    expect(
      parseNoteReview('```js\nconst n=1;\n```\n' + block + '\n```learning-os\n{"version":2}\n```'),
    ).toEqual(draft);
    expect(parseNoteReview('```learning-os\n{"version":2}\n```')).toBeNull();
    expect(parseNoteReview(JSON.stringify(draft))).toEqual(draft);
  });
  it('ignores a quoted proposal inside a longer Markdown fence', () => {
    expect(parseNoteReview('````markdown\n' + block + '\n````')).toBeNull();
  });
  it.each([
    block + '\n' + block,
    '```note-review\n{}\n```',
    '```note-review\nnot-json\n```',
    '```note-review\n{}',
  ])('rejects duplicate or broken proposals without silently dropping them', (raw) => {
    expect(() => parseNoteReview(raw)).toThrow();
  });
  it('restores the pending note after partial save only in its own account', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    storePendingReview('owner', { draft: { ...draft, sourcesChecked: [] }, ready: true }, storage);
    expect(readPendingReviews('owner', storage)[0]).toMatchObject({
      ready: true,
      draft: { body: 'Мой конспект' },
    });
    expect(readPendingReviews('other', storage)).toEqual([]);
    removePendingReview('owner', draft.id, storage);
    expect(readPendingReviews('owner', storage)).toEqual([]);
  });
  it('retains the linked session for reconciling a learning commit after a lost response', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const sessionId = '8763a040-edea-4ba2-b9bd-79be7ef23e4e';
    storePendingReview(
      'owner',
      { draft: { ...draft, sourcesChecked: [] }, ready: false, sessionId },
      storage,
    );
    expect(readPendingReviews('owner', storage)[0]).toMatchObject({ ready: false, sessionId });
    expect(readPendingReviews('other', storage)).toEqual([]);
  });
});
