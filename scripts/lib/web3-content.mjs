// Shared loader + structural checks for content/web3/*.json (learning-os v2).
// Used by validate-web3-content.mjs (CLI) and import-web3.mjs (pre-flight).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { learningOsV2Schema } from '@terrain/types';

export const CONTENT_DIR = path.resolve(import.meta.dirname, '../../content/web3');
export const norm = (s) => s.trim().toLowerCase();
const BOUNDED_SCOPE_RE =
  /^(?:(?:sections?|chapters?|lessons?|parts?)\s+\S(?:.*\S)?|(?:pages?|pp?\.?)\s+\d+\s*[-–—]\s*\d+|§+\s*\S(?:.*\S)?|(?:timestamps?\s*:?\s*)?\d{1,2}:\d{2}(?::\d{2})?\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?|entire\s+(?:article|page|readme|(?:eip|erc)(?:-\d+)?)\s+\([1-9]\d*\s+min\))$/i;

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const isBoundedSourceScope = (value) => BOUNDED_SCOPE_RE.test(value?.trim() ?? '');

function sourceOptionErrors(option, label) {
  const errors = [];
  if (!isHttpUrl(option.url)) errors.push(`${label} URL must use HTTP(S)`);
  if (!isBoundedSourceScope(option.scope)) errors.push(`${label} needs a named bounded scope`);
  if ((option.why?.trim().length ?? 0) < 30)
    errors.push(`${label} why must be at least 30 trimmed characters`);
  if ((option.verifiedAt == null) !== (option.recheckAfterDays == null))
    errors.push(`${label} freshness fields must appear together`);
  return errors;
}

export function sourcePlanErrors(topic, file) {
  if (topic.type !== 'pattern') return [];
  const label = `${file}: leaf "${topic.title}"`;
  const plan = topic.sourcePlan;
  if (!plan) return [`${label} has no sourcePlan`];
  if (plan.policy === 'none')
    return (plan.rationale?.trim().length ?? 0) >= 30
      ? []
      : [`${label} sourcePlan rationale must be at least 30 trimmed characters`];
  if (plan.policy !== 'required') return [`${label} has an invalid sourcePlan policy`];

  const errors = [];
  const requirements = plan.requirements ?? [];
  const requirementIds = requirements.map((requirement) => requirement.id);
  if (new Set(requirementIds).size !== requirementIds.length)
    errors.push(`${label} source requirement ids must be unique`);

  const options = [];
  for (const requirement of requirements) {
    const requirementLabel = `${label} requirement "${requirement.id}"`;
    if ((requirement.purpose?.trim().length ?? 0) < 20)
      errors.push(`${requirementLabel} purpose must be at least 20 trimmed characters`);
    if (!requirement.options?.length) errors.push(`${requirementLabel} needs at least one option`);
    options.push(...(requirement.options ?? []));
  }
  options.push(...(plan.optional ?? []));

  const optionIds = options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length)
    errors.push(`${label} source option ids must be unique across the whole plan`);
  for (const option of options)
    errors.push(...sourceOptionErrors(option, `${label} source "${option.id}"`));
  return errors;
}

