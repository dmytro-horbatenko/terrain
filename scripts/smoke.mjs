// Headless UI smoke for the Terrain web app.
//
// No Chrome/Playwright in this environment, but Brave is. We drive it headless
// over the Chrome DevTools Protocol (Node has a global WebSocket). One-shot
// `--screenshot`/`--dump-dom` hang, so we open a debugging port and script it.
//
// Prereqs: the API (:3000) and the web dev server (:5180) must be running.
// Usage:   node scripts/smoke.mjs
// Exit:    non-zero if any route logs a console error / page exception.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BRAVE =
  process.env.BRAVE_BIN ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const PORT = 9222;
const BASE = process.env.WEB_BASE ?? 'http://localhost:5180';
const ROUTES = ['/', '/topics', '/roadmap', '/export', '/import'];

const brave = spawn(BRAVE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/brave-terrain-smoke',
  '--no-first-run',
  '--no-default-browser-check',
  // Required when the browser is Chromium running as non-root in a container;
  // harmless on the host's Brave.
  '--no-sandbox',
  '--disable-dev-shm-usage',
  'about:blank',
]);
brave.on('error', (e) => {
  console.error('Failed to launch Brave:', e.message);
  process.exit(1);
});
await sleep(1500);

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('No CDP page target found');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Runtime.exceptionThrown')
    errors.push(
      'exception: ' +
        (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text),
    );
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');

let failures = 0;
for (const route of ROUTES) {
  errors.length = 0;
  await send('Page.navigate', { url: BASE + route });
  await sleep(1800);
  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('root');
      const active = document.querySelector('.nav-link.active');
      const title = document.querySelector('.page-title')?.textContent || '';
      return JSON.stringify({
        rootLen: root ? root.innerHTML.length : 0,
        activeNav: active ? active.textContent.trim() : null,
        title: title.trim(),
      });
    })()`,
    returnByValue: true,
  });
  const info = JSON.parse(res.result.value);
  const ok = info.rootLen > 100 && errors.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? '✓' : '✗'} ${route.padEnd(9)} title=${JSON.stringify(info.title).padEnd(20)} ` +
      `nav=${info.activeNav} errors=${errors.length}`,
  );
  for (const e of errors) console.log('    ' + e);
}

ws.close();
brave.kill('SIGKILL');
console.log(failures === 0 ? '\nAll routes OK.' : `\n${failures} route(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
