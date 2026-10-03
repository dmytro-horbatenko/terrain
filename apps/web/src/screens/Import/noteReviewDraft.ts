import { noteReviewDraftSchema, parseLearningOs, type NoteReviewDraft } from '@terrain/types';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type PendingReview = { draft: NoteReviewDraft; ready: boolean; sessionId?: string };
export function linkedSessionId(raw: string): string | undefined {
  try {
    return parseLearningOs(raw).sessionId || undefined;
  } catch {
    return undefined;
  }
}

export function parseNoteReview(raw: string): NoteReviewDraft | null {
  if (raw.length > 1200000) throw new Error('The pasted output is too long.');
  const blocks: string[] = [];
  let fence: { char: string; size: number; note: boolean; lines: string[] } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) {
      if (marker)
        fence = {
          char: marker[1][0],
          size: marker[1].length,
          note: marker[2].trim() === 'note-review',
          lines: [],
        };
    } else if (
      marker &&
      marker[1][0] === fence.char &&
      marker[1].length >= fence.size &&
      !marker[2].trim()
    ) {
      if (fence.note) blocks.push(fence.lines.join('\n'));
      fence = null;
    } else if (fence.note) fence.lines.push(line);
  }
  if (fence?.note) throw new Error('The note-review block is unfinished.');
  if (blocks.length > 1) throw new Error('Paste one note-review proposal at a time.');
  let value: unknown;
  if (blocks.length) {
    try {
      value = JSON.parse(blocks[0]);
    } catch {
      throw new Error('The note-review block is not valid JSON.');
    }
  } else {
    try {
      const json = JSON.parse(raw);
      if (json && (json.kind === 'notes' || json.kind === 'reference')) value = json;
      else return null;
    } catch {
      return null;
    }
  }
  const parsed = noteReviewDraftSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      'Invalid note-review proposal: check its fields, revision, hash and source URLs.',
    );
  return parsed.data;
}

const key = (userId: string) => `terrain:note-review:${userId}`;
export function readPendingReviews(userId: string, storage?: Storage): PendingReview[] {
  try {
    const value = JSON.parse((storage ?? sessionStorage).getItem(key(userId)) ?? '[]');
    if (!Array.isArray(value) || value.length > 20) return [];
    return value.flatMap((item) => {
      const parsed = noteReviewDraftSchema.safeParse(item?.draft);
      return parsed.success && typeof item.ready === 'boolean'
        ? [
            {
              draft: parsed.data,
              ready: item.ready,
              ...(typeof item.sessionId === 'string' && item.sessionId.length <= 100
                ? { sessionId: item.sessionId }
                : {}),
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
export function storePendingReview(
  userId: string,
  pending: PendingReview,
  storage?: Storage,
): boolean {
  try {
    const target = storage ?? sessionStorage;
    const list = readPendingReviews(userId, target).filter(
      (item) => item.draft.id !== pending.draft.id,
    );
    if (list.length >= 20) return false;
    target.setItem(key(userId), JSON.stringify([...list, pending]));
    return true;
  } catch {
    return false;
  }
}
export function removePendingReview(userId: string, id: string, storage?: Storage): boolean {
  try {
    const target = storage ?? sessionStorage;
    target.setItem(
      key(userId),
      JSON.stringify(readPendingReviews(userId, target).filter((item) => item.draft.id !== id)),
    );
    return true;
  } catch {
    return false;
  }
}
