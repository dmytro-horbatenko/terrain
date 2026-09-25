import { createHash } from 'node:crypto';
import type { TopicStatus } from '@prisma/client';
import type { LearningOsV2 } from '@terrain/types';
import { buildRoadmapPolicy } from '../learning/roadmap-policy';

export type PreparedTopic = Omit<
  LearningOsV2['proposedTopics'][number],
  'description' | 'aiContext' | 'sourcePlan'
> & {
  description?: string | null;
  aiContext?: string | null;
  sourcePlan?: unknown;
  curriculumOrder?: number;
};
export type PreparedPrompt = LearningOsV2['proposedPrompts'][number];
export type CourseCatalogue = { topics: PreparedTopic[]; prompts: PreparedPrompt[] };
export type PromptChange = { topicTitle: string; previousPromptText: string; promptText: string };
type Metadata = Record<string, unknown>;
export type StoredCourseTopic = {
  id: string;
  title: string;
  domain: string;
  status: TopicStatus;
  description: string | null;
  aiContext: string | null;
  sourcePlan: unknown;
  parentId: string | null;
  curriculumOrder?: number | null;
  prerequisites: { prerequisiteId: string }[];
  prompts: ({ id: string; promptText: string; promptKind: string } & Metadata)[];
};

const norm = (value: string) => value.trim().toLowerCase();
export const PROMPT_METADATA = [
  'promptText',
  'answerHint',
  'promptKind',
  'url',
  'problemDifficulty',
  'estimatedMinutes',
] as const;
const TOPIC_METADATA = ['description', 'aiContext', 'sourcePlan'] as const;

