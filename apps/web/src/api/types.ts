import type { LearningApproach, LearningContext, SourceEvidence, SourcePlan } from '@terrain/types';

export type { LearningApproach, LearningContext };

// Mirrors of the NestJS API response shapes. Kept in sync by hand with
// apps/api (see docs/superpowers/specs/2026-06-30-terrain-design.md §3, §6, §7).

export type TopicStatus = 'planned' | 'active' | 'mastered' | 'archived';
export type ReviewMode = 'telegram_quick' | 'app_log' | 'claude_session';
export type AppEventKind = 'project_usage' | 'problem_solved' | 'audit_exercise' | 'real_debugging';
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const TOPIC_STATUSES: TopicStatus[] = ['planned', 'active', 'mastered', 'archived'];

export interface TopicLabels {
  blocked: boolean;
  reviewing: boolean;
}

export interface TopicBlocker {
  id: string;
  title: string;
  learnedLeaves: number;
  totalLeaves: number;
  unfinishedLeaves: TopicRef[];
}

/** Full Topic scalar row (every column). */
export interface Topic {
  id: string;
  title: string;
  domain: string;
  topicType: string;
  status: TopicStatus;
  description: string | null;
  summary: string | null;
  noteRef: string | null;
  parentId: string | null;
  nextReviewAt: string | null;
  learnedAt: string | null;
  aiProposed: boolean;
  aiContext: string | null;
  sourcePlan: SourcePlan | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /topics — each topic augmented with edges + derived labels. */
export interface TopicWithMeta extends Topic {
  prerequisiteIds: string[];
  labels: TopicLabels;
  blockers: TopicBlocker[];
}

export interface TopicRef {
  id: string;
  title: string;
  status: TopicStatus;
}

export interface TopicNotes {
  body: string;
  revision: number;
  updatedAt: string | null;
}

export interface UpdateTopicNotesInput {
  body: string;
  revision: number;
}

export interface Review {
  id: string;
  topicId: string;
  promptId: string | null;
  grade: Grade;
  mode: ReviewMode;
  durationMin: number | null;
  note: string | null;
  intervalBefore: number | null;
  intervalAfter: number | null;
  reviewedAt: string;
}

export interface Mastery {
  retention: boolean;
  application: boolean;
  teaching: boolean;
  eligible: boolean;
}

export interface AppEvent {
  id: string;
  topicId: string;
  kind: AppEventKind;
  description: string;
  url: string | null;
  appliedAt: string;
}

/** GET /topics/:id — full detail with relations, history, derived state. */
export interface TopicDetail extends TopicWithMeta {
  prerequisites: TopicRef[];
  dependents: TopicRef[];
  parent: TopicRef | null;
  children: TopicRef[];
  reviews: Review[];
  appEvents: AppEvent[];
  appEventCount: number;
  prompts: Prompt[];
  mastery: Mastery;
  sourceEvidence?: SourceEvidenceRecord[];
}

export interface SourceEvidenceRecord extends Omit<SourceEvidence, 'topicTitle' | 'sourceId'> {
  id: string;
  topicId: string;
  sessionExportId: string;
  sourceId: string | null;
  verifiedLiveAt: string | null;
  createdAt: string;
}

export interface CreateAppEventInput {
  kind: AppEventKind;
  description: string;
  url?: string;
}

export interface Settings {
  userId: string;
  obsidianVault: string | null;
  timezone: string;
  digestHour: number | null;
  nudgeHour: number | null;
  preferredSourceFormats: string[];
  sourceTimeBudgetMinutes: number | null;
  sourceLanguage: string | null;
  allowPaidSources: boolean;
  telegramLinked: boolean;
}

export interface UpdateSettingsInput {
  obsidianVault?: string | null;
  timezone?: string;
  digestHour?: number | null;
  nudgeHour?: number | null;
  preferredSourceFormats?: string[];
  sourceTimeBudgetMinutes?: number | null;
  sourceLanguage?: string | null;
  allowPaidSources?: boolean;
}

export interface OAuthAuthorizationRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}

export interface OAuthAuthorizationDecision extends OAuthAuthorizationRequest {
  approved: boolean;
}

export interface OAuthGrant {
  clientId: string;
  clientName: string;
  scopes: string[];
  connectedAt: string;
}

export interface HeatmapCell {
  date: string;
  count: number;
}

