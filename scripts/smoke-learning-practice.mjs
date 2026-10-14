// Actual Vite UI + in-memory API fixtures, isolated headless Brave profile.
// No repo .env, live API, database, existing browser profile or external requests.
// Run: node scripts/smoke-learning-practice.mjs
// This launches a browser and a loopback server; request host approval where required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await mkdtemp('/private/tmp/terrain-practice-smoke-');
const emptyEnv = path.join(output, 'empty-env');
const profile = path.join(output, 'browser-profile');
await mkdir(emptyEnv);
await mkdir(profile);
const topicId = '00000000-0000-4000-8000-000000000101';
const sessionId = '00000000-0000-4000-8000-000000000102';
const timestamp = '2026-10-14T12:00:00.000Z';
const topic = {
  id: topicId,
  title: 'Smoke fixture · Merkle proof',
  domain: 'Web3',
  topicType: 'pattern',
  status: 'active',
  description: 'Fixture only: explain a changed Merkle proof.',
  summary: 'Fixture only; no learner record.',
  noteRef: null,
  parentId: null,
  nextReviewAt: null,
  learnedAt: timestamp,
  aiProposed: false,
  aiContext: null,
  sourcePlan: { policy: 'none', rationale: 'Synthetic UI fixture; no source consumption claimed.' },
  createdAt: timestamp,
  updatedAt: timestamp,
  prerequisiteIds: [],
  children: [],
  blockers: [],
  labels: { blocked: false, reviewing: false },
  prompts: [],
  mastery: { retention: false, application: false, teaching: false, eligible: false },
  appEventCount: 0,
  appEvents: [],
  prerequisites: [],
  dependents: [],
  reviews: [],
  sourceEvidence: [],
};
const event = {
  topicTitle: topic.title,
  resolvedTopicId: topicId,
  kind: 'problem_solved',
  description: 'Synthetic imported practice for UI smoke; not learner evidence.',
};
const plan = {
  sessionExportId: sessionId,
  alreadyImported: false,
  reviews: [],
  newTopics: [],
  newPrompts: [],
  noteSummaries: [],
  nextSession: null,
  unresolved: [],
  applicable: true,
  activations: [],
  applicationEvents: [event],
  sourceEvidence: [],
  sourceIssues: [],
};
const applied = {
  sessionExportId: sessionId,
  reviewsApplied: 0,
  topicsCreated: [],
  promptsCreated: 0,
  duplicatePromptsSkipped: 0,
  noteSummariesApplied: 0,
  appEventsApplied: 1,
  nextSessionStored: false,
  topicsActivated: 0,
  topicsMastered: 0,
  sourceEvidenceApplied: 0,
};
const requests = [];
const unexpected = [];
const consoleErrors = [];
const dialogs = [];
const checks = [];
let savedPractice;
let browser;
let ws;
let server;

const fixture = {
  name: 'terrain-practice-fixture',
  configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      const pathname = new URL(req.url, 'http://fixture.invalid').pathname.slice(4);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      requests.push({ method: req.method, pathname, body });
      let value;
      if (req.method === 'GET') {
        if (pathname === '/auth/me')
          value = { id: 'smoke-user', name: 'Smoke fixture', email: 'fixture@example.invalid' };
        else if (pathname === '/streak')
          value = { currentStreak: 0, longestStreak: 0, freezeBalance: 0 };
        else if (pathname === '/settings')
          value = { timezone: 'Europe/Bucharest', obsidianVault: null };
        else if (pathname === '/topics') value = [topic];
        else if (pathname === `/topics/${topicId}`) value = topic;
        else if (pathname === `/topics/${topicId}/notes`)
          value = { body: 'Synthetic browser fixture only.', revision: 1, updatedAt: null };
        else if (pathname === `/topic-writing/${topicId}/notes`)
          value = {
            body: 'Synthetic browser fixture only.',
            revision: 1,
            origin: 'learner',
            review: null,
          };
        else if (pathname === '/topic-types') value = [{ key: 'pattern', label: 'pattern' }];
        else if (pathname === '/skill-checks')
          value = { today: '2026-10-14', timezone: 'Europe/Bucharest', checks };
      } else if (req.method === 'POST') {
        if (pathname === '/sessions/import/preview') value = plan;
        else if (pathname === '/sessions/import') value = applied;
        else if (pathname === `/topics/${topicId}/app-events`) {
          savedPractice = body;
          value = { ...body, topicId, id: 'smoke-event', appliedAt: timestamp };
          topic.appEvents.push(value);
          topic.appEventCount = topic.appEvents.length;
        }
      }
      if (value === undefined) {
        unexpected.push(`${req.method} ${pathname}`);
        res.statusCode = 500;
        value = { message: 'Unexpected fixture request; no live fallback is permitted.' };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    });
  },
};

