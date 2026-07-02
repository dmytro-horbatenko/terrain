import type {
  AppEvent,
  AuthedUser,
  CreateAppEventInput,
  Dashboard,
  ExportResult,
  HeatmapCell,
  ImportPlan,
  ImportResult,
  CreateTopicInput,
  LoginInput,
  LogReviewInput,
  NextPromptPayload,
  Prompt,
  RegisterInput,
  Review,
  Settings,
  StreakState,
  Topic,
  TopicDetail,
  TopicType,
  TopicWithMeta,
  UpdateProfileInput,
  UpdateSettingsInput,
  UpdateTopicInput,
} from './types';

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
  // topics
  getTopics: () => req<TopicWithMeta[]>('/topics'),
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
  setPromptSuspended: (id: string, suspended: boolean) =>
    req<Prompt>(`/prompts/${id}`, { method: 'PATCH', ...json({ suspended }) }),
  deletePrompt: (id: string) => req<void>(`/prompts/${id}`, { method: 'DELETE' }),

  // metrics + streak
  getDashboard: (domain?: string) =>
    req<Dashboard>(`/metrics/dashboard${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`),
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

  // topic types
  getTopicTypes: () => req<TopicType[]>('/topic-types'),

  // sessions export
  getExport: (opts: { mode?: string; focusTopicId?: string }) => {
    const q = new URLSearchParams();
    if (opts.mode) q.set('mode', opts.mode);
    if (opts.focusTopicId) q.set('focusTopicId', opts.focusTopicId);
    const qs = q.toString();
    return req<ExportResult>(`/sessions/export${qs ? `?${qs}` : ''}`);
  },

  // import
  importPreview: (raw: string) =>
    req<ImportPlan>('/sessions/import/preview', {
      method: 'POST',
      ...json({ raw }),
    }),
  importApply: (raw: string) =>
    req<ImportResult>('/sessions/import', { method: 'POST', ...json({ raw }) }),

  // auth
  me: () => req<AuthedUser>('/auth/me'),
  login: (input: LoginInput) => req<AuthedUser>('/auth/login', { method: 'POST', ...json(input) }),
  register: (input: RegisterInput) =>
    req<AuthedUser>('/auth/register', { method: 'POST', ...json(input) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  updateProfile: (input: UpdateProfileInput) =>
    req<AuthedUser>('/auth/me', { method: 'PATCH', ...json(input) }),
};
