// Preview-gated import of content/web3 into the user's real account.
//   node scripts/import-web3.mjs [--dry-run] [--from NN] [--verify-only]
// Env: TERRAIN_API (default http://localhost:3000), TERRAIN_EMAIL,
//      TERRAIN_PASSWORD, TERRAIN_NAME (used only if registration is needed).
import { loadContentFiles, structuralErrors, norm } from './lib/web3-content.mjs';
import { isDeepStrictEqual } from 'node:util';

const API = process.env.TERRAIN_API ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERIFY_ONLY = args.includes('--verify-only');
const FROM = args.includes('--from') ? args[args.indexOf('--from') + 1] : '00';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

export function importedWeb3Errors(expectedTopics, actualTopics) {
  const errors = [];
  const groupByTitle = (topics) => {
    const groups = new Map();
    for (const topic of topics.filter((topic) => topic.domain === 'Web3')) {
      const title = norm(topic.title);
      groups.set(title, [...(groups.get(title) ?? []), topic]);
    }
    return groups;
  };
  const expected = groupByTitle(expectedTopics);
  const actual = groupByTitle(actualTopics);

  for (const [title, rows] of expected)
    if (rows.length > 1)
      errors.push(`duplicate prepared Web3 title "${title}" (${rows.length} rows)`);
  for (const [title, rows] of actual)
    if (rows.length > 1)
      errors.push(`duplicate imported Web3 title "${title}" (${rows.length} rows)`);

  for (const [title, rows] of expected) {
    const imported = actual.get(title);
    if (!imported) {
      errors.push(`missing Web3 topic "${rows[0].title}"`);
      continue;
    }
    const prepared = rows[0];
    if (prepared.type !== 'pattern' || imported.length !== 1) continue;
    if (imported[0].sourcePlan == null)
      errors.push(`pattern "${prepared.title}" has no sourcePlan`);
    else if (!isDeepStrictEqual(imported[0].sourcePlan, prepared.sourcePlan))
      errors.push(`pattern "${prepared.title}" sourcePlan does not match prepared content`);
  }
  for (const [title, rows] of actual)
    if (!expected.has(title)) errors.push(`extra Web3 topic "${rows[0].title}"`);

  return errors;
}

export function importedCardCountError(title, expectedCards, detail) {
  const actualCards = (detail.prompts ?? []).length;
  return actualCards === expectedCards
    ? null
    : `"${title}": ${actualCards} cards, expected ${expectedCards}`;
}

let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  const setCookie = res.headers.getSetCookie?.()[0];
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login() {
  const { TERRAIN_EMAIL: email, TERRAIN_PASSWORD: password, TERRAIN_NAME: name } = process.env;
  if (!email || !password) die('set TERRAIN_EMAIL and TERRAIN_PASSWORD');
  let r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status === 401 || r.status === 404) {
    if (!name) die(`login failed (${r.status}) and TERRAIN_NAME not set for registration`);
    console.log(`login failed (${r.status}) — registering ${email}`);
    r = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }
  if (r.status >= 300) die(`auth failed: ${r.status} ${JSON.stringify(r.body)}`);
  console.log(`authenticated as ${email}`);
}

