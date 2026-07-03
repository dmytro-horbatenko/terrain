import { interleaveQueue, type SessionQueueItem } from './interleave';

function item(overrides: Partial<SessionQueueItem> & { promptId: string }): SessionQueueItem {
  return {
    topicId: 't1',
    topicTitle: 'Topic',
    chapterTitle: 'Chapter A',
    kind: 'concept',
    isNew: false,
    nextReviewAt: new Date('2026-07-01T00:00:00Z'),
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('interleaveQueue', () => {
  it('round-robins across chapters, most-overdue chapter first', () => {
    const items = [
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'a2', chapterTitle: 'A', nextReviewAt: new Date('2026-07-02T00:00:00Z') }),
      item({ promptId: 'b1', chapterTitle: 'B', nextReviewAt: new Date('2026-06-28T00:00:00Z') }),
      item({ promptId: 'b2', chapterTitle: 'B', nextReviewAt: new Date('2026-07-03T00:00:00Z') }),
      item({ promptId: 'c1', chapterTitle: 'C', nextReviewAt: new Date('2026-06-30T00:00:00Z') }),
    ];
    // B holds the most-overdue card (06-28), then C (06-30), then A (07-01).
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['b1', 'c1', 'a1', 'b2', 'a2']);
  });

  it('degenerates to nextReviewAt asc for a single chapter', () => {
    const items = [
      item({ promptId: 'p2', nextReviewAt: new Date('2026-07-02T00:00:00Z') }),
      item({ promptId: 'p1', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'p3', nextReviewAt: new Date('2026-07-03T00:00:00Z') }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('sorts new cards (null nextReviewAt) after due cards within a chapter, by createdAt', () => {
    const items = [
      item({
        promptId: 'new2',
        isNew: true,
        nextReviewAt: null,
        createdAt: new Date('2026-06-20T00:00:00Z'),
      }),
      item({ promptId: 'due1', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({
        promptId: 'new1',
        isNew: true,
        nextReviewAt: null,
        createdAt: new Date('2026-06-10T00:00:00Z'),
      }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['due1', 'new1', 'new2']);
  });

  it('mixes new cards mid-queue via round-robin, not appended at the end', () => {
    const items = [
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'aNew', chapterTitle: 'A', isNew: true, nextReviewAt: null }),
      item({ promptId: 'b1', chapterTitle: 'B', nextReviewAt: new Date('2026-06-30T00:00:00Z') }),
      item({ promptId: 'b2', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T06:00:00Z') }),
      item({ promptId: 'b3', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T12:00:00Z') }),
    ];
    const order = interleaveQueue(items).map((i) => i.promptId);
    // Round 0: b1, a1. Round 1: b2, aNew. Round 2: b3.
    expect(order).toEqual(['b1', 'a1', 'b2', 'aNew', 'b3']);
    expect(order[order.length - 1]).not.toBe('aNew');
  });

  it('an all-new chapter sorts after chapters with due cards', () => {
    const items = [
      item({ promptId: 'nNew', chapterTitle: 'N', isNew: true, nextReviewAt: null }),
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['a1', 'nNew']);
  });

  it('is deterministic and length-preserving', () => {
    const items = [
      item({ promptId: 'x', chapterTitle: 'A' }),
      item({ promptId: 'y', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'z', chapterTitle: 'B', isNew: true, nextReviewAt: null }),
    ];
    const first = interleaveQueue(items);
    const second = interleaveQueue(items);
    expect(second).toEqual(first);
    expect(first).toHaveLength(items.length);
  });

  it('handles an empty input', () => {
    expect(interleaveQueue([])).toEqual([]);
  });
});
