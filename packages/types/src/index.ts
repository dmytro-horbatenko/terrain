import { z } from 'zod';

export type TopicStatus = 'planned' | 'active' | 'mastered' | 'archived';
export type ReviewMode = 'telegram_quick' | 'app_log' | 'claude_session';
export type AppEventKind = 'project_usage' | 'problem_solved' | 'audit_exercise' | 'real_debugging';
export type DayType = 'active' | 'quiet' | 'frozen' | 'break';
export type SessionQuality = 'shallow' | 'normal' | 'deep';

const SOURCE_FORMATS = ['article', 'book', 'video', 'course', 'documentation', 'exercise'] as const;

const sourceOptionSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    url: z.string().url().max(500),
    format: z.enum(SOURCE_FORMATS),
    scope: z.string().min(1).max(500),
    estimatedMinutes: z.number().int().min(1).max(600),
    why: z.string().min(1).max(1000),
    paid: z.boolean().optional(),
    language: z.string().min(2).max(50).optional(),
    verifiedAt: z.string().date().optional(),
    recheckAfterDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.verifiedAt == null) !== (value.recheckAfterDays == null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'verifiedAt and recheckAfterDays must appear together',
      });
    }
  });

const sourceRequirementSchema = z
  .object({
    id: z.string().min(1).max(100),
    purpose: z.string().min(1).max(1000),
    requiredWhen: z.enum(['first_exposure', 'always']),
    options: z.array(sourceOptionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.options.map((option) => option.id)).size !== value.options.length) {
      ctx.addIssue({ code: 'custom', message: 'source option ids must be unique' });
    }
  });

const requiredSourcePlanSchema = z
  .object({
    policy: z.literal('required'),
    requirements: z.array(sourceRequirementSchema).min(1).max(20),
    optional: z.array(sourceOptionSchema).max(50).optional(),
  })
  .strict();

export const sourcePlanSchema = z
  .discriminatedUnion('policy', [
    z.object({ policy: z.literal('none'), rationale: z.string().min(1).max(1000) }).strict(),
    requiredSourcePlanSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.policy === 'required') {
      const ids = value.requirements.map((requirement) => requirement.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', message: 'source requirement ids must be unique' });
      }
    }
  });

export type SourcePlan = z.infer<typeof sourcePlanSchema>;
export type SourceRequirement = Extract<SourcePlan, { policy: 'required' }>['requirements'][number];
export type SourceOption = SourceRequirement['options'][number];

const proposedTopicSchema = z
  .object({
    title: z.string().min(1).max(300),
    type: z.string(),
    domain: z.string(),
    description: z.string().max(2000).optional(),
    prerequisiteTitles: z.array(z.string()).default([]),
    parentTitle: z.string().nullable().optional(),
    aiContext: z.string().max(2000).optional(),
    sourcePlan: sourcePlanSchema.optional(),
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

const applicationEventSchema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    kind: z.enum(['project_usage', 'problem_solved', 'audit_exercise', 'real_debugging']),
    description: z.string().min(1).max(2000),
    url: z.string().url().max(500).optional(),
  })
  .strict();

const sourceEvidenceSchema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    requirementId: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(100).optional(),
    sourceTitle: z.string().min(1).max(300),
    sourceUrl: z.string().url().max(500),
    mainClaim: z.string().min(1).max(2000),
    supportingMechanism: z.string().min(1).max(2000),
    openQuestion: z.string().min(1).max(2000).nullable(),
    substitutionReason: z.string().min(1).max(2000).nullable(),
    verifiedLiveAt: z.string().datetime().nullable(),
    verificationNote: z.string().min(1).max(2000).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const curated = value.sourceId != null;
    if (curated === (value.substitutionReason != null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'curated evidence has no substitution; replacements require one',
      });
    }
    if ((value.verifiedLiveAt == null) !== (value.verificationNote == null)) {
      ctx.addIssue({ code: 'custom', message: 'live verification fields must appear together' });
    }
  });

export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

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
    applicationEvents: z.array(applicationEventSchema).max(50).default([]),
    sourceEvidence: z.array(sourceEvidenceSchema).max(50).default([]),
    studiedTopics: z.array(z.string().min(1).max(300)).max(20).optional(),
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
