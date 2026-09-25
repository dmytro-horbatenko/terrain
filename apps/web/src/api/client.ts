import type {
  AppEvent,
  AuthedUser,
  Course,
  CourseImportSummary,
  CourseUpdatePreview,
  CreateAppEventInput,
  Dashboard,
  ExportOptions,
  ReviewOptions,
  ExportResult,
  HeatmapCell,
  ImportPlan,
  ImportResult,
  LearningContext,
  CreateTopicInput,
  LoginInput,
  LogReviewInput,
  NextPromptPayload,
  OAuthAuthorizationDecision,
  OAuthGrant,
  Prompt,
  RegisterInput,
  Review,
  Settings,
  SessionQueue,
  StreakState,
  Topic,
  TopicDetail,
  TopicNotes,
  TopicType,
  TopicWithMeta,
  UpdateProfileInput,
  UpdateSettingsInput,
  UpdateTopicInput,
  UpdateTopicNotesInput,
} from './types';
import type {
  ProjectCheckpointInput,
  ProjectProgress,
  SkillCheckPlan,
  SkillCheckAttempt,
  SkillCheckResult,
  SkillCheckList,
} from '@terrain/types';

const BASE = '/api';

export interface ApiError extends Error {
  status: number;
  body?: unknown;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers:
      init?.body != null ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let body: unknown;
    try {
      body = await res.json();
      const m = (body as { message?: unknown })?.message;
      if (Array.isArray(m)) message = m.join(', ');
      else if (typeof m === 'string') message = m;
      else {
        const description = (body as { error_description?: unknown })?.error_description;
        if (typeof description === 'string') message = description;
      }
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (null as T);
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  getSkillChecks: () => req<SkillCheckList>('/skill-checks'),
  createSkillCheck: (input: SkillCheckPlan) =>
    req<{ alreadySaved: boolean }>('/skill-checks', { method: 'POST', ...json(input) }),
  saveSkillCheckAttempt: (id: string, input: SkillCheckAttempt) =>
    req<{ alreadySaved: boolean }>(`/skill-checks/${encodeURIComponent(id)}/attempt`, {
      method: 'POST',
      ...json(input),
    }),
  saveSkillCheckResult: (id: string, input: SkillCheckResult) =>
    req<{ alreadySaved: boolean }>(`/skill-checks/${encodeURIComponent(id)}/result`, {
      method: 'POST',
      ...json(input),
    }),
  cancelSkillCheck: (id: string) =>
    req<{ alreadySaved: boolean }>(`/skill-checks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
  getProjectProgress: () => req<ProjectProgress[]>('/projects/progress'),
  saveProjectCheckpoint: (input: ProjectCheckpointInput) =>
    req<{ alreadySaved: boolean }>('/projects/checkpoints', { method: 'POST', ...json(input) }),
  // topics
  getTopics: () => req<TopicWithMeta[]>('/topics'),
  searchTopicIds: (query: string) => req<string[]>(`/topics/search?q=${encodeURIComponent(query)}`),
  getTopicNotes: (id: string) => req<TopicNotes>(`/topics/${encodeURIComponent(id)}/notes`),
  updateTopicNotes: (id: string, input: UpdateTopicNotesInput) =>
    req<TopicNotes>(`/topics/${encodeURIComponent(id)}/notes`, { method: 'PATCH', ...json(input) }),
  getTopic: (id: string) => req<TopicDetail>(`/topics/${id}`),
  createTopic: (input: CreateTopicInput) =>
    req<Topic>('/topics', { method: 'POST', ...json(input) }),
  updateTopic: (id: string, input: UpdateTopicInput) =>
    req<Topic>(`/topics/${id}`, { method: 'PATCH', ...json(input) }),
  deleteTopic: (id: string) => req<void>(`/topics/${id}`, { method: 'DELETE' }),
  addAppEvent: (topicId: string, input: CreateAppEventInput) =>
    req<AppEvent>(`/topics/${topicId}/app-events`, { method: 'POST', ...json(input) }),
  addPrerequisite: (topicId: string, prerequisiteId: string) =>
    req<{ topicId: string; prerequisiteId: string }>(`/topics/${topicId}/prerequisites`, {
      method: 'POST',
      ...json({ prerequisiteId }),
    }),
  removePrerequisite: (topicId: string, prerequisiteId: string) =>
    req<void>(`/topics/${topicId}/prerequisites/${prerequisiteId}`, { method: 'DELETE' }),

  // reviews
  logReview: (input: LogReviewInput) => req<Review>('/reviews', { method: 'POST', ...json(input) }),
  getReviews: (topicId: string) => req<Review[]>(`/reviews?topicId=${encodeURIComponent(topicId)}`),
  getNextPrompt: (topicId: string) =>
    req<NextPromptPayload | null>(`/topics/${topicId}/prompts/next`),
  getSessionQueue: (options: ReviewOptions = {}) => {
    const q = new URLSearchParams();
    if (options.reviewMinutes) q.set('reviewMinutes', String(options.reviewMinutes));
    if (options.reviewPromptId) q.set('reviewPromptId', options.reviewPromptId);
    return req<SessionQueue>(`/reviews/session-queue?${q}`);
  },
  getPrompt: (id: string) => req<NextPromptPayload>(`/prompts/${id}`),
  setPromptSuspended: (id: string, suspended: boolean) =>
    req<Prompt>(`/prompts/${id}`, { method: 'PATCH', ...json({ suspended }) }),
  deletePrompt: (id: string) => req<void>(`/prompts/${id}`, { method: 'DELETE' }),

  // metrics + streak
  getDashboard: (domain?: string, options: ReviewOptions = {}) => {
    const q = new URLSearchParams();
    if (domain) q.set('domain', domain);
    if (options.reviewMinutes) q.set('reviewMinutes', String(options.reviewMinutes));
    if (options.reviewPromptId) q.set('reviewPromptId', options.reviewPromptId);
    return req<Dashboard>(`/metrics/dashboard?${q}`);
  },
  getStreak: () => req<StreakState>('/streak'),
  skipStreak: () => req<{ freezeBalance: number }>('/streak/skip', { method: 'POST' }),

  // metrics
  getHeatmap: (days?: number) =>
    req<HeatmapCell[]>(`/metrics/heatmap${days ? `?days=${days}` : ''}`),

  // settings
  getSettings: () => req<Settings>('/settings'),
  updateSettings: (input: UpdateSettingsInput) =>
    req<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(input) }),
  createTelegramLink: () =>
    req<{ url: string }>('/settings/telegram/link-token', { method: 'POST' }),
  unlinkTelegram: () => req<Settings>('/settings/telegram/unlink', { method: 'POST' }),

  // OAuth clients
  authorizeOAuth: (input: OAuthAuthorizationDecision) =>
    req<{ redirectUrl: string }>('/oauth/authorize', { method: 'POST', ...json(input) }),
  getOAuthGrants: () => req<OAuthGrant[]>('/oauth/grants'),
  revokeOAuthGrant: (clientId: string) =>
    req<void>(`/oauth/grants/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),

  // topic types
  getTopicTypes: () => req<TopicType[]>('/topic-types'),

  // sessions export
  getStoredExport: (id: string) => req<ExportResult>(`/sessions/${encodeURIComponent(id)}/export`),
  getExport: (opts: ExportOptions) => {
    const q = new URLSearchParams();
    if (opts.mode) q.set('mode', opts.mode);
    if (opts.focusTopicId) q.set('focusTopicId', opts.focusTopicId);
    if (opts.approach) q.set('approach', opts.approach);
    if (opts.reviewMinutes) q.set('reviewMinutes', String(opts.reviewMinutes));
    if (opts.reviewPromptId) q.set('reviewPromptId', opts.reviewPromptId);
    const qs = q.toString();
    return req<ExportResult>(`/sessions/export${qs ? `?${qs}` : ''}`);
  },
  getLearningContext: (topic?: string) =>
    req<LearningContext>(`/learning/context${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`),

  // import
  importPreview: (raw: string) =>
    req<ImportPlan>('/sessions/import/preview', {
      method: 'POST',
      ...json({ raw }),
    }),
  importApply: (raw: string) =>
    req<ImportResult>('/sessions/import', { method: 'POST', ...json({ raw }) }),

  // prepared courses
  getCourses: () => req<Course[]>('/courses'),
  importCourse: (id: string) =>
    req<CourseImportSummary>(`/courses/${id}/import`, { method: 'POST' }),
  previewCourseUpdate: (id: string) => req<CourseUpdatePreview>(`/courses/${id}/update-preview`),
  applyCourseUpdate: (id: string, expectedFingerprint: string) =>
    req<CourseUpdatePreview>(`/courses/${id}/update`, {
      method: 'POST',
      ...json({ expectedFingerprint }),
    }),
  setCourseDisabled: (id: string, disabled: boolean) =>
    req<Course>(`/courses/${id}/disabled`, { method: 'PATCH', ...json({ disabled }) }),

  // auth
  me: () => req<AuthedUser>('/auth/me'),
  login: (input: LoginInput) => req<AuthedUser>('/auth/login', { method: 'POST', ...json(input) }),
  register: (input: RegisterInput) =>
    req<AuthedUser>('/auth/register', { method: 'POST', ...json(input) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  updateProfile: (input: UpdateProfileInput) =>
    req<AuthedUser>('/auth/me', { method: 'PATCH', ...json(input) }),
};
