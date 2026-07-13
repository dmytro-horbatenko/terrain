import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  CreateAppEventInput,
  CreateTopicInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  UpdateSettingsInput,
  UpdateTopicInput,
} from './types';

export const qk = {
  topics: ['topics'] as const,
  topic: (id: string) => ['topic', id] as const,
  reviews: (topicId: string) => ['reviews', topicId] as const,
  nextPrompt: (topicId: string) => ['next-prompt', topicId] as const,
  prompt: (id: string) => ['prompt', id] as const,
  dashboard: (domain?: string) => ['dashboard', domain ?? 'all'] as const,
  heatmap: (days?: number) => ['heatmap', days ?? 'default'] as const,
  streak: ['streak'] as const,
  settings: ['settings'] as const,
  topicTypes: ['topic-types'] as const,
  courses: ['courses'] as const,
};

// ---- queries ----

export function useTopics() {
  return useQuery({ queryKey: qk.topics, queryFn: api.getTopics });
}

export function useTopic(id: string | null) {
  return useQuery({
    queryKey: qk.topic(id ?? ''),
    queryFn: () => api.getTopic(id!),
    enabled: !!id,
  });
}

export function useReviews(topicId: string | null) {
  return useQuery({
    queryKey: qk.reviews(topicId ?? ''),
    queryFn: () => api.getReviews(topicId!),
    enabled: !!topicId,
  });
}

export function useDashboard(domain?: string) {
  return useQuery({
    queryKey: qk.dashboard(domain),
    queryFn: () => api.getDashboard(domain),
  });
}

export function useHeatmap(days?: number) {
  return useQuery({ queryKey: qk.heatmap(days), queryFn: () => api.getHeatmap(days) });
}

export function useStreak() {
  return useQuery({ queryKey: qk.streak, queryFn: api.getStreak });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.getSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.updateSettings(input),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}

export function useTelegramLinkToken() {
  return useMutation({ mutationFn: () => api.createTelegramLink() });
}

export function useTelegramUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.unlinkTelegram(),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}

export function useTopicTypes() {
  return useQuery({ queryKey: qk.topicTypes, queryFn: api.getTopicTypes });
}

// ---- mutations ----

/** Invalidate everything that derives from topic / review / streak state. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return (topicId?: string) => {
    qc.invalidateQueries({ queryKey: qk.topics });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['heatmap'] });
    qc.invalidateQueries({ queryKey: qk.streak });
    qc.invalidateQueries({ queryKey: qk.topicTypes });
    if (topicId) {
      qc.invalidateQueries({ queryKey: qk.topic(topicId) });
      qc.invalidateQueries({ queryKey: qk.reviews(topicId) });
      qc.invalidateQueries({ queryKey: qk.nextPrompt(topicId) });
    } else {
      qc.invalidateQueries({ queryKey: ['topic'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    }
  };
}

export function useCreateTopic() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateTopicInput) => api.createTopic(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTopic() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTopicInput }) =>
      api.updateTopic(id, input),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useAddPrerequisite() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ topicId, prerequisiteId }: { topicId: string; prerequisiteId: string }) =>
      api.addPrerequisite(topicId, prerequisiteId),
    onSuccess: (_data, vars) => invalidate(vars.topicId),
  });
}

export function useRemovePrerequisite() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ topicId, prerequisiteId }: { topicId: string; prerequisiteId: string }) =>
      api.removePrerequisite(topicId, prerequisiteId),
    onSuccess: (_data, vars) => invalidate(vars.topicId),
  });
}

export function useDeleteTopic() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.deleteTopic(id),
    onSuccess: () => invalidate(),
  });
}

export function useAddAppEvent(topicId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateAppEventInput) => api.addAppEvent(topicId, input),
    onSuccess: () => invalidate(topicId),
  });
}

export function useSetPromptSuspended(topicId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      api.setPromptSuspended(id, suspended),
    onSuccess: () => invalidate(topicId),
  });
}

export function useDeletePrompt(topicId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.deletePrompt(id),
    onSuccess: () => invalidate(topicId),
  });
}

export function useSkipStreak() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: () => api.skipStreak(),
    onSuccess: () => invalidate(),
  });
}

export function useGenerateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { mode?: string; focusTopicId?: string }) => api.getExport(opts),
    // A new SessionExport row may change the dashboard's pendingSessions.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
}

export function useImportPreview() {
  return useMutation({ mutationFn: (raw: string) => api.importPreview(raw) });
}

export function useImportApply() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (raw: string) => api.importApply(raw),
    onSuccess: () => invalidate(),
  });
}

export function useCourses() {
  return useQuery({ queryKey: qk.courses, queryFn: api.getCourses });
}

export function useImportCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.importCourse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

// ---- auth ----

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api.me(), retry: false });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      // Clear every OTHER cached query so the next login (same browser,
      // possibly a different user) never sees stale data, but leave `me`'s
      // Query instance itself alive: AuthGate stays subscribed to it across
      // logout/login, and destroying + rebuilding it (plain qc.clear() does
      // this) causes a stray refetch on the gate's next render, since a
      // freshly-built Query is always considered stale. If that stray
      // refetch resolves after a subsequent login (racing against the new
      // session cookie), it 401s and flips isError on a Query that already
      // holds the new user's correct data, which AuthGate's isError check
      // reads before checking data — bouncing a just-logged-in user back to
      // the login screen. Updating the existing Query in place with
      // setQueryData avoids the rebuild entirely, so no stray fetch fires.
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
      qc.setQueryData(meKey, null);
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.updateProfile(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}
