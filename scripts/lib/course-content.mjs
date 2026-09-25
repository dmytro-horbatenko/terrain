import { buildRoadmapPolicy } from '../../apps/api/src/learning/roadmap-policy.ts';

// Check the same inherited gates the app uses, including chapter/child deadlocks.
export function dependencyErrors(files) {
  const norm = (value) => value.trim().toLowerCase();
  const topics = files.flatMap(({ doc }) => doc.proposedTopics);
  const errors = [];
  const titles = new Set(topics.map((topic) => norm(topic.title)));
  for (const topic of topics) {
    for (const ref of [topic.parentTitle, ...topic.prerequisiteTitles].filter(Boolean))
      if (!titles.has(norm(ref))) errors.push(`"${topic.title}" references missing topic "${ref}"`);
  }
  // Avoid following missing nodes in the policy's cycle traversal.
  if (errors.length) return errors;
  const policy = buildRoadmapPolicy(
    topics.map((topic) => ({
      id: norm(topic.title),
      parentId: topic.parentTitle ? norm(topic.parentTitle) : null,
      prerequisiteIds: topic.prerequisiteTitles.map(norm),
      status: 'planned',
    })),
  );
  for (const topic of topics)
    if (policy.get(norm(topic.title)).cycle)
      errors.push(`"${topic.title}" has a cyclic or inherited prerequisite deadlock`);
  return errors;
}

// Prepared courses are reconciled atomically by the server, not uploaded file by file.
export async function updatePreparedCourse(api, courseId, { dryRun = false } = {}) {
  const preview = await api(`/courses/${courseId}/update-preview`);
  if (preview.status !== 200) throw new Error(`course preview failed: ${preview.status}`);
  if (preview.body?.revision !== '2026-09-25')
    throw new Error(
      'Server curriculum revision differs from this checkout; deploy the matching prepared catalogue first.',
    );
  if (!preview.body.fingerprint) throw new Error('Course preview is missing its fingerprint');
  console.log(
    `Server-authored ${courseId} curriculum ${preview.body.revision}: ${JSON.stringify(preview.body)}`,
  );
  if (dryRun) return preview.body;
  const applied = await api(`/courses/${courseId}/update`, {
    method: 'POST',
    body: JSON.stringify({ expectedFingerprint: preview.body.fingerprint }),
  });
  if (applied.status < 200 || applied.status >= 300)
    throw new Error(`course update failed: ${applied.status} ${JSON.stringify(applied.body)}`);
  console.log(`APPLIED: ${JSON.stringify(applied.body)}`);
  return applied.body;
}
