import { z } from 'zod';

export type TopicStatus = 'planned' | 'active' | 'mastered' | 'archived';
export type ReviewMode = 'telegram_quick' | 'app_log' | 'claude_session';
export type AppEventKind = 'project_usage' | 'problem_solved' | 'audit_exercise' | 'real_debugging';
export type DayType = 'active' | 'quiet' | 'frozen' | 'break';
export type SessionQuality = 'shallow' | 'normal' | 'deep';

const proposedTopicSchema = z
  .object({
    title: z.string().min(1).max(300),
    type: z.string(),
    domain: z.string(),
    description: z.string().max(2000).optional(),
    prerequisiteTitles: z.array(z.string()).default([]),
    parentTitle: z.string().nullable().optional(),
    aiContext: z.string().max(2000).optional(),
  })
  .strict();

const noteSummarySchema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    keyInsight: z.string().max(2000),
    invariant: z.string().max(2000).optional(),
    contradiction: z.string().max(2000).optional(),
    suggestedNoteRef: z.string().max(2000).optional(),
  })
  .strict();

export const GRADES = ['again', 'hard', 'good', 'easy'] as const;
export type Grade = (typeof GRADES)[number];

const reviewV2Schema = z
  .object({
    promptId: z.string().uuid().optional(),
    topicTitle: z.string().min(1).max(300).optional(),
    grade: z.enum(GRADES),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine((r) => r.promptId != null || r.topicTitle != null, {
    message: 'review needs promptId or topicTitle',
  });

const proposedPromptV2Schema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    promptText: z.string().min(1).max(2000),
    answerHint: z.string().max(2000).optional(),
    promptKind: z.enum(['concept', 'code', 'problem']).default('concept'),
    url: z.string().url().max(500).optional(),
    problemDifficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    estimatedMinutes: z.number().int().min(1).max(240).optional(),
  })
  .strict();

export const learningOsV2Schema = z
  .object({
    version: z.literal(2),
    sessionId: z.string().max(100).nullable().optional(),
    reviews: z.array(reviewV2Schema).max(200).default([]),
    proposedTopics: z.array(proposedTopicSchema).max(200).default([]),
    proposedPrompts: z.array(proposedPromptV2Schema).max(500).default([]),
    noteSummaries: z.array(noteSummarySchema).max(200).default([]),
    nextSession: z
      .object({
        focusTitle: z.string().max(300).nullable().optional(),
        coldChallenge: z.string().max(500).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type LearningOsV2 = z.infer<typeof learningOsV2Schema>;

const FENCE = /```learning-os\s*\n([\s\S]*?)```/g;

export function extractLearningOsBlock(raw: string): string | null {
  let last: string | null = null;
  for (const m of raw.matchAll(FENCE)) last = m[1];
  return last;
}

export class LearningOsParseError extends Error {
  constructor(
    public readonly code: 'no-block' | 'invalid-json' | 'unsupported-version' | 'schema',
    message: string,
  ) {
    super(message);
  }
}

export function parseLearningOs(raw: string): LearningOsV2 {
  const block = extractLearningOsBlock(raw);
  if (!block) throw new LearningOsParseError('no-block', 'no learning-os block found');
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    throw new LearningOsParseError('invalid-json', 'learning-os block is not valid JSON');
  }
  const version = z.object({ version: z.number() }).passthrough().safeParse(json);
  if (!version.success || version.data.version !== 2) {
    throw new LearningOsParseError(
      'unsupported-version',
      `unsupported learning-os version ${version.success ? version.data.version : '<missing>'} — regenerate the export and re-run the session`,
    );
  }
  const parsed = learningOsV2Schema.safeParse(json);
  if (!parsed.success) throw new LearningOsParseError('schema', parsed.error.message);
  return parsed.data;
}