export interface CreateTopicInput {
  title: string;
  domain: string;
  topicType: string;
  status?: TopicStatus;
  description?: string;
  noteRef?: string;
  parentId?: string;
  sourcePlan?: SourcePlan | null;
}

export interface UpdateTopicInput {
  title?: string;
  domain?: string;
  topicType?: string;
  status?: TopicStatus;
  description?: string;
  noteRef?: string;
  parentId?: string | null;
  summary?: string;
  nextReviewAt?: string;
  aiProposed?: boolean;
  sourcePlan?: SourcePlan | null;
}

export type PromptKind = 'concept' | 'code' | 'problem';
export type ProblemDifficulty = 'easy' | 'medium' | 'hard';
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface Prompt {
  id: string;
  topicId: string;
  promptText: string;
  answerHint: string | null;
  promptKind: PromptKind;
  url: string | null;
  problemDifficulty: ProblemDifficulty | null;
  estimatedMinutes: number | null;
  autoGenerated: boolean;
  suspended: boolean;
  suspendedAt: string | null;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: CardState;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  createdAt: string;
}

/** GET /topics/:id/prompts/next payload; the client method's return type wraps this in `| null`. */
export interface NextPromptPayload {
  prompt: Prompt;
  previewIntervals: Record<Grade, number>;
}

/** GET /reviews/session-queue — selected cards with their text and planning estimates. */
export interface SessionQueueItem {
  promptId: string;
  topicId: string;
  topicTitle: string;
  chapterTitle: string;
  kind: PromptKind;
  isNew: boolean;
  nextReviewAt: string | null;
  createdAt: string;
  promptText: string;
  estimatedMinutes: number;
}

export interface SessionQueue {
  items: SessionQueueItem[];
  estimatedMinutes: number;
  budgetMinutes: number;
  backlogCount: number;
  backlogMinutes: number;
  deferredExercises: {
    promptId: string;
    topicTitle: string;
    promptText: string;
    estimatedMinutes: number;
  }[];
}

export interface LogReviewInput {
  topicId: string;
  promptId?: string;
  grade: Grade;
  mode: ReviewMode;
  durationMin?: number;
  note?: string;
}

export interface StreakState {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  freezeBalance: number;
  activeDayCounter: number;
  lastEvaluatedDate: string | null;
}

export interface NextUp {
  topic: Topic;
  chapterTitle: string | null;
  chapterProgress: { started: number; total: number } | null;
  sourcePlanStats: { requiredCount: number; estimatedMinutes: number; hasExpired: boolean };
}

export interface PendingSession {
  id: string;
  mode: 'repeat' | 'learn';
  generatedAt: string; // ISO over JSON
  focusTopicId: string | null;
  topicTitle: string | null;
  approach: LearningApproach | null;
  reviewPlan?: {
    promptIds: readonly string[];
    estimatedMinutes: number;
    budgetMinutes: number;
    reviewMinutes: 15 | 20;
    reviewPromptId?: string;
  } | null;
}

export interface Dashboard {
  generatedAt: string;
  reviewStats7d: { total: number; again: number; againRatio: number | null };
  newCards: number;
  nextUp: NextUp | null;
  sessionQueueCount: number;
  sessionQueueMinutes: number;
  reviewQueue: SessionQueue;
  reviewDay: { dayKey: string; completed: boolean };
  pendingSessions: PendingSession[];
  due: { overdue: Topic[]; dueToday: Topic[] };
  counts: {
    total: number;
    planned: number;
    active: number;
    mastered: number;
    archived: number;
    dueToday: number;
    overdue: number;
  };
}

export interface TopicType {
  key: string;
  label: string;
  color: string | null;
}

export interface ExportResult {
  id: string;
  exportMd: string;
  reviewPlan?: PendingSession['reviewPlan'];
}

export interface ReviewOptions {
  reviewMinutes?: 15 | 20;
  reviewPromptId?: string;
}

export interface ExportOptions extends ReviewOptions {
  mode?: string;
  focusTopicId?: string;
  approach?: LearningApproach;
}

// ---- Import flow (POST /sessions/import/preview and /sessions/import) ----
// Mirrors apps/api/src/import/import.service.ts plan shapes (v2 contract).

export interface CardPreview {
  intervalBefore: number;
  intervalAfter: number;
  nextReviewAt: string | null; // ISO over JSON
}

