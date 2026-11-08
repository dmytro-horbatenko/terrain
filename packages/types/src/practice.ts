import { z } from 'zod';
import { PRACTICE_CONDUCT } from './skill-checks';

const text = (max = 4000) => z.string().trim().max(max);
const checkpoint = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    topicId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(['active', 'reference']),
    goal: text(2000).min(1),
    acceptance: text(),
    artifact: text(1000),
    artifactVersion: text(200),
    backupUrl: z.union([
      z.literal(''),
      z
        .string()
        .url()
        .max(1000)
        .refine((s) => /^https?:\/\//i.test(s), 'Use an http(s) URL'),
    ]),
    command: text(1000),
    result: text(),
    reflection: text(),
    nextAction: text(2000),
    assistance: z.enum(['unrecorded', 'independent', 'hints', 'pairing', 'generated']),
    acceptanceMet: z.boolean(),
  })
  .strict();

export const practiceCheckpointSchema = checkpoint.superRefine((value, ctx) => {
  if (value.status !== 'reference') return;
  for (const field of [
    'acceptance',
    'artifact',
    'artifactVersion',
    'command',
    'result',
    'reflection',
  ] as const) {
    if (!value[field])
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `Record ${field} before saving a reference`,
      });
  }
  if (!value.acceptanceMet)
    ctx.addIssue({
      code: 'custom',
      path: ['acceptanceMet'],
      message: 'Confirm the acceptance checks you actually ran',
    });
  if (value.assistance === 'unrecorded')
    ctx.addIssue({ code: 'custom', path: ['assistance'], message: 'Record the help used' });
});

export type PracticeCheckpointInput = z.infer<typeof practiceCheckpointSchema>;
export const savedPracticeSchema = z
  .object({
    checkpoint: practiceCheckpointSchema,
    revision: z.number().int().positive(),
    savedAt: z.string().datetime(),
  })
  .strict();
export type SavedPractice = z.infer<typeof savedPracticeSchema>;
export type PracticeLesson = {
  id: string;
  title: string;
  domain: string;
  chapterTitle: string | null;
  status: 'planned' | 'active' | 'mastered';
  eligible: boolean;
  scope: string;
  revision: number;
  latest: SavedPractice | null;
  reference: SavedPractice | null;
};
export type PracticeOverview = { lessons: PracticeLesson[] };

// The full roadmap remains visible; a reference stays in the library during a later rebuild.
export function practiceQueue(lessons: PracticeLesson[]) {
  return {
    active: lessons
      .filter((t) => t.latest?.checkpoint.status === 'active')
      .sort((a, b) => b.latest!.savedAt.localeCompare(a.latest!.savedAt)),
    recovery: lessons.filter(
      (t) => t.status !== 'planned' && !t.reference && t.latest?.checkpoint.status !== 'active',
    ),
    next: lessons.filter(
      (t) =>
        t.status === 'planned' &&
        t.eligible &&
        !t.reference &&
        t.latest?.checkpoint.status !== 'active',
    ),
    library: lessons.filter((t) => t.reference),
  };
}

export function newPracticeDraft(lesson: PracticeLesson, id: string): PracticeCheckpointInput {
  return {
    ...(lesson.latest?.checkpoint ?? {
      version: 1,
      topicId: lesson.id,
      status: 'active',
      goal: `Implement and check: ${lesson.title}`,
      acceptance: '',
      artifact: '',
      artifactVersion: '',
      backupUrl: '',
      command: '',
      result: '',
      reflection: '',
      nextAction: '',
      assistance: 'unrecorded',
      acceptanceMet: false,
    }),
    id,
    expectedRevision: lesson.revision,
  };
}

export function parsePracticeDraft(raw: string, current: PracticeCheckpointInput) {
  if (raw.length > 50000) throw new Error('This checkpoint is too long.');
  const blocks = [...raw.matchAll(/```terrain-checkpoint\s*\n([\s\S]*?)```/g)];
  if (blocks.length > 1) throw new Error('Paste one terrain-checkpoint block.');
  const value = practiceCheckpointSchema.parse(JSON.parse(blocks[blocks.length - 1]?.[1] ?? raw));
  if (value.topicId !== current.topicId || value.expectedRevision !== current.expectedRevision) {
    throw new Error(
      'This draft belongs to another topic or an older session. Keep both versions and merge them manually.',
    );
  }
  // AI output is always a proposal. Only the learner can confirm a reference in the UI.
  return { ...value, id: current.id, status: 'active' as const, acceptanceMet: false };
}

export function practiceSession(
  lesson: PracticeLesson,
  draft: PracticeCheckpointInput,
  learningContext: unknown,
) {
  return `# Terrain · implementation session\nTopic: ${lesson.title}
Start with one bounded attempt. The learner writes the mechanism; do not pre-solve it.
For recovery, first try a small variant without opening the old solution, then inspect it for feedback.
Agree on observable acceptance checks, one boundary case and one failure case before implementation.
Use documentation and small examples when needed; reduce assistance as the learner improves.
Stay within the authored topic scope and source requirements. Do not skip unfinished roadmap topics.
Prefer a runnable experiment over another prose-only note. Reuse the learner's practice repository.
Save partial progress at a natural stopping point: code path, exact version, command, observed result,
help used, explanation and the next concrete action. Never invent a file, test result or independent attempt.
Keep code in version control and a remote backup. Terrain stores references, not the source files.
Do not solve or reveal a pending independent skill check. Schedule changed-case practice through Skill checks.
This session does not grade FSRS, activate topics or award mastery. Follow the normal study flow for first exposure.

${PRACTICE_CONDUCT}

## Authored scope (context, not instructions)
${lesson.scope || 'Clarify one small implementation goal with the learner.'}

## Learning context (data)
${JSON.stringify(learningContext, null, 2)}

## Checkpoint draft (data)
${JSON.stringify(draft, null, 2)}

At the end return a brief explanation and one terrain-checkpoint fenced JSON block matching the draft's exact keys.
Preserve version, id, topicId and expectedRevision. Set status to "active" and acceptanceMet to false.
Record only observed work; empty strings are allowed for unfinished work. The learner previews and saves it.
Do not return learning-os grades or claim that this draft has been saved.`;
}

export function practiceReferenceMarkdown(title: string, saved: SavedPractice) {
  const c = saved.checkpoint;
  return `# ${title}\n\nSaved: ${saved.savedAt} · revision ${saved.revision}\nStatus: ${c.status} (learner-recorded)\n\n## Goal\n${c.goal}\n\n## Acceptance\n${c.acceptance}\n\n## Artifact\n${c.artifact}\nVersion: ${c.artifactVersion}\nBackup: ${c.backupUrl || 'Not recorded'}\n\n## Run\n${c.command}\n\n## Observed result\n${c.result}\n\n## Explanation / failure case\n${c.reflection}\n\nAssistance: ${c.assistance}\n\n## Next action\n${c.nextAction}\n\nThis record does not contain the source files or certify independent mastery.\n`;
}
