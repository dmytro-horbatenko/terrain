# Local development runbook

How to bring up the full Terrain stack and verify it. See `AGENTS.md` for the
command reference and Prisma 7 / tooling specifics.

## 1. Start Postgres

Runs in Docker (OrbStack) on host port **5433**.

```bash
docker compose up -d
docker compose ps                 # confirm consistency-db-1 is healthy
```

Data persists in the `terrain_pg` Docker volume. **Never** `docker compose down -v`
— that deletes all your learning data. (The guard hook + deny rules block it.)

## 2. Apply migrations + seed

```bash
yarn workspace @terrain/api exec prisma migrate deploy
yarn workspace @terrain/api exec prisma generate
yarn workspace @terrain/api exec tsx prisma/seed.ts     # idempotent
```

## 3. Build + run

```bash
yarn build                                  # packages → api → web
yarn workspace @terrain/api start &         # API on :3000
yarn workspace @terrain/web dev &           # web on :5180, proxies /api → :3000
```

Open http://localhost:5180.

## 4. Stop the dev API

`pkill -f "nest start"` does **not** work — `nest start` spawns the real server as a
child `node .../dist/src/main`. Kill by port:

```bash
kill -9 $(lsof -ti:3000)      # API
kill -9 $(lsof -ti:5180)      # web dev server
```

A leftover zombie holds :3000 and a fresh `start` fails silently with EADDRINUSE,
then curls hit the stale process running old compiled code.

## 5. UI smoke (headless)

No Chrome/Playwright here, but Brave is, driven over CDP. With the API + web dev
server running:

```bash
node scripts/smoke.mjs
```

It loads every route, asserts each renders into `#root`, and fails on any console
error / page exception. Override the Brave path with `BRAVE_BIN=…` if needed.

CDP gotchas (already handled in the script):
- One-shot `--screenshot` / `--dump-dom` hang — use `--remote-debugging-port` + a
  CDP WebSocket instead.
- `Runtime.evaluate` returns the value at `result.result.value` (two levels).
- Use `.textContent`, not `.innerText`, in headless — `innerText` needs layout/paint
  and returns partial results.

## 6. Telegram bot (optional)

To test the Telegram digest locally:

1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in `apps/api/.env`.
2. Leave `TELEGRAM_WEBHOOK_URL` unset — the bot automatically falls back to
   long polling in dev.
3. In the Settings screen, click "Connect Telegram" and confirm the link in Telegram
   via the bot's `/start` handler.
4. To trigger a test digest without waiting an hour, call the internal `tick()` helper
   from a scratch script, e.g. `tick(new Date('2026-07-02T18:00:00Z'))` if your digest
   hour is 18. Alternatively, temporarily set `digestHour` to the next full hour in your
   timezone and wait for the cron to fire.

The bot sends no messages during local dev if `TELEGRAM_BOT_TOKEN` is unset.

## 7. Quality gates

```bash
yarn lint            # oxlint
yarn format:check    # oxfmt
yarn test            # all workspace tests
```

These also run on commit via the pre-commit hook (Husky + lint-staged).
