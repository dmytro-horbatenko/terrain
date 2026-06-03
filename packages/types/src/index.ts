import { z } from 'zod';

export type TopicStatus = 'planned' | 'active' | 'mastered' | 'archived';
export type ReviewMode = 'telegram_quick' | 'app_log' | 'claude_session';
export type AppEventKind = 'project_usage' | 'problem_solved' | 'audit_exercise' | 'real_debugging';
export type DayType = 'active' | 'quiet' | 'frozen' | 'break';
export type SessionQuality = 'shallow' | 'normal' | 'deep';

const reviewSchema = z.object({
  topicTitle: z.string(),
  topicId: z.string().nullable().optional(),
  quality: z.number().int().min(0).max(5),
  note: z.string().optional(),
});

const proposedTopicSchema = z.object({
  title: z.string(),
  type: z.string(),
  domain: z.string(),
  description: z.string().optional(),
  prerequisiteTitles: z.array(z.string()).default([]),
  parentTitle: z.string().nullable().optional(),
  aiContext: z.string().optional(),
});

const proposedPromptSchema = z.object({
  topicTitle: z.string(),
  promptText: z.string(),
  answerHint: z.string().optional(),
  promptKind: z.enum(['concept', 'code']).default('concept'),
});

const noteSummarySchema = z.object({
  topicTitle: z.string(),
  keyInsight: z.string(),
  invariant: z.string().optional(),
  contradiction: z.string().optional(),
  suggestedNoteRef: z.string().optional(),
});

export const learningOsSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  reviews: z.array(reviewSchema),
  proposedTopics: z.array(proposedTopicSchema),
  proposedPrompts: z.array(proposedPromptSchema).default([]),
  noteSummaries: z.array(noteSummarySchema),
  nextSession: z
    .object({
      focusTitle: z.string().optional(),
      coldChallenge: z.string().optional(),
    })
    .optional(),
});

export type LearningOsOutput = z.infer<typeof learningOsSchema>;

const FENCE = /```learning-os\s*\n([\s\S]*?)\n```/;

export function parseLearningOs(raw: string): LearningOsOutput {
  const match = raw.match(FENCE);
  if (!match) {
    throw new Error('No learning-os block found in pasted output.');
  }
  const json = JSON.parse(match[1]); // throws on malformed JSON
  return learningOsSchema.parse(json); // throws on schema mismatch
}
