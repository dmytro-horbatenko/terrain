/**
 * Interleaving for the review-session queue (learning-science Stage 3).
 * Pure and deterministic: cards are bucketed by chapter, ordered within each
 * bucket (due by nextReviewAt asc, then new cards), and emitted round-robin
 * across buckets so consecutive cards differ in chapter wherever the due set
 * allows it.
 */

export interface SessionQueueItem {
  promptId: string;
  topicId: string;
  topicTitle: string;
  chapterTitle: string;
  kind: string;
  isNew: boolean;
  nextReviewAt: Date | null;
  createdAt: Date;
}

/** New cards (null nextReviewAt) sort after every due card. */
function dueKey(item: SessionQueueItem): number {
  return item.nextReviewAt ? item.nextReviewAt.getTime() : Number.POSITIVE_INFINITY;
}

export function interleaveQueue<T extends SessionQueueItem>(items: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const bucket = buckets.get(item.chapterTitle);
    if (bucket) bucket.push(item);
    else buckets.set(item.chapterTitle, [item]);
  }

  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        dueKey(a) - dueKey(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.promptId.localeCompare(b.promptId),
    );
  }

  const ordered = [...buckets.entries()]
    .sort((a, b) => dueKey(a[1][0]) - dueKey(b[1][0]) || a[0].localeCompare(b[0]))
    .map(([, bucket]) => bucket);

  const out: T[] = [];
  for (let round = 0; out.length < items.length; round++) {
    for (const bucket of ordered) {
      if (round < bucket.length) out.push(bucket[round]);
    }
  }
  return out;
}
