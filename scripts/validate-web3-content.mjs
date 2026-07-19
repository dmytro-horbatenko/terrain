// CLI: structural validation of content/web3 (always) + optional live URL check
// + optional coverage-checklist check.
//   node scripts/validate-web3-content.mjs [--dir <path>] [--source-prefix NN]...
//     [--check-urls [NN]] [--check-coverage]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadContentFiles, structuralErrors, allUrls, CONTENT_DIR } from './lib/web3-content.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1
    ? undefined
    : args[i + 1]?.startsWith('--') || args[i + 1] === undefined
      ? true
      : args[i + 1];
};
const dir = typeof flag('--dir') === 'string' ? flag('--dir') : CONTENT_DIR;
const checkUrls = flag('--check-urls'); // true | 'NN' | undefined
const checkCoverage = flag('--check-coverage') !== undefined;
const sourcePrefixes = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--source-prefix') continue;
  const prefix = args[i + 1];
  if (!prefix || prefix.startsWith('--')) {
    console.error('--source-prefix requires a value');
    process.exit(2);
  }
  sourcePrefixes.push(prefix);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const files = await loadContentFiles(dir).catch((e) => {
  console.error(`LOAD FAIL: ${e.message}`);
  process.exit(1);
});
const errors = structuralErrors(files, { sourcePrefixes });
for (const e of errors) console.error(`STRUCTURAL: ${e}`);
console.log(
  `${files.length} files, ${files.reduce((n, f) => n + f.doc.proposedTopics.length, 0)} topics, ` +
    `${files.reduce((n, f) => n + f.doc.proposedPrompts.length, 0)} cards — ${errors.length} structural errors`,
);
if (errors.length > 0) process.exit(1);

if (checkUrls !== undefined) {
  const scope =
    typeof checkUrls === 'string'
      ? allUrls(files).filter((u) => u.file.startsWith(checkUrls))
      : allUrls(files);
  const seen = new Set();
  let bad = 0;
  for (const u of scope) {
    if (seen.has(u.url)) continue;
    seen.add(u.url);
    try {
      let res = await fetch(u.url, { method: 'HEAD', redirect: 'follow' });
      if (res.status === 405 || res.status === 403)
        res = await fetch(u.url, { method: 'GET', redirect: 'follow' });
      if (res.status >= 400) {
        console.error(`URL ${res.status}: ${u.url} [${u.file} ${u.where}]`);
        bad++;
      }
    } catch (e) {
      console.error(`URL ERR: ${u.url} — ${e.message} [${u.file} ${u.where}]`);
      bad++;
    }
    await sleep(300);
  }
  console.log(`${seen.size} unique urls checked, ${bad} failures`);
  if (bad > 0) process.exit(1);
}

if (checkCoverage) {
  const checklist = JSON.parse(await readFile(path.join(dir, 'coverage.json'), 'utf8'));
  const haystack = files
    .flatMap((f) => [
      ...f.doc.proposedTopics.map(
        (t) => `${t.title}\n${t.description ?? ''}\n${t.aiContext ?? ''}`,
      ),
      ...f.doc.proposedPrompts.map((p) => `${p.promptText}\n${p.answerHint ?? ''}\n${p.url ?? ''}`),
    ])
    .join('\n')
    .toLowerCase();
  let gaps = 0;
  for (const [group, items] of Object.entries(checklist)) {
    for (const item of items) {
      // each item is a plain-string needle that must appear somewhere in the authored corpus
      if (!haystack.includes(item.toLowerCase())) {
        console.error(`COVERAGE GAP [${group}]: "${item}" not found in any topic/card`);
        gaps++;
      }
    }
  }
  console.log(`coverage: ${gaps} gaps`);
  if (gaps > 0) process.exit(1);
}