export async function loadContentFiles(dir = CONTENT_DIR) {
  // NN-slug.json or NN[a-z]-slug.json (e.g. 06a-...); sorted = import order.
  const names = (await readdir(dir)).filter((n) => /^\d\d[a-z]?-.*\.json$/.test(n)).sort();
  if (names.length === 0) throw new Error(`no NN-*.json content files in ${dir}`);
  const files = [];
  for (const name of names) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${name}: invalid JSON — ${e.message}`);
    }
    const parsed = learningOsV2Schema.safeParse(json);
    if (!parsed.success) throw new Error(`${name}: schema — ${parsed.error.message}`);
    files.push({ file: name, doc: parsed.data });
  }
  return files;
}

// Structural rules beyond the Zod schema. Returns human-readable errors.
export function structuralErrors(files, { sourcePrefixes = [] } = {}) {
  const errors = [];
  const seenTitles = new Map(); // norm(title) -> file
  for (const { file, doc } of files) {
    const checkSources =
      sourcePrefixes.length === 0 || sourcePrefixes.some((prefix) => file.startsWith(prefix));
    const local = new Map(doc.proposedTopics.map((t) => [norm(t.title), t]));
    const seenInFile = new Set();
    if (doc.proposedTopics.length > 40)
      errors.push(`${file}: ${doc.proposedTopics.length} topics — over the 40/file split rule`);
    for (const t of doc.proposedTopics) {
      if (t.domain !== 'Web3')
        errors.push(`${file}: "${t.title}" domain "${t.domain}" (must be Web3)`);
      if (t.type !== 'concept' && t.type !== 'pattern')
        errors.push(`${file}: "${t.title}" type "${t.type}" (must be concept|pattern)`);
      if (seenInFile.has(norm(t.title)))
        errors.push(`${file}: duplicate topic "${t.title}" within this file`);
      seenInFile.add(norm(t.title));
      if (seenTitles.has(norm(t.title)))
        errors.push(
          `${file}: duplicate topic "${t.title}" (also in ${seenTitles.get(norm(t.title))})`,
        );
      const resolvable = (ref) => seenTitles.has(norm(ref)) || local.has(norm(ref));
      if (t.parentTitle && !resolvable(t.parentTitle))
        errors.push(
          `${file}: "${t.title}" parent "${t.parentTitle}" not in this or an earlier file`,
        );
      for (const pre of t.prerequisiteTitles)
        if (!resolvable(pre))
          errors.push(`${file}: "${t.title}" prereq "${pre}" not in this or an earlier file`);
      if (checkSources) {
        errors.push(...sourcePlanErrors(t, file));
        if (/resources:/i.test(t.description ?? ''))
          errors.push(`${file}: "${t.title}" description still contains Resources:`);
      }
      if (t.type === 'pattern') {
        // Leaf content-model check: aiContext carries Build + Done-when.
        const ai = t.aiContext ?? '';
        if (!/build:/i.test(ai) || !/done when:/i.test(ai))
          errors.push(`${file}: leaf "${t.title}" aiContext missing "Build:" or "Done when:"`);
      }
    }
    for (const p of doc.proposedPrompts) {
      const target = local.get(norm(p.topicTitle));
      if (!target)
        errors.push(`${file}: prompt targets "${p.topicTitle}" — not a topic in the SAME file`);
      else if (target.type !== 'pattern')
        errors.push(`${file}: prompt targets non-pattern topic "${p.topicTitle}"`);
      if (p.promptKind === 'problem') {
        if (!p.url) errors.push(`${file}: problem card on "${p.topicTitle}" missing url`);
      } else if (p.url || p.problemDifficulty || p.estimatedMinutes) {
        errors.push(
          `${file}: ${p.promptKind} card on "${p.topicTitle}" carries problem-only fields`,
        );
      }
    }
    for (const t of doc.proposedTopics) {
      if (t.type !== 'pattern') continue;
      if (
        !doc.proposedPrompts.some(
          (p) => norm(p.topicTitle) === norm(t.title) && p.promptKind === 'concept',
        )
      )
        errors.push(`${file}: leaf "${t.title}" has no concept card`);
    }
    const fenced = '```learning-os\n' + JSON.stringify(doc) + '\n```';
    if (Buffer.byteLength(fenced) > 90_000)
      errors.push(
        `${file}: fenced payload ${Buffer.byteLength(fenced)} bytes — over the 90KB margin (split the file)`,
      );
    for (const t of doc.proposedTopics) seenTitles.set(norm(t.title), file);
  }
  return errors;
}

// All external URLs referenced by source plans and problem cards.
export function allUrls(files) {
  const out = [];
  for (const { file, doc } of files) {
    for (const t of doc.proposedTopics) {
      const plan = t.sourcePlan;
      if (plan?.policy !== 'required') continue;
      for (const requirement of plan.requirements)
        for (const option of requirement.options)
          out.push({
            file,
            where: `topic "${t.title}" source "${option.id}"`,
            url: option.url,
          });
      for (const option of plan.optional ?? [])
        out.push({
          file,
          where: `topic "${t.title}" optional source "${option.id}"`,
          url: option.url,
        });
    }
    for (const p of doc.proposedPrompts)
      if (p.promptKind === 'problem' && p.url)
        out.push({ file, where: `card on "${p.topicTitle}"`, url: p.url });
  }
  return out;
}
