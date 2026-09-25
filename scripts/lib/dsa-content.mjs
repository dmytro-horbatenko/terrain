// Shared loader + structural checks for content/dsa/*.json (learning-os v2).
// Used by validate-dsa-content.mjs (CLI) and import-dsa.mjs (pre-flight).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { learningOsV2Schema } from '@terrain/types';
import { dependencyErrors } from './course-content.mjs';
import { sourcePlanErrors } from './web3-content.mjs';

export const CONTENT_DIR = path.resolve(import.meta.dirname, '../../content/dsa');
export const norm = (s) => s.trim().toLowerCase();

export async function loadContentFiles(dir = CONTENT_DIR) {
  const names = (await readdir(dir)).filter((n) => /^\d\d-.*\.json$/.test(n)).sort();
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
export function structuralErrors(files) {
  const errors = dependencyErrors(files);
  const seenTitles = new Map(); // norm(title) -> file
  const seenUrls = new Map(); // url -> `file/topicTitle`
  for (const { file, doc } of files) {
    const local = new Map(doc.proposedTopics.map((t) => [norm(t.title), t]));
    for (const t of doc.proposedTopics) {
      if (seenTitles.has(norm(t.title)))
        errors.push(
          `${file}: duplicate topic "${t.title}" (also in ${seenTitles.get(norm(t.title))})`,
        );
      if (/Problems:/.test(t.description ?? ''))
        errors.push(`${file}: "${t.title}" description still contains the prose "Problems:" list`);
      if (t.sourcePlan || t.parentTitle === 'DSA foundations')
        errors.push(...sourcePlanErrors(t, file));
    }
    for (const p of doc.proposedPrompts) {
      const target = local.get(norm(p.topicTitle));
      if (!target)
        errors.push(
          `${file}: prompt targets "${p.topicTitle}" — not a topic in the SAME file (starter-card rule)`,
        );
      else if (target.type !== 'pattern')
        errors.push(`${file}: prompt targets non-pattern topic "${p.topicTitle}"`);
      if (p.promptKind === 'problem') {
        if (!p.url || !p.problemDifficulty || !p.estimatedMinutes)
          errors.push(`${file}: problem card on "${p.topicTitle}" missing url/difficulty/estimate`);
        if (p.url) {
          if (seenUrls.has(p.url))
            errors.push(
              `${file}: duplicate problem url ${p.url} (also carded at ${seenUrls.get(p.url)})`,
            );
          seenUrls.set(p.url, `${file}/${p.topicTitle}`);
        }
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
        `${file}: fenced payload ${Buffer.byteLength(fenced)} bytes — over the 90KB safety margin`,
      );
    for (const t of doc.proposedTopics) seenTitles.set(norm(t.title), file);
  }
  return errors;
}
