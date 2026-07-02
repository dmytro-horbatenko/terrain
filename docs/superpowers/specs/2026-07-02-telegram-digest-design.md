# Telegram Digest & Streak Nudge — Design

- **Date:** 2026-07-02
- **Status:** Design approved (brainstormed with user; scope, linking, timing,
  framework, and transport decided explicitly)
- **Context:** implements learning-science roadmap Stage 2 (reminders) at the
  scope the 2026-07-02 deep review recommended (rec #5: "a daily Telegram
  digest with a deep link is 90% of the value of the full bot conversation
  flows"). Supersedes founding-doc §11's full-bot scope (morning brief +
  quick-log + evening check-in + six commands) — the FSRS redesign made
  topic-level 0–5 quick logs evidence-only, so an honest in-Telegram grading
  flow would need per-card conversation state; deliberately cut. Also closes
  deep-review item #9's settings gap: `telegramChatId` is currently only
  settable via SQL because no settings write endpoint exists.

## Purpose

Nothing tells the user a review is due; spaced repetition only works if the
review happens near the scheduled moment, and "a streak without reminders is
a churn engine — you discover the break after the fact." Two messages fix
this:

1. **Morning digest** — what's due, how long it will take, streak, next-up
   focus, deep link into the app. Sent daily at a per-user hour.
2. **Evening streak nudge** — sent only on days with zero reviews logged and
   cards due: the streak is about to break and one short session saves it.

## Decisions (user-confirmed)

1. **Scope:** digest + nudge only. No in-Telegram grading, no evening
   check-in, no commands beyond `/start`. Grading flows can be added later
   without redesign because all outbound composition is isolated in one
   service.
2. **Linking:** deep-link token. Settings page button → API issues a one-time
   15-minute token → opens `https://t.me/<bot>?start=<token>` → bot's
   `/start` handler resolves the token and saves the chat id. `telegramChatId`
   is never writable through the settings PATCH.
3. **Timing:** per-user configurable hours (`digestHour`, `nudgeHour`,
   null = off), interpreted in the existing `Settings.timezone`.
4. **Framework:** grammY (best-maintained TS bot framework; clean
   `webhookCallback` adapter).
5. **Transport:** webhook in prod (`TELEGRAM_WEBHOOK_URL` +
   `secret_token`), long polling in dev (env-driven switch, same handlers
   both ways). No tunnel requirement for local dev.
6. **Digest cadence:** sent daily even when nothing is due (compact
   "all clear" variant) — the message is the habit anchor. The nudge is
   silent on active days.

## Data model (additive migration — no reset)

`Settings` gains:

```prisma
digestHour                 Int?      @default(9)   // user-local hour; null = digest off
nudgeHour                  Int?      @default(20)  // user-local hour; null = nudge off
telegramLinkToken          String?   @unique       // one-time, short-lived
telegramLinkTokenExpiresAt DateTime?
```

One active link token per user, stored on the row it links. No new tables.

## API surface

- **`PATCH /settings`** (new; also unblocks `obsidianVault` from the UI —
  deep-review web item): upserts `obsidianVault`, `timezone`
  (IANA-validated), `digestHour`, `nudgeHour` (each 0–23 or null).
  Rejects unknown fields; does **not** accept `telegramChatId`.
- **`POST /settings/telegram/link-token`**: crypto-random token (32 hex
  chars), 15-min expiry, upserts onto Settings (replacing any prior token),
  returns `{ url: "https://t.me/<TELEGRAM_BOT_USERNAME>?start=<token>" }`.
  503 if the bot is not configured.
- **`POST /settings/telegram/unlink`**: clears `telegramChatId`.
- **`GET /settings`**: extended with the new fields plus derived
  `telegramLinked: boolean` (raw chat id is not returned).

## Telegram module (`apps/api/src/telegram/`)

- `telegram.module.ts` — wires service, cron, webhook controller.
- `telegram.service.ts` — owns the grammY `Bot`. Built in `onModuleInit`
  **only if `TELEGRAM_BOT_TOKEN` is set**; otherwise the service is inert
  (sends no-op, one startup log line) so dev-without-bot and CI are
  untouched. `bot.stop()` in `onModuleDestroy` (requires
  `enableShutdownHooks()` in `main.ts` — currently missing, added here).
