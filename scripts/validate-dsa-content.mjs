// CLI: structural validation of content/dsa (always) + optional LeetCode
// URL/difficulty verification. Usage:
//   node scripts/validate-dsa-content.mjs [--dir <path>] [--check-urls [NN]]
import { loadContentFiles, structuralErrors, CONTENT_DIR } from './lib/dsa-content.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1]?.startsWith('--') ? true : (args[i + 1] ?? true);
};
const dir = typeof flag('--dir') === 'string' ? flag('--dir') : CONTENT_DIR;
const checkUrls = flag('--check-urls'); // true | 'NN' | undefined
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const files = await loadContentFiles(dir).catch((e) => {
  console.error(`LOAD FAIL: ${e.message}`);
  process.exit(1);
});
const errors = structuralErrors(files);
for (const e of errors) console.error(`STRUCTURAL: ${e}`);
console.log(
  `${files.length} files, ${files.reduce((n, f) => n + f.doc.proposedTopics.length, 0)} topics, ` +
    `${files.reduce((n, f) => n + f.doc.proposedPrompts.length, 0)} cards — ${errors.length} structural errors`,
);
if (errors.length > 0) process.exit(1);

if (checkUrls !== undefined) {
  const scope =
    typeof checkUrls === 'string' ? files.filter((f) => f.file.startsWith(checkUrls)) : files;
  const problems = scope.flatMap((f) =>
    f.doc.proposedPrompts
      .filter((p) => p.promptKind === 'problem')
      .map((p) => ({
        file: f.file,
        topic: p.topicTitle,
        url: p.url,
        difficulty: p.problemDifficulty,
      })),
  );
  let bad = 0;
  for (const p of problems) {
    const lc = p.url.match(/^https:\/\/leetcode\.com\/problems\/([^/]+)\/?$/);
    if (!lc) {
      console.log(`MANUAL-CHECK (non-LeetCode): ${p.url} [${p.file}]`);
      continue;
    }
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query($slug:String!){question(titleSlug:$slug){title difficulty}}',
        variables: { slug: lc[1] },
      }),
    });
    const q = (await res.json())?.data?.question;
    if (!q) {
      console.error(`URL FAIL: ${p.url} — no such slug [${p.file}/${p.topic}]`);
      bad++;
    } else if (q.difficulty.toLowerCase() !== p.difficulty) {
      console.error(
        `DIFFICULTY FAIL: ${p.url} is ${q.difficulty}, card says ${p.difficulty} [${p.file}]`,
      );
      bad++;
    }
    await sleep(250);
  }
  console.log(`${problems.length} problem urls checked, ${bad} failures`);
  if (bad > 0) process.exit(1);
}