export interface ResolvedCardReview {
  kind: 'card';
  promptId: string;
  topicId: string | null;
  topicTitle: string | null;
  promptText: string | null;
  grade: Grade;
  note?: string;
  cardPreview?: CardPreview;
}

export interface ResolvedEvidenceReview {
  kind: 'evidence';
  topicTitle: string;
  resolvedTopicId: string | null;
  grade: Grade;
  note?: string;
}

export type ResolvedReview = ResolvedCardReview | ResolvedEvidenceReview;

export interface NewTopicPlan {
  title: string;
  topicType: string;
  domain: string;
  description?: string;
  prerequisiteTitles: string[];
  parentTitle: string | null;
  aiContext?: string;
  sourcePlan?: SourcePlan;
  alreadyExists: boolean;
}

export interface NewPromptPlan {
  duplicate: boolean;
  topicTitle: string;
  promptText: string;
  answerHint?: string;
  promptKind: 'concept' | 'code' | 'problem';
  url?: string;
  problemDifficulty?: 'easy' | 'medium' | 'hard';
  estimatedMinutes?: number;
}

export interface NoteSummaryPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  composedSummary: string;
  suggestedNoteRef?: string;
}

export interface Unresolved {
  kind:
    | 'review'
    | 'noteSummary'
    | 'prerequisite'
    | 'parent'
    | 'prompt'
    | 'studiedTopic'
    | 'applicationEvent';
  /** Topic title — absent only for card-review promptId misses (see ref). */
  title?: string;
  /** The unresolvable promptId — set only for kind 'prompt' card-review misses. */
  ref?: string;
  context: string;
  reason: 'missing' | 'ambiguous' | 'self-reference' | 'archived';
}

export interface ActivationPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  currentStatus: string | null;
  willActivate: boolean;
}

export interface ApplicationEventPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  kind: AppEventKind;
  description: string;
  url?: string;
}

export interface ImportPlan {
  sessionExportId: string;
  alreadyImported: boolean;
  reviews: ResolvedReview[];
  newTopics: NewTopicPlan[];
  newPrompts: NewPromptPlan[];
  noteSummaries: NoteSummaryPlan[];
  nextSession?: { focusTitle?: string | null; coldChallenge?: string | null } | null;
  unresolved: Unresolved[];
  applicable: boolean;
  activations: ActivationPlan[];
  applicationEvents?: ApplicationEventPlan[];
  sourceEvidence?: SourceEvidencePlan[];
  sourceIssues?: SourceIssue[];
}

export type SourceEvidencePlan = SourceEvidence & {
  resolvedTopicId: string | null;
  substituted: boolean;
};

export interface SourceIssue {
  topicTitle: string;
  requirementId?: string;
  sourceId?: string;
  reason:
    | 'missing-plan'
    | 'missing-evidence'
    | 'unknown-requirement'
    | 'unknown-source'
    | 'duplicate'
    | 'verification-required';
  blocking: boolean;
  message: string;
}

export interface ImportResult {
  sessionExportId: string;
  reviewsApplied: number;
  topicsCreated: string[];
  promptsCreated: number;
  duplicatePromptsSkipped: number;
  noteSummariesApplied: number;
  appEventsApplied: number;
  nextSessionStored: boolean;
  topicsActivated: number;
  topicsMastered: number;
  sourceEvidenceApplied: number;
}

// ---- Prepared courses ----

export interface Course {
  id: string;
  domain: string;
  title: string;
  description: string;
  topicCount: number;
  imported: boolean;
  disabled: boolean;
  revision?: string;
}

export interface CourseUpdatePreview {
  revision: string;
  catalogueDigest: string;
  fingerprint: string;
  topicsCreated: number;
  topicsUpdated: number;
  promptsCreated: number;
  promptsUpdated: number;
  preservedChanges: string[];
  issues: string[];
  changes: { title: string; fields: string[]; prerequisites?: string[] }[];
}

export interface CourseImportSummary {
  topicsCreated: number;
  promptsCreated: number;
  topicsActivated: number;
}

// ---- Auth ----

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  headline: string | null;
  learningStyle: string | null;
  codeStyle: string | null;
  noteSystem: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface UpdateProfileInput {
  name?: string;
  headline?: string;
  learningStyle?: string;
  codeStyle?: string;
  noteSystem?: string;
  obsidianVault?: string;
}
