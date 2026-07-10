// Shared loader + structural checks for content/web3/*.json (learning-os v2).
// Used by validate-web3-content.mjs (CLI) and import-web3.mjs (pre-flight).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { learningOsV2Schema } from '@terrain/types';

export const CONTENT_DIR = path.resolve(import.meta.dirname, '../../content/web3');
export const norm = (s) => s.trim().toLowerCase();
const URL_RE = /https?:\/\/[^\s)]+/;

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
export function structuralErrors(files) {
  const errors = [];
  const seenTitles = new Map(); // norm(title) -> file
  for (const { file, doc } of files) {
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
      if (t.type === 'pattern') {
        // Leaf content-model checks: description carries a resource URL; aiContext carries Build + Done-when.
        if (!URL_RE.test(t.description ?? ''))
          errors.push(`${file}: leaf "${t.title}" description has no Resources: URL`);
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

// All external URLs referenced anywhere (descriptions + problem-card urls).
export function allUrls(files) {
  const out = [];
  for (const { file, doc } of files) {
    for (const t of doc.proposedTopics)
      for (const m of (t.description ?? '').matchAll(/https?:\/\/[^\s)]+/g))
        out.push({ file, where: `topic "${t.title}"`, url: m[0].replace(/[.,;]+$/, '') });
    for (const p of doc.proposedPrompts)
      if (p.url) out.push({ file, where: `card on "${p.topicTitle}"`, url: p.url });
  }
  return out;
}