try {
  server = await createServer({
    configFile: false,
    envDir: emptyEnv,
    root: path.join(root, 'apps/web'),
    cacheDir: path.join(output, 'vite-cache'),
    plugins: [react(), fixture],
    resolve: {
      alias: {
        '@terrain/types': path.join(root, 'packages/types/src/index.ts'),
        '@terrain/sr-engine': path.join(root, 'packages/sr-engine/src/index.ts'),
      },
    },
    server: { host: '127.0.0.1', port: 5187, strictPort: true, fs: { allow: [root] } },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = spawn(
    process.env.BRAVE_BIN ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const browserLog = [];
  browser.stderr.on('data', (chunk) => browserLog.push(chunk.toString()));
  let browserError;
  browser.on('error', (error) => {
    browserError = error;
  });
  let debuggerPort;
  for (let attempt = 0; attempt < 100 && !debuggerPort; attempt++) {
    if (browserError) throw browserError;
    try {
      debuggerPort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(
        '\n',
      )[0];
    } catch {
      await sleep(100);
    }
  }
  assert(debuggerPort, `Brave debugger failed: ${browserLog.join('').slice(-2000)}`);
  const targets = await (await fetch(`http://127.0.0.1:${debuggerPort}/json`)).json();
  ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (pending.has(msg.id)) {
      const request = pending.get(msg.id);
      clearTimeout(request.timer);
      pending.delete(msg.id);
      if (msg.error) request.reject(new Error(JSON.stringify(msg.error)));
      else request.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      consoleErrors.push(msg.params.args);
    if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push(msg.params.message);
      void send('Page.handleJavaScriptDialog', { accept: false });
    }
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      const allowed = request.url.startsWith(`${origin}/`) || request.url.startsWith('data:');
      void send(
        allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' },
      );
    }
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(
      `UI timeout: ${label}; text=${await evaluate('document.body.textContent.slice(-5000)')}`,
    );
  };
  const click = async (text) => {
    await evaluate(
      `(() => { const target = [...document.querySelectorAll('button,a,summary')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!target) throw new Error('No control: ' + ${JSON.stringify(text)}); target.click(); })()`,
    );
  };
  const fill = async (locator, value) => {
    await evaluate(
      `(() => { const element = ${locator}; if (!element) throw new Error('Missing input'); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
    );
  };
  const byLabel = (label) =>
    `[...document.querySelectorAll('label')].find(e => e.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea,select')`;
  const screenshot = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${origin}/import` });
  await until(`!!document.querySelector('[aria-label="Chat session output"]')`, 'import screen');
  await fill(
    `document.querySelector('[aria-label="Chat session output"]')`,
    JSON.stringify({
      version: 2,
      sessionId,
      applicationEvents: [
        { topicTitle: event.topicTitle, kind: event.kind, description: event.description },
      ],
    }),
  );
  await until(
    `[...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Apply import' && !e.disabled)`,
    'preview is applicable',
  );
  await click('Apply import');
  await until(
    `!!document.querySelector('[aria-label="Practice after import"] a')`,
    'contextual practice link',
  );
  await evaluate(
    `document.querySelector('[aria-label="Practice after import"]').scrollIntoView({ block: 'center' })`,
  );
  await screenshot('01-import-practice-handoff');
  assert.equal(
    requests.filter((r) => r.method === 'POST' && r.pathname === '/skill-checks').length,
    0,
  );
  await click(`Plan a changed case: ${topic.title}`);
  await until(
    `[...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Schedule skill check')`,
    'existing skill check form',
  );
  assert.equal(await evaluate('location.search'), '?practice=plan');
  assert.equal(await evaluate('location.hash'), '#practice');
  await evaluate(`document.querySelector('#practice').scrollIntoView({ block: 'start' })`);
  await screenshot('02-existing-skill-check-form');
  await fill(
    `document.querySelector('[aria-label="Work performed"]')`,
    'Synthetic smoke practice: inspected a changed proof case.',
  );
  await fill(
    `document.querySelector('[aria-label="Practice artifact link"]')`,
    'https://example.invalid/repo/commit/smoke-only',
  );
  await click('Code, checks and continuation (optional)');
  await fill(byLabel('File and version'), 'practice/proof.ts @ smoke-fixture-commit');
  await fill(byLabel('Check command'), 'yarn test proof');
  await fill(byLabel('Observed result'), 'Synthetic fixture assertion: altered branch rejected.');
  await fill(byLabel('Help used'), 'hints');
  await fill(byLabel('Next step'), 'Try a different branch after a delay.');
  await evaluate(`document.querySelector('.sidebar a[href="/import"]').click()`);
  await until(
    `${JSON.stringify(topicId)} === location.pathname.split('/').at(-1) && !!document.querySelector('[data-practice-dirty]')`,
    'cancelled dirty navigation',
  );
  assert(
    dialogs.some((message) => message.includes('practice record has unsaved work')),
    'Missing dirty practice warning',
  );
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="Work performed"]').value`),
    'Synthetic smoke practice: inspected a changed proof case.',
  );
  await click('Save practice');
  await until(
    `!![...document.querySelectorAll('a')].find(e => e.textContent.includes('Continue from saved artifact')) && !document.querySelector('[data-practice-dirty]')`,
    'saved artifact and cleared draft',
  );
  assert.equal(savedPractice.kind, 'problem_solved');
  assert.equal(savedPractice.url, 'https://example.invalid/repo/commit/smoke-only');
  for (const line of [
    'Code / version: practice/proof.ts @ smoke-fixture-commit',
    'Check command: yarn test proof',
    'Observed result: Synthetic fixture assertion: altered branch rejected.',
    'Help used: Hints',
    'Next step: Try a different branch after a delay.',
  ])
    assert(savedPractice.description.includes(line), `Missing saved field: ${line}`);
  assert.deepEqual(Object.keys(savedPractice).sort(), ['description', 'kind', 'url']);
  await evaluate(`document.querySelector('#practice').scrollIntoView({ block: 'start' })`);
  await screenshot('03-saved-practice-artifact');
  assert.deepEqual(unexpected, [], 'Unexpected API requests');
  assert.deepEqual(consoleErrors, [], 'Browser errors');
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        output,
        checks: [
          'import application event exposes contextual link',
          'link opens existing Skill check form without scheduling',
          'dirty navigation warns and keeps draft when cancelled',
          'artifact/version/check/help/next step preserved in existing event payload',
          'saved practice clears dirty state and shows continue link',
        ],
        consoleErrors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ requests, unexpected, consoleErrors, dialogs, savedPractice }, null, 2),
  );
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  browser?.kill('SIGTERM');
  await server?.close();
  console.log(`Smoke artifacts: ${output}`);
}