- **Inbound:** single `/start <token>` handler — a thin grammY wrapper over
  `linkAccount(token, chatId)` in the service: look up Settings by token,
  check expiry, write `telegramChatId`, clear both token fields, reply
  "Linked ✅". Unknown/expired token → friendly reply pointing at web
  Settings; no state change. Any other message → same pointer reply.
- **Transport switch:** `TELEGRAM_WEBHOOK_URL` set → `setWebhook(url,
  { secret_token: TELEGRAM_WEBHOOK_SECRET })` on boot; `POST
  /telegram/webhook` controller delegates to grammY's `webhookCallback`,
  is `@Public()` (JWT) and throttler-exempt — the secret-token header is its
  auth, checked inside the callback (mismatch → 401). Unset → `bot.start()`
  long polling.
- **Env (all optional):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
  (deep-link URL), `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET` (prod
  pair), `WEB_BASE_URL` (links back into the app).

## Scheduling (`telegram.cron.ts`)

One hourly cron (`0 * * * *`). Each tick:

1. Load users with a non-null `telegramChatId`.
2. Compute each user's local hour from `Settings.timezone` via
   `Intl.DateTimeFormat`.
3. Local hour == `digestHour` → send digest. Local hour == `nudgeHour` →
   send nudge **only if** zero reviews logged today (user-local day) **and**
   due cards exist.

Per-user try/catch (streak-cron pattern) — one failure never blocks the
rest. DST caveat accepted: the once-a-year repeated/skipped local hour can
duplicate or skip one message; no send-state tracking.

## Messages (HTML parse mode, inline URL keyboard)

Composed by pure functions (data in → string out) from existing services:
`MetricsService.dueCards` (grouped by `promptKind`, `estimatedMinutes`
summed with per-kind fallbacks concept 2' / code 10' / problem 30'),
`dueTopics` (overdue count), `StreakService` (streak), `nextUp`.

Digest:

> 🌄 **Terrain — Wed, Jul 2**
> Due: 7 cards (3 concept · 2 code · 2 problem) · ~40 min
> Overdue topics: 2 · Streak: 12 🔥
> Next up: Interval DP
> \[Start review\] → `WEB_BASE_URL`

Zero due → one-liner: "All clear — nothing due today. Streak 12 🔥".

Nudge:

> ⚠️ Streak (12) at risk — nothing logged today.
> 5 cards due · ~15 min. One review keeps the day.
> \[Review now\]

## Error handling

- Send returns 403 ("bot was blocked by the user") → clear
  `telegramChatId`, log; user relinks from Settings.
- Other send errors → log and continue.
- Expired/unknown/reused link token → friendly bot reply, no state change.
- Bot not configured → link-token endpoint 503; crons and webhook inert.

## Web (existing Settings screen)

New "Notifications" card following the screen's existing form/mutation/toast
patterns: timezone field, digest-hour and nudge-hour selects (0–23 plus
"Off"), and a Connect Telegram button — calls the link-token endpoint, opens
the returned `t.me` URL, refetches settings to flip to "Linked ✓" with an
Unlink button. Also surfaces `obsidianVault` (previously unsettable).

## Testing

- **Unit (jest, existing suite; grammY `Api` mocked, no network):**
  - `linkAccount`: valid, expired, unknown, and already-used token.
  - Digest and nudge composers against fixtures (incl. zero-due variant and
    estimated-minutes fallbacks).
  - Local-hour matching across timezones, including a DST-transition case.
  - Nudge suppression when reviews exist today or nothing is due.
  - 403-on-send clears `telegramChatId`.
  - `PATCH /settings` validation: hour bounds, IANA timezone, unknown-field
    rejection, `telegramChatId` not writable.
- **Manual smoke:** dev-mode polling against a real test bot — link from the
  Settings screen, trigger a digest, tap the deep link.

## Out of scope (future)

In-Telegram card grading (again/hard/good/easy inline keyboards), evening
check-in → `DailyLog`, `/today`-style commands, `/brief` Claude export,
per-message send-state tracking for DST exactness.
