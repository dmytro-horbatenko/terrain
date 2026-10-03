import { z } from 'zod';
import type { SourcePlan } from './index';
export const noteReviewDraftSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    topicId: z.string().uuid(),
    kind: z.enum(['notes', 'reference']),
    baseRevision: z.number().int().min(0).max(2147483646),
    baseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    body: z.string().max(100000),
    reason: z.string().trim().min(1).max(2000),
    sourcesChecked: z
      .array(
        z
          .object({
            url: z
              .string()
              .url()
              .max(2000)
              .refine((url) => /^https?:\/\//i.test(url), 'Use an HTTP(S) source.'),
            checkedAt: z.string().datetime({ offset: true }),
            scope: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export type NoteReviewDraft = z.infer<typeof noteReviewDraftSchema>;
export type WritingKind = NoteReviewDraft['kind'];
export interface TopicWriting {
  body: string;
  revision: number;
  sha256: string;
  updatedAt: string | null;
  origin: 'learner' | 'ai' | 'migration' | 'unknown';
  review: {
    reviewedAt: string;
    reason: string;
    sourcesChecked: NoteReviewDraft['sourcesChecked'];
  } | null;
}
export interface NoteReviewPreview {
  draft: NoteReviewDraft;
  current: TopicWriting;
  stale: boolean;
  changed: boolean;
  applied: NoteReviewResult | null;
}
export interface NoteReviewResult {
  reviewId: string;
  topicId: string;
  kind: WritingKind;
  body: string;
  revision: number;
  updatedAt: string | null;
  changed: boolean;
}
export interface TopicNoteReviewContext {
  purpose: string;
  exportedAt: string;
  topic: {
    id: string;
    title: string;
    status: string;
    description: string | null;
    summary: string | null;
    courseTask: string | null;
    sourcePlan: SourcePlan | null;
  };
  note: TopicWriting;
  reference: TopicWriting | null;
  evidenceCounts: { reviews: number; applications: number; sourceEvidence: number };
  pendingIndependentCheck: boolean;
  instructions: string[];
}