async function importFile({ file, doc }) {
  const exp = await api('/sessions/export');
  if (exp.status !== 200 || !exp.body?.id) die(`${file}: export mint failed ${exp.status}`);
  const raw = '```learning-os\n' + JSON.stringify({ ...doc, sessionId: exp.body.id }) + '\n```';

  const prev = await api('/sessions/import/preview', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
  if (prev.status !== 200)
    die(`${file}: preview failed ${prev.status} ${JSON.stringify(prev.body)}`);
  const plan = prev.body;
  const toCreate = plan.newTopics.filter((t) => !t.alreadyExists);
  console.log(
    `${file}: preview — ${toCreate.length}/${plan.newTopics.length} topics to create, ` +
      `${plan.newPrompts.length} cards, ${plan.unresolved.length} unresolved`,
  );
  if (plan.unresolved.length > 0)
    die(`${file}: unresolved refs:\n${JSON.stringify(plan.unresolved, null, 2)}`);
  if (toCreate.length === 0) {
    console.log(`${file}: all topics already exist — SKIPPING (already imported)`);
    return { skipped: true };
  }
  if (toCreate.length !== doc.proposedTopics.length)
    die(
      `${file}: PARTIAL overlap — ${doc.proposedTopics.length - toCreate.length} topics already exist; resolve manually`,
    );
  if (plan.newPrompts.length !== doc.proposedPrompts.length)
    die(
      `${file}: preview plans ${plan.newPrompts.length} cards, file has ${doc.proposedPrompts.length}`,
    );
  if (DRY) return { dryRun: true };

  const res = await api('/sessions/import', { method: 'POST', body: JSON.stringify({ raw }) });
  if (res.status >= 300) die(`${file}: apply failed ${res.status} ${JSON.stringify(res.body)}`);
  console.log(`${file}: APPLIED — ${JSON.stringify(res.body)}`);
  return { applied: true };
}

async function verify(files) {
  const list = await api('/topics');
  if (list.status !== 200) die(`verify: GET /topics failed ${list.status}`);
  const web3 = list.body.filter((t) => t.domain === 'Web3');
  const expectedTopics = files.flatMap((f) => f.doc.proposedTopics);
  const byTitle = new Map(web3.map((t) => [norm(t.title), t]));
  let fail = 0;
  const bad = (msg) => (console.error(`VERIFY FAIL: ${msg}`), fail++);

  const cardsByTitle = new Map();
  for (const f of files)
    for (const p of f.doc.proposedPrompts)
      cardsByTitle.set(norm(p.topicTitle), (cardsByTitle.get(norm(p.topicTitle)) ?? 0) + 1);
  let expectedEdges = 0;
  for (const t of expectedTopics) {
    const row = byTitle.get(norm(t.title));
    if (!row) {
      bad(`missing topic "${t.title}"`);
      continue;
    }
    expectedEdges += new Set(t.prerequisiteTitles.map(norm)).size;
  }
  const actualEdges = web3.reduce((n, t) => n + (t.prerequisiteIds?.length ?? 0), 0);
  if (actualEdges !== expectedEdges) bad(`prereq edges: ${actualEdges}, expected ${expectedEdges}`);

  const leaves = expectedTopics.filter((t) => t.type === 'pattern');
  const details = new Map();
  console.log(`sweeping ${leaves.length} leaves for autoGenerated/field checks (paced)...`);
  for (const t of leaves) {
    const row = byTitle.get(norm(t.title));
    if (!row) continue;
    const detail = await api(`/topics/${row.id}`);
    if (detail.status !== 200) {
      bad(`GET /topics/${row.id} -> ${detail.status}`);
      continue;
    }
    details.set(row.id, detail.body);
    const cardCountError = importedCardCountError(
      t.title,
      cardsByTitle.get(norm(t.title)) ?? 0,
      detail.body,
    );
    if (cardCountError) bad(cardCountError);
    for (const p of detail.body.prompts ?? []) {
      if (p.autoGenerated) bad(`"${t.title}": autoGenerated starter card ${p.id} exists`);
      if (p.promptKind === 'problem' && !p.url)
        bad(`"${t.title}": problem card ${p.id} missing url`);
    }
    await sleep(650);
  }
  const importedTopics = web3.map((topic) => details.get(topic.id) ?? topic);
  for (const error of importedWeb3Errors(expectedTopics, importedTopics)) bad(error);
  console.log(fail === 0 ? 'VERIFY OK' : `VERIFY: ${fail} failures`);
  if (fail > 0) process.exit(1);
}

async function main() {
  const files = await loadContentFiles();
  const errs = structuralErrors(files);
  if (errs.length > 0)
    die(`structural errors — run validate-web3-content.mjs:\n${errs.join('\n')}`);
  await login();
  if (!VERIFY_ONLY) {
    for (const f of files) {
      if (f.file < FROM) continue;
      await importFile(f);
      await sleep(650);
    }
  }
  if (!DRY) await verify(files);
}

if (import.meta.main) await main();