// JSONB does not preserve object key order. Compare values, not serialization order.
export function canonical(value: unknown): string {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export const catalogueDigest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
const titlesKey = (titles: string[]) => [...new Set(titles.map(norm))].sort().join('\n');

export function planCourseUpdate(
  desired: CourseCatalogue,
  baseline: CourseCatalogue,
  existing: StoredCourseTopic[],
  promptChanges: PromptChange[],
) {
  const issues: string[] = [];
  const preservedChanges: string[] = [];
  const newTopics: PreparedTopic[] = [];
  const topicUpdates: {
    id: string;
    title: string;
    data: Metadata;
    prerequisiteTitles?: string[];
    parentTitle?: string | null;
  }[] = [];
  const newPrompts: PreparedPrompt[] = [];
  const promptUpdates: { id: string; topicTitle: string; data: Metadata }[] = [];
  const byTitle = new Map<string, StoredCourseTopic>();
  const desiredTitles = new Set(desired.topics.map(({ title }) => norm(title)));
  for (const row of existing) {
    const key = norm(row.title);
    if (byTitle.has(key) && desiredTitles.has(key))
      issues.push(`Ambiguous existing topic: ${row.title}`);
    byTitle.set(key, row);
  }
  const byId = new Map(existing.map((row) => [row.id, row]));
  const previous = new Map(baseline.topics.map((row) => [norm(row.title), row]));
  const desiredByTitle = new Map(desired.topics.map((row) => [norm(row.title), row]));
  const resolveId = (title: string) =>
    byTitle.get(norm(title))?.id ?? (desiredByTitle.has(norm(title)) ? `new:${norm(title)}` : null);
  const mergeField = (
    title: string,
    key: string,
    current: unknown,
    before: unknown,
    after: unknown,
    data: Metadata,
  ) => {
    if (canonical(current) === canonical(after)) return;
    if (canonical(current) === canonical(before)) data[key] = after ?? null;
    else preservedChanges.push(`${title}: custom ${key} preserved`);
  };

  for (const [curriculumOrder, wanted] of desired.topics.entries()) {
    const row = byTitle.get(norm(wanted.title));
    const old = previous.get(norm(wanted.title));
    if (!row) {
      newTopics.push({ ...wanted, curriculumOrder });
      continue;
    }
    if (row.domain !== wanted.domain) {
      issues.push(`${wanted.title}: an existing topic belongs to another domain`);
      continue;
    }
    const update: (typeof topicUpdates)[number] = { id: row.id, title: row.title, data: {} };
    if (row.curriculumOrder !== curriculumOrder) update.data.curriculumOrder = curriculumOrder;
    for (const key of TOPIC_METADATA) {
      if (!old && canonical(row[key]) !== canonical(wanted[key])) {
        preservedChanges.push(`${row.title}: custom ${key} preserved`);
      } else mergeField(row.title, key, row[key], old?.[key], wanted[key], update.data);
    }
    const currentParent = row.parentId ? (byId.get(row.parentId)?.title ?? row.parentId) : null;
    if (norm(currentParent ?? '') !== norm(wanted.parentTitle ?? '')) {
      if (old && norm(currentParent ?? '') === norm(old.parentTitle ?? ''))
        update.parentTitle = wanted.parentTitle;
      else preservedChanges.push(`${row.title}: custom parent preserved`);
    }
    const currentPrerequisites = row.prerequisites.map(
      ({ prerequisiteId }) => byId.get(prerequisiteId)?.title ?? prerequisiteId,
    );
    if (titlesKey(currentPrerequisites) !== titlesKey(wanted.prerequisiteTitles)) {
      if (old && titlesKey(currentPrerequisites) === titlesKey(old.prerequisiteTitles))
        update.prerequisiteTitles = wanted.prerequisiteTitles;
      else preservedChanges.push(`${row.title}: custom prerequisites preserved`);
    }
    if (
      Object.keys(update.data).length ||
      update.parentTitle !== undefined ||
      update.prerequisiteTitles !== undefined
    )
      topicUpdates.push(update);
  }

  for (const wanted of desired.prompts) {
    const topic = byTitle.get(norm(wanted.topicTitle));
    if (!topic) {
      newPrompts.push(wanted);
      continue;
    }
    const rewrite = promptChanges.find(
      (change) =>
        norm(change.topicTitle) === norm(wanted.topicTitle) &&
        change.promptText === wanted.promptText,
    );
    const oldText = rewrite?.previousPromptText ?? wanted.promptText;
    const old = baseline.prompts.find(
      (prompt) =>
        norm(prompt.topicTitle) === norm(wanted.topicTitle) && prompt.promptText === oldText,
    );
    const matching = topic.prompts.filter(
      (prompt) => prompt.promptText === wanted.promptText || prompt.promptText === oldText,
    );
    if (matching.length > 1) {
      preservedChanges.push(`${wanted.topicTitle}: ambiguous existing card preserved`);
      continue;
    }
    const card = matching[0];
    if (!card) {
      if (old) preservedChanges.push(`${wanted.topicTitle}: removed or rewritten card preserved`);
      else newPrompts.push(wanted);
      continue;
    }
    const data: Metadata = {};
    for (const key of PROMPT_METADATA) {
      if (!old && canonical(card[key]) !== canonical(wanted[key])) {
        preservedChanges.push(`${wanted.topicTitle}: custom card ${key} preserved`);
      } else mergeField(wanted.topicTitle, key, card[key], old?.[key], wanted[key], data);
    }
    if (Object.keys(data).length)
      promptUpdates.push({ id: card.id, topicTitle: wanted.topicTitle, data });
  }

  const beforeGraph = existing.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    status: row.status,
    prerequisiteIds: row.prerequisites.map((edge) => edge.prerequisiteId),
  }));
  const graph = beforeGraph.map((node) => ({ ...node }));
  for (const wanted of newTopics) {
    graph.push({
      id: resolveId(wanted.title)!,
      parentId: null,
      status: 'planned',
      prerequisiteIds: [],
    });
  }
  for (const change of [
    ...newTopics.map((topic) => ({ ...topic, id: resolveId(topic.title)! })),
    ...topicUpdates,
  ]) {
    const node = graph.find(({ id }) => id === change.id)!;
    if (change.parentTitle !== undefined) {
      node.parentId = change.parentTitle ? resolveId(change.parentTitle) : null;
      if (change.parentTitle && !node.parentId)
        issues.push(`${change.title}: missing parent ${change.parentTitle}`);
    }
    if (change.prerequisiteTitles !== undefined) {
      node.prerequisiteIds = change.prerequisiteTitles.flatMap((title) => {
        const id = resolveId(title);
        if (!id) issues.push(`${change.title}: missing prerequisite ${title}`);
        return id ? [id] : [];
      });
    }
  }
  const beforePolicy = buildRoadmapPolicy(beforeGraph);
  for (const [id, policy] of buildRoadmapPolicy(graph)) {
    if (policy.cycle && !beforePolicy.get(id)?.cycle)
      issues.push(`${byId.get(id)?.title ?? id}: update would introduce a prerequisite cycle`);
  }
  for (const prompt of newPrompts)
    if (!resolveId(prompt.topicTitle)) issues.push(`Missing card topic: ${prompt.topicTitle}`);

  const fingerprint = catalogueDigest({
    desired,
    baseline,
    promptChanges,
    existing: existing
      .map((row) => ({
        id: row.id,
        title: row.title,
        domain: row.domain,
        description: row.description,
        aiContext: row.aiContext,
        sourcePlan: row.sourcePlan,
        parentId: row.parentId,
        curriculumOrder: row.curriculumOrder,
        prerequisites: row.prerequisites.map(({ prerequisiteId }) => prerequisiteId).sort(),
        prompts: row.prompts
          .map((prompt) =>
            Object.fromEntries(['id', ...PROMPT_METADATA].map((key) => [key, prompt[key] ?? null])),
          )
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return {
    fingerprint,
    newTopics,
    topicUpdates,
    newPrompts,
    promptUpdates,
    preservedChanges: [...new Set(preservedChanges)],
    issues: [...new Set(issues)],
  };
}
