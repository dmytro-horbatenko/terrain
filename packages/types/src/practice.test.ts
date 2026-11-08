import { describe, expect, it } from 'vitest';
import {
  newPracticeDraft,
  parsePracticeDraft,
  practiceCheckpointSchema,
  practiceQueue,
  practiceSession,
  type PracticeLesson,
} from './practice';

const lesson: PracticeLesson = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'RLP',
  domain: 'Web3',
  chapterTitle: 'Encoding',
  status: 'active',
  eligible: true,
  scope: 'Build an encoder; check boundaries.',
  revision: 0,
  latest: null,
  reference: null,
};
const draft = newPracticeDraft(lesson, '00000000-0000-4000-8000-000000000002');
const reference = {
  ...draft,
  status: 'reference' as const,
  acceptance: 'Round trip and malformed input',
  artifact: 'repo/rlp.ts',
  artifactVersion: 'abc123',
  command: 'yarn test',
  result: '8 checks passed',
  reflection: 'Length prefixes distinguish bytes from lists.',
  assistance: 'hints' as const,
  acceptanceMet: true,
};

describe('practice records', () => {
  it('allows partial work but requires reproducible evidence for a reference', () => {
    expect(practiceCheckpointSchema.safeParse(draft).success).toBe(true);
    expect(practiceCheckpointSchema.safeParse({ ...draft, status: 'reference' }).success).toBe(
      false,
    );
    expect(practiceCheckpointSchema.parse(reference)).toEqual(reference);
    for (const field of [
      'artifact',
      'artifactVersion',
      'command',
      'result',
      'reflection',
      'acceptance',
    ]) {
      expect(practiceCheckpointSchema.safeParse({ ...reference, [field]: ' ' }).success).toBe(
        false,
      );
    }
    expect(
      practiceCheckpointSchema.safeParse({ ...reference, backupUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
  });
  it('keeps every studied gap and old reference when a new attempt starts', () => {
    const saved = { checkpoint: reference, revision: 1, savedAt: '2026-11-01T10:00:00Z' };
    const lessons = [
      lesson,
      { ...lesson, id: 'b', reference: saved, latest: { ...saved, checkpoint: draft } },
      { ...lesson, id: 'c', status: 'planned' as const, eligible: false },
      { ...lesson, id: 'd', status: 'planned' as const },
    ];
    const queue = practiceQueue(lessons);
    expect(queue.recovery.map((l) => l.id)).toEqual([lesson.id]);
    expect(queue.active.map((l) => l.id)).toEqual(['b']);
    expect(queue.library.map((l) => l.id)).toEqual(['b']);
    expect(queue.next.map((l) => l.id)).toEqual(['d']);
  });
  it('previews imported work without certifying it or accepting a stale/foreign topic', () => {
    const fenced = '```terrain-checkpoint\n' + JSON.stringify(draft) + '\n```';
    expect(parsePracticeDraft(fenced, draft)).toEqual(draft);
    expect(() => parsePracticeDraft(fenced + '\n' + fenced, draft)).toThrow('Paste one');
    expect(parsePracticeDraft(JSON.stringify(reference), draft)).toEqual({
      ...reference,
      status: 'active',
      acceptanceMet: false,
    });
    expect(() =>
      parsePracticeDraft(JSON.stringify({ ...reference, expectedRevision: 1 }), draft),
    ).toThrow('older session');
    expect(() =>
      parsePracticeDraft(JSON.stringify({ ...reference, topicId: draft.id }), draft),
    ).toThrow('another topic');
    expect(
      parsePracticeDraft(
        JSON.stringify({ ...draft, id: '00000000-0000-4000-8000-000000000003' }),
        draft,
      ).id,
    ).toBe(draft.id);
  });
  it('exports the learner task and continuation without pretending work was done', () => {
    const text = practiceSession(
      lesson,
      { ...draft, nextAction: 'Test the 56-byte boundary' },
      { target: { sourcePlan: 'Required source' } },
    );
    expect(text).toContain('Test the 56-byte boundary');
    expect(text).toContain('Required source');
    expect(text).toContain('Do not solve or reveal a pending independent skill check');
    expect(text).toContain('never skip a topic');
  });
});
