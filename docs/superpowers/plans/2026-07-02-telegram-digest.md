# Telegram Digest & Streak Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily Telegram digest + evening streak-at-risk nudge, per-user configurable hours, deep-link account linking — spec: `docs/superpowers/specs/2026-07-02-telegram-digest-design.md`.

**Architecture:** New `telegram` Nest module in `apps/api` owning a grammY `Bot` (webhook in prod via `TELEGRAM_WEBHOOK_URL`, long polling in dev; inert without `TELEGRAM_BOT_TOKEN`). An hourly cron matches each user's local hour (from `Settings.timezone`) against their `digestHour`/`nudgeHour` and composes messages from existing `MetricsService`/`StreakService` data. A new `SettingsService` adds the missing settings write path (`PATCH /settings`) plus the one-time-token linking endpoints.

**Tech Stack:** NestJS 11, Prisma 7, grammY, jest, React 19 + react-query (web).

## Global Constraints

- **No git commits.** Per `CLAUDE.md`: work stays uncommitted in the working tree; the user commits explicitly. Tasks therefore end with verification steps, not commit steps.
- **CommonJS** in `apps/api` — extensionless relative imports, no `"type": "module"`.
- **oxlint/oxfmt**, single quotes + trailing commas. Run `yarn lint` and `yarn format` at the end of each task.
- Run API tests with `yarn workspace @terrain/api test`. The suite must stay green.
- `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })` is global — unknown DTO fields are already rejected; DTOs only need the field rules.
- All Telegram env vars are optional; every new code path must degrade to a no-op (plus one log line / a 503) when `TELEGRAM_BOT_TOKEN` is unset.
- Postgres runs in Docker on **host port 5433**; `docker compose up -d` before any `prisma migrate` command.
- Prompt-kind minute fallbacks (spec): concept 2, code 10, problem 30.
- Never write `telegramChatId` from `PATCH /settings` — only the linking flow (`linkAccount`) and the 403-unlink path may set it, and only `unlink`/403 may clear it.

---

### Task 1: Settings schema fields + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Settings model, ~line 245)

**Interfaces:**
- Produces: `Settings` Prisma model rows now carry `digestHour: number | null` (default 9), `nudgeHour: number | null` (default 20), `telegramLinkToken: string | null` (unique), `telegramLinkTokenExpiresAt: Date | null`. Every later task's Prisma client calls rely on these fields existing.

- [ ] **Step 1: Edit the Settings model**

Replace the current model:

```prisma
model Settings {
  userId         String  @id
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  obsidianVault  String?
  telegramChatId String?
  timezone       String  @default("UTC")
}
```

with:

```prisma
model Settings {
  userId                     String    @id
  user                       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  obsidianVault              String?
  telegramChatId             String?
  timezone                   String    @default("UTC")
  digestHour                 Int?      @default(9) // user-local hour; null = digest off
  nudgeHour                  Int?      @default(20) // user-local hour; null = nudge off
  telegramLinkToken          String?   @unique // one-time, short-lived
  telegramLinkTokenExpiresAt DateTime?
}
```

- [ ] **Step 2: Create and apply the additive migration**

Run:
```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate dev --name telegram_digest_settings
```
Expected: a new folder under `apps/api/prisma/migrations/` containing `ALTER TABLE "Settings" ADD COLUMN ...` statements (four columns + a unique index), and "Your database is now in sync with your schema."

**Do NOT run `prisma migrate reset`** (denied by repo policy). This migration is additive; no reset is needed.

- [ ] **Step 3: Regenerate the client and verify the build**

Run:
```bash
yarn workspace @terrain/api exec prisma generate
yarn workspace @terrain/api build
```
Expected: both succeed.

---

### Task 2: SettingsService — view, PATCH /settings

**Files:**
- Create: `apps/api/src/settings/settings.service.ts`
- Create: `apps/api/src/settings/dto.ts`
- Create: `apps/api/src/settings/settings.service.spec.ts`
- Modify: `apps/api/src/settings/settings.controller.ts`
- Modify: `apps/api/src/settings/settings.module.ts`

**Interfaces:**
- Produces:
  - `SettingsView = { userId: string; obsidianVault: string | null; timezone: string; digestHour: number | null; nudgeHour: number | null; telegramLinked: boolean }` — the shape both `GET` and `PATCH /settings` return (raw `telegramChatId` is never returned).
  - `SettingsService.get(userId: string): Promise<SettingsView>`
  - `SettingsService.update(userId: string, dto: UpdateSettingsDto): Promise<SettingsView>`
  - `UpdateSettingsDto` with optional `obsidianVault: string | null`, `timezone: string`, `digestHour: number | null`, `nudgeHour: number | null`.
  - Task 3 adds `createLinkToken`/`unlinkTelegram` to this same service.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/settings/settings.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  obsidianVault: null,
  telegramChatId: null,
  timezone: 'UTC',
  digestHour: 9,
  nudgeHour: 20,
  telegramLinkToken: null,
  telegramLinkTokenExpiresAt: null,
  ...over,
});

describe('SettingsService', () => {
  let service: SettingsService;
  const prisma = {
    settings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(SettingsService);
  });

  it('get returns defaults when no row exists, without creating one', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    const view = await service.get('u1');
    expect(view).toEqual({
      userId: 'u1',
      obsidianVault: null,
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      telegramLinked: false,
    });
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });

  it('get maps a linked row to telegramLinked=true without exposing the chat id', async () => {
    prisma.settings.findUnique.mockResolvedValue(row({ telegramChatId: '12345' }));
    const view = await service.get('u1');
    expect(view.telegramLinked).toBe(true);
    expect(view).not.toHaveProperty('telegramChatId');
    expect(view).not.toHaveProperty('telegramLinkToken');
  });

  it('update upserts provided fields and returns the view', async () => {
    prisma.settings.upsert.mockResolvedValue(
      row({ timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null }),
    );
    const view = await service.update('u1', { timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null });
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null },
      update: { timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null },
    });
    expect(view.digestHour).toBe(8);
    expect(view.nudgeHour).toBeNull();
  });

  it('update omits undefined fields (partial patch)', async () => {
    prisma.settings.upsert.mockResolvedValue(row({ digestHour: 7 }));
    await service.update('u1', { digestHour: 7 });
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', digestHour: 7 },
      update: { digestHour: 7 },
    });
  });

  it('update rejects an invalid IANA timezone', async () => {
    await expect(service.update('u1', { timezone: 'Mars/Olympus' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });

  it('update never writes telegramChatId even if smuggled past the DTO', async () => {
    prisma.settings.upsert.mockResolvedValue(row());
    await service.update('u1', { telegramChatId: '666' } as never);
    const args = prisma.settings.upsert.mock.calls[0][0];
    expect(args.create).not.toHaveProperty('telegramChatId');
    expect(args.update).not.toHaveProperty('telegramChatId');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test settings.service`
Expected: FAIL — `Cannot find module './settings.service'`.

- [ ] **Step 3: Write the DTO**

Create `apps/api/src/settings/dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(500) obsidianVault?: string | null;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(23) nudgeHour?: number | null;
}
```

(`@IsOptional()` skips validation for both `undefined` and `null`, so `digestHour: null` — "off" — passes through; `whitelist + forbidNonWhitelisted` in the global pipe rejects any other key with a 400.)

- [ ] **Step 4: Write the service**

Create `apps/api/src/settings/settings.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto';

export interface SettingsView {
  userId: string;
  obsidianVault: string | null;
  timezone: string;
  digestHour: number | null;
  nudgeHour: number | null;
  telegramLinked: boolean;
}

const DEFAULTS = { obsidianVault: null, timezone: 'UTC', digestHour: 9, nudgeHour: 20 };

function toView(userId: string, row: Settings | null): SettingsView {
  return {
    userId,
    obsidianVault: row?.obsidianVault ?? DEFAULTS.obsidianVault,
    timezone: row?.timezone ?? DEFAULTS.timezone,
    digestHour: row ? row.digestHour : DEFAULTS.digestHour,
    nudgeHour: row ? row.nudgeHour : DEFAULTS.nudgeHour,
    telegramLinked: row?.telegramChatId != null,
  };
}

function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException(`Unknown IANA timezone: ${tz}`);
  }
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string): Promise<SettingsView> {
    const row = await this.prisma.settings.findUnique({ where: { userId } });
    return toView(userId, row);
  }

  async update(userId: string, dto: UpdateSettingsDto): Promise<SettingsView> {
    if (dto.timezone !== undefined) assertValidTimezone(dto.timezone);
    // Allowlist, not spread: telegramChatId and the link-token fields must be
    // unreachable from this endpoint regardless of what survives the DTO.
    const data: Record<string, unknown> = {};
    if (dto.obsidianVault !== undefined) data.obsidianVault = dto.obsidianVault;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.digestHour !== undefined) data.digestHour = dto.digestHour;
    if (dto.nudgeHour !== undefined) data.nudgeHour = dto.nudgeHour;
    const row = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toView(userId, row);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test settings.service`
Expected: PASS (6 tests).

- [ ] **Step 6: Rewire controller and module**

Replace `apps/api/src/settings/settings.controller.ts`:

```typescript
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdateSettingsDto } from './dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get() get(@CurrentUser() userId: string) {
    return this.settings.get(userId);
  }

  @Patch() update(@CurrentUser() userId: string, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(userId, dto);
  }
}
```

Replace `apps/api/src/settings/settings.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```

- [ ] **Step 7: Full verification**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint`
Expected: all pass. (The old GET returned raw `telegramChatId`; nothing in the API consumed it — the web mirror is updated in Task 8.)

---

### Task 3: Linking endpoints — link-token + unlink

**Files:**
- Modify: `apps/api/src/settings/settings.service.ts`
- Modify: `apps/api/src/settings/settings.service.spec.ts`
- Modify: `apps/api/src/settings/settings.controller.ts`

**Interfaces:**
- Consumes: `SettingsView`, `toView` from Task 2.
- Produces:
  - `SettingsService.createLinkToken(userId: string): Promise<{ url: string }>` — 503 when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` unset; token is 32 hex chars, expires in 15 min, stored on the Settings row (replacing any prior token).
  - `SettingsService.unlinkTelegram(userId: string): Promise<SettingsView>`
  - Routes: `POST /settings/telegram/link-token`, `POST /settings/telegram/unlink`.
  - Task 5's `linkAccount` reads `telegramLinkToken`/`telegramLinkTokenExpiresAt` written here.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `apps/api/src/settings/settings.service.spec.ts` (and add `ServiceUnavailableException` to the `@nestjs/common` import):

```typescript
  describe('createLinkToken', () => {
    const env = process.env;
    afterEach(() => {
      process.env = env;
    });

    it('503s when the bot is not configured', async () => {
      process.env = { ...env };
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_USERNAME;
      await expect(service.createLinkToken('u1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('stores a 32-hex token with ~15min expiry and returns the deep link', async () => {
      process.env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: 'terrain_bot' };
      prisma.settings.upsert.mockResolvedValue(row());
      const before = Date.now();
      const { url } = await service.createLinkToken('u1');
      const args = prisma.settings.upsert.mock.calls[0][0];
      const token = args.update.telegramLinkToken as string;
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(args.create.telegramLinkToken).toBe(token);
      const expiry = (args.update.telegramLinkTokenExpiresAt as Date).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 14 * 60_000);
      expect(expiry).toBeLessThanOrEqual(before + 16 * 60_000);
      expect(url).toBe(`https://t.me/terrain_bot?start=${token}`);
    });
  });

  it('unlinkTelegram clears the chat id', async () => {
    prisma.settings.upsert.mockResolvedValue(row({ telegramChatId: null }));
    const view = await service.unlinkTelegram('u1');
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1' },
      update: { telegramChatId: null },
    });
    expect(view.telegramLinked).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test settings.service`
Expected: FAIL — `service.createLinkToken is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/settings/settings.service.ts`, add to the imports:

```typescript
import { randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
```

(merge `ServiceUnavailableException` into the existing `@nestjs/common` import) and add these methods to `SettingsService`:

```typescript
  async createLinkToken(userId: string): Promise<{ url: string }> {
    const username = process.env.TELEGRAM_BOT_USERNAME;
    if (!process.env.TELEGRAM_BOT_TOKEN || !username) {
      throw new ServiceUnavailableException('Telegram bot is not configured on this server.');
    }
    const token = randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 15 * 60_000);
    await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, telegramLinkToken: token, telegramLinkTokenExpiresAt: expires },
      update: { telegramLinkToken: token, telegramLinkTokenExpiresAt: expires },
    });
    return { url: `https://t.me/${username}?start=${token}` };
  }

  async unlinkTelegram(userId: string): Promise<SettingsView> {
    const row = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: { telegramChatId: null },
    });
    return toView(userId, row);
  }
```

Add the routes to `apps/api/src/settings/settings.controller.ts` (add `Post` to the `@nestjs/common` import):

```typescript
  @Post('telegram/link-token') createLinkToken(@CurrentUser() userId: string) {
    return this.settings.createLinkToken(userId);
  }

  @Post('telegram/unlink') unlink(@CurrentUser() userId: string) {
    return this.settings.unlinkTelegram(userId);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test settings.service`
Expected: PASS (9 tests).

- [ ] **Step 5: Verify**

Run: `yarn workspace @terrain/api build && yarn lint`
Expected: pass.

---

### Task 4: Message composers (pure functions)

**Files:**
- Create: `apps/api/src/telegram/telegram.messages.ts`
- Create: `apps/api/src/telegram/telegram.messages.spec.ts`

**Interfaces:**
- Produces (all pure, no DI):
  - `estimateMinutes(cards: { promptKind: string; estimatedMinutes: number | null }[]): number` — sums `estimatedMinutes` with fallbacks concept 2 / code 10 / problem 30.
  - `composeDigest(d: DigestData): string` (HTML) where `DigestData = { date: Date; timezone: string; dueByKind: { concept: number; code: number; problem: number }; dueCount: number; estMinutes: number; overdueTopics: number; streak: number; nextUpTitle: string | null }`.
  - `composeNudge(d: NudgeData): string` where `NudgeData = { streak: number; dueCount: number; estMinutes: number }`.
- Task 6's cron calls all three.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/telegram/telegram.messages.spec.ts`:

```typescript
import { composeDigest, composeNudge, estimateMinutes } from './telegram.messages';

describe('estimateMinutes', () => {
  it('uses per-kind fallbacks when estimatedMinutes is null', () => {
    expect(
      estimateMinutes([
        { promptKind: 'concept', estimatedMinutes: null },
        { promptKind: 'code', estimatedMinutes: null },
        { promptKind: 'problem', estimatedMinutes: null },
      ]),
    ).toBe(2 + 10 + 30);
  });

  it('prefers explicit estimatedMinutes and handles empty input', () => {
    expect(estimateMinutes([{ promptKind: 'problem', estimatedMinutes: 45 }])).toBe(45);
    expect(estimateMinutes([])).toBe(0);
  });
});

describe('composeDigest', () => {
  const base = {
    date: new Date('2026-07-02T06:00:00Z'),
    timezone: 'UTC',
    dueByKind: { concept: 3, code: 2, problem: 2 },
    dueCount: 7,
    estMinutes: 40,
    overdueTopics: 2,
    streak: 12,
    nextUpTitle: 'Interval DP',
  };

  it('renders the full digest', () => {
    const html = composeDigest(base);
    expect(html).toContain('Wed, Jul 2');
    expect(html).toContain('Due: 7 cards (3 concept · 2 code · 2 problem) · ~40 min');
    expect(html).toContain('Overdue topics: 2 · Streak: 12 🔥');
    expect(html).toContain('Next up: Interval DP');
  });

  it('renders the all-clear one-liner when nothing is due', () => {
    const html = composeDigest({
      ...base,
      dueByKind: { concept: 0, code: 0, problem: 0 },
      dueCount: 0,
      estMinutes: 0,
      overdueTopics: 0,
    });
    expect(html).toContain('All clear — nothing due today. Streak 12 🔥');
    expect(html).not.toContain('Due:');
  });

  it('omits the next-up line when there is none and escapes HTML in titles', () => {
    expect(composeDigest({ ...base, nextUpTitle: null })).not.toContain('Next up');
    expect(composeDigest({ ...base, nextUpTitle: 'a < b & c' })).toContain('a &lt; b &amp; c');
  });

  it('formats the date in the user timezone', () => {
    // 23:30 UTC on Jul 2 is already Jul 3 in Kyiv (UTC+3 in summer)
    const html = composeDigest({
      ...base,
      date: new Date('2026-07-02T23:30:00Z'),
      timezone: 'Europe/Kyiv',
    });
    expect(html).toContain('Jul 3');
  });
});

describe('composeNudge', () => {
  it('renders streak, due count and estimate', () => {
    const html = composeNudge({ streak: 12, dueCount: 5, estMinutes: 15 });
    expect(html).toContain('Streak (12) at risk — nothing logged today.');
    expect(html).toContain('5 cards due · ~15 min. One review keeps the day.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test telegram.messages`
Expected: FAIL — `Cannot find module './telegram.messages'`.

- [ ] **Step 3: Implement**

Create `apps/api/src/telegram/telegram.messages.ts`:

```typescript
/**
 * Pure message composers for the Telegram digest + nudge. HTML parse mode
 * (Telegram's HTML subset: <b>, <i>, no block tags — newlines are literal).
 */

const KIND_FALLBACK_MINUTES: Record<string, number> = { concept: 2, code: 10, problem: 30 };

export interface DigestData {
  date: Date;
  timezone: string;
  dueByKind: { concept: number; code: number; problem: number };
  dueCount: number;
  estMinutes: number;
  overdueTopics: number;
  streak: number;
  nextUpTitle: string | null;
}

export interface NudgeData {
  streak: number;
  dueCount: number;
  estMinutes: number;
}

export function estimateMinutes(
  cards: { promptKind: string; estimatedMinutes: number | null }[],
): number {
  return cards.reduce(
    (sum, c) => sum + (c.estimatedMinutes ?? KIND_FALLBACK_MINUTES[c.promptKind] ?? 0),
    0,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function composeDigest(d: DigestData): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: d.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d.date);
  const lines = [`🌄 <b>Terrain — ${day}</b>`];
  if (d.dueCount === 0) {
    lines.push(`All clear — nothing due today. Streak ${d.streak} 🔥`);
  } else {
    const kinds = [
      d.dueByKind.concept > 0 ? `${d.dueByKind.concept} concept` : null,
      d.dueByKind.code > 0 ? `${d.dueByKind.code} code` : null,
      d.dueByKind.problem > 0 ? `${d.dueByKind.problem} problem` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`Due: ${d.dueCount} cards (${kinds}) · ~${d.estMinutes} min`);
    lines.push(`Overdue topics: ${d.overdueTopics} · Streak: ${d.streak} 🔥`);
  }
  if (d.nextUpTitle) lines.push(`Next up: ${escapeHtml(d.nextUpTitle)}`);
  return lines.join('\n');
}

export function composeNudge(d: NudgeData): string {
  return [
    `⚠️ Streak (${d.streak}) at risk — nothing logged today.`,
    `${d.dueCount} cards due · ~${d.estMinutes} min. One review keeps the day.`,
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test telegram.messages`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify**

Run: `yarn workspace @terrain/api build && yarn lint`
Expected: pass.

---

### Task 5: TelegramService — bot lifecycle, linkAccount, sendTo

**Files:**
- Modify: `apps/api/package.json` (add grammY)
- Create: `apps/api/src/telegram/telegram.service.ts`
- Create: `apps/api/src/telegram/telegram.service.spec.ts`
- Create: `apps/api/src/telegram/telegram.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts` (enableShutdownHooks)

**Interfaces:**
- Consumes: `telegramLinkToken`/`telegramLinkTokenExpiresAt` Settings fields (Tasks 1/3).
- Produces:
  - `TelegramService.isConfigured(): boolean`
  - `TelegramService.linkAccount(token: string, chatId: string): Promise<'linked' | 'invalid'>`
  - `TelegramService.sendTo(userId: string, chatId: string, html: string, button?: { text: string; url: string }): Promise<void>` — HTML parse mode, optional inline URL button; on Telegram 403 clears that user's `telegramChatId` and does not throw.
  - `TelegramService.getBot(): Bot | null` (Task 6's controller/handlers use it).
  - `TelegramModule` registered in `AppModule`.

- [ ] **Step 1: Install grammY**

Run: `yarn workspace @terrain/api add grammy`
Expected: `grammy` appears in `apps/api/package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/telegram/telegram.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

const future = () => new Date(Date.now() + 10 * 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('TelegramService', () => {
  let service: TelegramService;
  const prisma = {
    settings: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.TELEGRAM_BOT_TOKEN; // service stays inert; no real Bot
    const mod = await Test.createTestingModule({
      providers: [TelegramService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TelegramService);
  });

  describe('linkAccount', () => {
    it('links a valid unexpired token: writes chat id, clears token fields', async () => {
      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: future(),
      });
      prisma.settings.update.mockResolvedValue({});
      await expect(service.linkAccount('tok', '12345')).resolves.toBe('linked');
      expect(prisma.settings.findUnique).toHaveBeenCalledWith({
        where: { telegramLinkToken: 'tok' },
      });
      expect(prisma.settings.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: {
          telegramChatId: '12345',
          telegramLinkToken: null,
          telegramLinkTokenExpiresAt: null,
        },
      });
    });

    it('rejects an unknown token', async () => {
      prisma.settings.findUnique.mockResolvedValue(null);
      await expect(service.linkAccount('nope', '1')).resolves.toBe('invalid');
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token without state change', async () => {
      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: past(),
      });
      await expect(service.linkAccount('tok', '1')).resolves.toBe('invalid');
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await expect(service.linkAccount('', '1')).resolves.toBe('invalid');
      expect(prisma.settings.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('sendTo', () => {
    it('no-ops when the bot is not configured', async () => {
      await expect(service.sendTo('u1', '1', 'hi')).resolves.toBeUndefined();
    });

    it('sends HTML with an inline URL button', async () => {
      const sendMessage = jest.fn().mockResolvedValue({});
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      await service.sendTo('u1', '42', '<b>hi</b>', { text: 'Open', url: 'https://x' });
      expect(sendMessage).toHaveBeenCalledWith('42', '<b>hi</b>', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://x' }]] },
      });
    });

    it('clears telegramChatId when Telegram returns 403 (blocked), without throwing', async () => {
      const sendMessage = jest
        .fn()
        .mockRejectedValue({ error_code: 403, description: 'Forbidden: bot was blocked' });
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      prisma.settings.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.sendTo('u1', '42', 'hi')).resolves.toBeUndefined();
      expect(prisma.settings.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { telegramChatId: null },
      });
    });

    it('swallows and logs other send errors', async () => {
      const sendMessage = jest.fn().mockRejectedValue({ error_code: 400, description: 'bad' });
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      await expect(service.sendTo('u1', '42', 'hi')).resolves.toBeUndefined();
      expect(prisma.settings.updateMany).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test telegram.service`
Expected: FAIL — `Cannot find module './telegram.service'`.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/telegram/telegram.service.ts`:

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Owns the grammY Bot. Inert (all methods no-op) unless TELEGRAM_BOT_TOKEN is
 * set. Transport is env-driven: TELEGRAM_WEBHOOK_URL set -> webhook (prod,
 * secret_token auth); unset -> long polling (dev). Same handlers either way.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;

  constructor(private prisma: PrismaService) {}

  isConfigured(): boolean {
    return this.bot !== null;
  }

  getBot(): Bot | null {
    return this.bot;
  }

  async onModuleInit(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.log('TELEGRAM_BOT_TOKEN not set — Telegram integration disabled.');
      return;
    }
    this.bot = new Bot(token);
    this.registerHandlers(this.bot);

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (webhookUrl) {
      await this.bot.init();
      await this.bot.api.setWebhook(webhookUrl, {
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      });
      this.logger.log(`Telegram webhook registered: ${webhookUrl}`);
    } else {
      // Long polling (dev). bot.start() resolves only when the bot stops —
      // fire and forget, surface startup errors in the log.
      void this.bot.start({
        onStart: () => this.logger.log('Telegram long polling started (dev mode).'),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) await this.bot.stop();
  }

  private registerHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      const token = ctx.match.trim();
      const outcome = await this.linkAccount(token, String(ctx.chat.id));
      await ctx.reply(
        outcome === 'linked'
          ? 'Linked ✅ — you will get your Terrain digest here.'
          : 'This link is invalid or expired. Open Terrain → Settings → Connect Telegram to get a fresh one.',
      );
    });
    bot.on('message', async (ctx) => {
      await ctx.reply(
        'I only deliver digests for now. Manage everything in Terrain → Settings.',
      );
    });
  }

  /** Resolve a one-time link token to its user and bind this chat. */
  async linkAccount(token: string, chatId: string): Promise<'linked' | 'invalid'> {
    if (!token) return 'invalid';
    const row = await this.prisma.settings.findUnique({
      where: { telegramLinkToken: token },
    });
    if (!row) return 'invalid';
    if (!row.telegramLinkTokenExpiresAt || row.telegramLinkTokenExpiresAt < new Date()) {
      return 'invalid';
    }
    await this.prisma.settings.update({
      where: { userId: row.userId },
      data: { telegramChatId: chatId, telegramLinkToken: null, telegramLinkTokenExpiresAt: null },
    });
    this.logger.log(`Telegram linked for user ${row.userId}`);
    return 'linked';
  }

  /**
   * Send an HTML message; optional single inline URL button. A 403 means the
   * user blocked the bot — unlink them so the cron stops trying. Never throws:
   * one user's failure must not break a cron sweep.
   */
  async sendTo(
    userId: string,
    chatId: string,
    html: string,
    button?: { text: string; url: string },
  ): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        ...(button
          ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } }
          : {}),
      });
    } catch (e) {
      const err = e as { error_code?: number; description?: string };
      if (err.error_code === 403) {
        this.logger.warn(`User ${userId} blocked the bot — unlinking.`);
        await this.prisma.settings.updateMany({
          where: { userId },
          data: { telegramChatId: null },
        });
      } else {
        this.logger.error(`sendMessage failed for user ${userId}: ${err.description ?? e}`);
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test telegram.service`
Expected: PASS (8 tests).

- [ ] **Step 6: Wire the module**

Create `apps/api/src/telegram/telegram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Module({
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
```

In `apps/api/src/app.module.ts`: add `import { TelegramModule } from './telegram/telegram.module';` and append `TelegramModule` to the `imports` array (after `SettingsModule`).

In `apps/api/src/main.ts`, right after the `app.useGlobalPipes(...)` call, add:

```typescript
  // Required for OnModuleDestroy to fire on SIGTERM/SIGINT — the Telegram
  // long-polling loop must be stopped or a zombie process keeps consuming
  // getUpdates (and holds :3000, per the known nest-start zombie failure mode).
  app.enableShutdownHooks();
```

- [ ] **Step 7: Full verification**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint`
Expected: all pass.

---

### Task 6: Webhook controller + /start handler test

**Files:**
- Create: `apps/api/src/telegram/telegram.controller.ts`
- Modify: `apps/api/src/telegram/telegram.service.ts` (expose `webhookHandler`)
- Modify: `apps/api/src/telegram/telegram.module.ts` (register controller)
- Modify: `apps/api/src/telegram/telegram.service.spec.ts` (handler test)

**Interfaces:**
- Consumes: `TelegramService.getBot()`, `linkAccount` (Task 5), `@Public()` decorator (`../auth/public.decorator`), `@SkipThrottle()` (`@nestjs/throttler`).
- Produces: `POST /telegram/webhook` (public, throttle-exempt, secret-token-authenticated inside grammY's callback); `TelegramService.webhookHandler(req, res): Promise<void>`.

- [ ] **Step 1: Write the failing handler test**

Append to `apps/api/src/telegram/telegram.service.spec.ts`:

```typescript
  describe('/start handler wiring', () => {
    it('replies "Linked" for a valid token via a real grammY Bot (offline)', async () => {
      const { Bot } = await import('grammy');
      const bot = new Bot('dummy-token', {
        botInfo: {
          id: 1,
          is_bot: true,
          first_name: 'T',
          username: 'terrain_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
          can_connect_to_business: false,
          has_main_web_app: false,
        },
      });
      const sent: { method: string; payload: Record<string, unknown> }[] = [];
      // Intercept ALL outbound API calls — nothing touches the network.
      bot.api.config.use((_prev, method, payload) => {
        sent.push({ method, payload: payload as Record<string, unknown> });
        return Promise.resolve({ ok: true as const, result: true as never });
      });
      (service as never as { registerHandlers: (b: unknown) => void }).registerHandlers(bot);

      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: future(),
      });
      prisma.settings.update.mockResolvedValue({});

      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private', first_name: 'D' },
          from: { id: 42, is_bot: false, first_name: 'D' },
          text: '/start tok123',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
      });

      expect(prisma.settings.update).toHaveBeenCalled();
      expect(sent[0].method).toBe('sendMessage');
      expect(String(sent[0].payload.text)).toContain('Linked');
    });
  });
```

- [ ] **Step 2: Run to verify current state**

Run: `yarn workspace @terrain/api test telegram.service`
Expected: this new test PASSES already if `registerHandlers` from Task 5 is correct — that's fine (it locks the wiring); the *controller* below is the new behavior. If it fails, fix `registerHandlers` before proceeding.

- [ ] **Step 3: Add webhookHandler to the service**

In `apps/api/src/telegram/telegram.service.ts`, add to imports:

```typescript
import { webhookCallback } from 'grammy';
import type { Request, Response } from 'express';
```

Add a field and method to `TelegramService`:

```typescript
  private webhookCb: ((req: Request, res: Response) => Promise<void>) | null = null;

  /** Lazy grammY express adapter; 503 when the bot is not configured. */
  async webhookHandler(req: Request, res: Response): Promise<void> {
    if (!this.bot) {
      res.status(503).json({ message: 'Telegram bot is not configured.' });
      return;
    }
    this.webhookCb ??= webhookCallback(this.bot, 'express', {
      secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
    });
    await this.webhookCb(req, res);
  }
```

- [ ] **Step 4: Create the controller**

Create `apps/api/src/telegram/telegram.controller.ts`:

```typescript
import { Controller, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private telegram: TelegramService) {}

  /**
   * Telegram's webhook target. No JWT (Telegram can't log in) and no
   * throttling (bursty by design) — authentication is the
   * X-Telegram-Bot-Api-Secret-Token header, verified inside grammY's
   * webhookCallback (mismatch -> 401 before any handler runs).
   */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  webhook(@Req() req: Request, @Res() res: Response) {
    return this.telegram.webhookHandler(req, res);
  }
}
```

Register it in `apps/api/src/telegram/telegram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
```

- [ ] **Step 5: Verify**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint`
Expected: all pass.

---

### Task 7: Hourly cron — local-hour matching, digest + nudge dispatch

**Files:**
- Create: `apps/api/src/telegram/telegram.time.ts`
- Create: `apps/api/src/telegram/telegram.time.spec.ts`
- Create: `apps/api/src/telegram/telegram.cron.ts`
- Create: `apps/api/src/telegram/telegram.cron.spec.ts`
- Modify: `apps/api/src/telegram/telegram.module.ts`

**Interfaces:**
- Consumes: `TelegramService.sendTo` + `isConfigured` (Task 5); `composeDigest`/`composeNudge`/`estimateMinutes` (Task 4); `MetricsService.dueCards(userId, now)`, `.dueTopics(userId, now)`, `.nextUp(userId)` (existing, exported from `MetricsModule`); `StreakService.getState(userId)` (existing, exported from `StreakModule`).
- Produces:
  - `localHour(now: Date, timeZone: string): number` (0–23)
  - `localDayStart(now: Date, timeZone: string): Date` — UTC instant of the user's local midnight
  - `TelegramCron.tick(now?: Date): Promise<void>` — the `@Cron('0 * * * *')` entrypoint, also callable directly (manual smoke).

- [ ] **Step 1: Write the failing time-helper tests**

Create `apps/api/src/telegram/telegram.time.spec.ts`:

```typescript
import { localDayStart, localHour } from './telegram.time';

describe('localHour', () => {
  const t = new Date('2026-07-02T06:30:00Z');

  it('resolves the hour across timezones', () => {
    expect(localHour(t, 'UTC')).toBe(6);
    expect(localHour(t, 'Europe/Kyiv')).toBe(9); // UTC+3 in July (EEST)
    expect(localHour(t, 'America/Los_Angeles')).toBe(23); // previous day, UTC-7 (PDT)
  });

  it('returns 0 (not 24) at local midnight', () => {
    expect(localHour(new Date('2026-07-02T00:10:00Z'), 'UTC')).toBe(0);
  });

  it('tracks a DST transition (Kyiv is UTC+2 in winter, UTC+3 in summer)', () => {
    expect(localHour(new Date('2026-01-15T07:00:00Z'), 'Europe/Kyiv')).toBe(9);
    expect(localHour(new Date('2026-07-15T07:00:00Z'), 'Europe/Kyiv')).toBe(10);
  });
});

describe('localDayStart', () => {
  it('returns the UTC instant of local midnight', () => {
    const now = new Date('2026-07-02T06:30:00Z');
    expect(localDayStart(now, 'UTC').toISOString()).toBe('2026-07-02T00:00:00.000Z');
    // Kyiv midnight Jul 2 (UTC+3) is 21:00 UTC on Jul 1
    expect(localDayStart(now, 'Europe/Kyiv').toISOString()).toBe('2026-07-01T21:00:00.000Z');
    // In LA it is still Jul 1; LA midnight Jul 1 (UTC-7) is 07:00 UTC Jul 1
    expect(localDayStart(now, 'America/Los_Angeles').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @terrain/api test telegram.time`
Expected: FAIL — `Cannot find module './telegram.time'`.

- [ ] **Step 3: Implement the time helpers**

Create `apps/api/src/telegram/telegram.time.ts`:

```typescript
/**
 * Timezone math via Intl only — no date library. Known DST caveat (accepted
 * in the spec): during the one repeated/skipped local hour a year, a digest
 * can double-fire or skip once; no send-state is tracked to compensate.
 */

export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

/** Offset of `timeZone` from UTC at instant `at`, in ms (UTC+3 -> +3h). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** UTC instant of the current local midnight in `timeZone`. */
export function localDayStart(now: Date, timeZone: string): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // YYYY-MM-DD
  const guess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}
```

- [ ] **Step 4: Run the time tests**

Run: `yarn workspace @terrain/api test telegram.time`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing cron tests**

Create `apps/api/src/telegram/telegram.cron.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { StreakService } from '../streak/streak.service';
import { TelegramCron } from './telegram.cron';
import { TelegramService } from './telegram.service';

// 06:00 UTC = 09:00 in Kyiv (UTC+3, July) — matches digestHour 9 below.
const NOW = new Date('2026-07-02T06:00:00Z');

const settingsRow = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  telegramChatId: '42',
  timezone: 'Europe/Kyiv',
  digestHour: 9,
  nudgeHour: 20,
  ...over,
});

const card = (kind: string, minutes: number | null = null) => ({
  promptKind: kind,
  estimatedMinutes: minutes,
});

describe('TelegramCron', () => {
  let cron: TelegramCron;
  const prisma = {
    settings: { findMany: jest.fn() },
    review: { count: jest.fn() },
  };
  const telegram = { isConfigured: jest.fn().mockReturnValue(true), sendTo: jest.fn() };
  const metrics = { dueCards: jest.fn(), dueTopics: jest.fn(), nextUp: jest.fn() };
  const streak = { getState: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    telegram.isConfigured.mockReturnValue(true);
    process.env.WEB_BASE_URL = 'https://terrain.example';
    metrics.dueCards.mockResolvedValue([card('concept'), card('code'), card('problem', 45)]);
    metrics.dueTopics.mockResolvedValue({ overdue: [{}, {}], dueToday: [{}] });
    metrics.nextUp.mockResolvedValue({ topic: { title: 'Interval DP' } });
    streak.getState.mockResolvedValue({ currentStreak: 12 });
    prisma.review.count.mockResolvedValue(0);
    const mod = await Test.createTestingModule({
      providers: [
        TelegramCron,
        { provide: PrismaService, useValue: prisma },
        { provide: TelegramService, useValue: telegram },
        { provide: MetricsService, useValue: metrics },
        { provide: StreakService, useValue: streak },
      ],
    }).compile();
    cron = mod.get(TelegramCron);
  });

  it('sends the digest when the local hour matches digestHour', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(NOW);
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    const [userId, chatId, html, button] = telegram.sendTo.mock.calls[0];
    expect(userId).toBe('u1');
    expect(chatId).toBe('42');
    expect(html).toContain('Due: 3 cards');
    expect(html).toContain(`~${2 + 10 + 45} min`);
    expect(html).toContain('Streak: 12');
    expect(html).toContain('Next up: Interval DP');
    expect(button).toEqual({ text: 'Start review', url: 'https://terrain.example' });
  });

  it('sends nothing when the hour matches neither setting', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow({ digestHour: 8, nudgeHour: 21 })]);
    await cron.tick(NOW);
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('skips the digest when digestHour is null (off)', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow({ digestHour: null })]);
    await cron.tick(NOW);
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('sends the nudge at nudgeHour when nothing was logged today and cards are due', async () => {
    // 17:00 UTC = 20:00 Kyiv
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    const html = telegram.sendTo.mock.calls[0][2];
    expect(html).toContain('Streak (12) at risk');
    // reviews counted from the user-local day start (21:00 UTC previous day)
    expect(prisma.review.count).toHaveBeenCalledWith({
      where: { userId: 'u1', reviewedAt: { gte: new Date('2026-07-01T21:00:00.000Z') } },
    });
  });

  it('suppresses the nudge when a review was already logged today', async () => {
    prisma.review.count.mockResolvedValue(3);
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('suppresses the nudge when nothing is due', async () => {
    metrics.dueCards.mockResolvedValue([]);
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('one user failing does not block the others', async () => {
    prisma.settings.findMany.mockResolvedValue([
      settingsRow({ userId: 'bad' }),
      settingsRow({ userId: 'good', telegramChatId: '43' }),
    ]);
    metrics.dueCards.mockImplementation((userId: string) =>
      userId === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve([card('concept')]),
    );
    await cron.tick(NOW);
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    expect(telegram.sendTo.mock.calls[0][0]).toBe('good');
  });

  it('does nothing when the bot is not configured', async () => {
    telegram.isConfigured.mockReturnValue(false);
    await cron.tick(NOW);
    expect(prisma.settings.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `yarn workspace @terrain/api test telegram.cron`
Expected: FAIL — `Cannot find module './telegram.cron'`.

- [ ] **Step 7: Implement the cron**

Create `apps/api/src/telegram/telegram.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Settings } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from '../streak/streak.service';
import { composeDigest, composeNudge, estimateMinutes } from './telegram.messages';
import { TelegramService } from './telegram.service';
import { localDayStart, localHour } from './telegram.time';

@Injectable()
export class TelegramCron {
  private readonly logger = new Logger(TelegramCron.name);

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private metrics: MetricsService,
    private streak: StreakService,
  ) {}

  @Cron('0 * * * *') // every hour on the hour
  async hourly(): Promise<void> {
    await this.tick(new Date());
  }

  /** Exposed with an injectable `now` for tests and manual smoke runs. */
  async tick(now: Date): Promise<void> {
    if (!this.telegram.isConfigured()) return;
    const rows = await this.prisma.settings.findMany({
      where: { telegramChatId: { not: null } },
    });
    for (const s of rows) {
      try {
        const hour = localHour(now, s.timezone);
        if (s.digestHour !== null && hour === s.digestHour) await this.sendDigest(s, now);
        if (s.nudgeHour !== null && hour === s.nudgeHour) await this.maybeSendNudge(s, now);
      } catch (e) {
        this.logger.error(`Telegram tick failed for user ${s.userId}: ${e}`);
      }
    }
  }

  private webUrl(): string {
    return process.env.WEB_BASE_URL ?? 'http://localhost:5180';
  }

  private async sendDigest(s: Settings, now: Date): Promise<void> {
    const [cards, due, streakState, nextUp] = await Promise.all([
      this.metrics.dueCards(s.userId, now),
      this.metrics.dueTopics(s.userId, now),
      this.streak.getState(s.userId),
      this.metrics.nextUp(s.userId),
    ]);
    const byKind = (k: string) => cards.filter((c) => c.promptKind === k).length;
    const html = composeDigest({
      date: now,
      timezone: s.timezone,
      dueByKind: { concept: byKind('concept'), code: byKind('code'), problem: byKind('problem') },
      dueCount: cards.length,
      estMinutes: estimateMinutes(cards),
      overdueTopics: due.overdue.length,
      streak: streakState.currentStreak,
      nextUpTitle: nextUp?.topic.title ?? null,
    });
    await this.telegram.sendTo(s.userId, s.telegramChatId!, html, {
      text: 'Start review',
      url: this.webUrl(),
    });
  }

  /** Streak-at-risk nudge: only when today (user-local) has zero reviews AND cards are due. */
  private async maybeSendNudge(s: Settings, now: Date): Promise<void> {
    const dayStart = localDayStart(now, s.timezone);
    const reviewsToday = await this.prisma.review.count({
      where: { userId: s.userId, reviewedAt: { gte: dayStart } },
    });
    if (reviewsToday > 0) return;
    const cards = await this.metrics.dueCards(s.userId, now);
    if (cards.length === 0) return;
    const streakState = await this.streak.getState(s.userId);
    const html = composeNudge({
      streak: streakState.currentStreak,
      dueCount: cards.length,
      estMinutes: estimateMinutes(cards),
    });
    await this.telegram.sendTo(s.userId, s.telegramChatId!, html, {
      text: 'Review now',
      url: this.webUrl(),
    });
  }
}
```

- [ ] **Step 8: Run the cron tests**

Run: `yarn workspace @terrain/api test telegram.cron`
Expected: PASS (8 tests).

Note the `one user failing` test drives `metrics.dueCards` per-user — the digest path calls it inside `Promise.all`, so the rejection propagates to the per-user try/catch, and the second user still receives their message. If it fails, check the try/catch wraps the whole per-user block.

- [ ] **Step 9: Register the cron in the module**

Update `apps/api/src/telegram/telegram.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { StreakModule } from '../streak/streak.module';
import { TelegramController } from './telegram.controller';
import { TelegramCron } from './telegram.cron';
import { TelegramService } from './telegram.service';

@Module({
  imports: [MetricsModule, StreakModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramCron],
  exports: [TelegramService],
})
export class TelegramModule {}
```

(Both `MetricsModule` and `StreakModule` already export their services.)

- [ ] **Step 10: Full verification**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint`
Expected: all pass.

---

### Task 8: Web — types, client, hooks, Notifications card

**Files:**
- Modify: `apps/web/src/api/types.ts` (Settings interface, ~line 95)
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/hooks.ts`
- Modify: `apps/web/src/screens/Settings/index.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /settings` → `SettingsView` (Task 2), `POST /settings/telegram/link-token` → `{ url }` (Task 3), `POST /settings/telegram/unlink` → `SettingsView` (Task 3).
- Produces: `useUpdateSettings()`, `useTelegramLinkToken()`, `useTelegramUnlink()` hooks; Notifications card UI.

- [ ] **Step 1: Update the Settings type**

In `apps/web/src/api/types.ts`, replace the `Settings` interface with:

```typescript
export interface Settings {
  userId: string;
  obsidianVault: string | null;
  timezone: string;
  digestHour: number | null;
  nudgeHour: number | null;
  telegramLinked: boolean;
}

export interface UpdateSettingsInput {
  obsidianVault?: string | null;
  timezone?: string;
  digestHour?: number | null;
  nudgeHour?: number | null;
}
```

Check for other `telegramChatId` references: `grep -rn telegramChatId apps/web/src` — update/remove any hit (the deep review noted the type had drifted already).

- [ ] **Step 2: Add client calls**

In `apps/web/src/api/client.ts`: add `UpdateSettingsInput` to the type import from `./types`, and add next to `getSettings`:

```typescript
  updateSettings: (input: UpdateSettingsInput) =>
    req<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(input) }),
  createTelegramLink: () =>
    req<{ url: string }>('/settings/telegram/link-token', { method: 'POST' }),
  unlinkTelegram: () => req<Settings>('/settings/telegram/unlink', { method: 'POST' }),
```

- [ ] **Step 3: Add hooks**

In `apps/web/src/api/hooks.ts`, after `useSettings()` (imports: add `UpdateSettingsInput` to the types import):

```typescript
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.updateSettings(input),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}

export function useTelegramLinkToken() {
  return useMutation({ mutationFn: () => api.createTelegramLink() });
}

export function useTelegramUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.unlinkTelegram(),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}
```

- [ ] **Step 4: Add the Notifications card**

In `apps/web/src/screens/Settings/index.tsx`, add a second `Card` below the Profile card. Imports to add at the top:

```typescript
import {
  useSettings,
  useUpdateSettings,
  useTelegramLinkToken,
  useTelegramUnlink,
} from '../../api/hooks';
```

Inside the component, add hooks + local state (mirror the existing profile-form pattern):

```typescript
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const linkToken = useTelegramLinkToken();
  const unlink = useTelegramUnlink();
  const [notif, setNotif] = useState({ timezone: 'UTC', digestHour: '9', nudgeHour: '20', obsidianVault: '' });

  useEffect(() => {
    if (settings.data)
      setNotif({
        timezone: settings.data.timezone,
        digestHour: settings.data.digestHour === null ? 'off' : String(settings.data.digestHour),
        nudgeHour: settings.data.nudgeHour === null ? 'off' : String(settings.data.nudgeHour),
        obsidianVault: settings.data.obsidianVault ?? '',
      });
  }, [settings.data]);
```

And the card JSX (after the Profile card, before the logout section):

```tsx
      <Card title="Notifications — Telegram digest & streak nudge">
        <div className="col gap-3">
          {settings.data?.telegramLinked ? (
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <span>Telegram: Linked ✓</span>
              <button
                className="btn"
                disabled={unlink.isPending}
                onClick={() =>
                  unlink.mutate(undefined, {
                    onSuccess: () => toast('Telegram unlinked', 'success'),
                    onError: (e) =>
                      toast(e instanceof Error ? e.message : 'Unlink failed', 'error'),
                  })
                }
              >
                Unlink
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              disabled={linkToken.isPending}
              onClick={() =>
                linkToken.mutate(undefined, {
                  onSuccess: ({ url }) => window.open(url, '_blank'),
                  onError: (e) =>
                    toast(e instanceof Error ? e.message : 'Bot not configured', 'error'),
                })
              }
            >
              Connect Telegram
            </button>
          )}
          <label className="col gap-1">
            <span className="field-label">Timezone (IANA, e.g. Europe/Kyiv)</span>
            <input
              className="input"
              value={notif.timezone}
              onChange={(e) => setNotif({ ...notif, timezone: e.target.value })}
            />
          </label>
          <label className="col gap-1">
            <span className="field-label">Morning digest hour</span>
            <select
              className="input"
              value={notif.digestHour}
              onChange={(e) => setNotif({ ...notif, digestHour: e.target.value })}
            >
              <option value="off">Off</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
          <label className="col gap-1">
            <span className="field-label">Evening streak-nudge hour</span>
            <select
              className="input"
              value={notif.nudgeHour}
              onChange={(e) => setNotif({ ...notif, nudgeHour: e.target.value })}
            >
              <option value="off">Off</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
          <label className="col gap-1">
            <span className="field-label">Obsidian vault (enables obsidian:// links)</span>
            <input
              className="input"
              value={notif.obsidianVault}
              onChange={(e) => setNotif({ ...notif, obsidianVault: e.target.value })}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={updateSettings.isPending}
            onClick={() =>
              updateSettings.mutate(
                {
                  timezone: notif.timezone,
                  digestHour: notif.digestHour === 'off' ? null : Number(notif.digestHour),
                  nudgeHour: notif.nudgeHour === 'off' ? null : Number(notif.nudgeHour),
                  obsidianVault: notif.obsidianVault === '' ? null : notif.obsidianVault,
                },
                {
                  onSuccess: () => toast('Notification settings saved', 'success'),
                  onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
                },
              )
            }
          >
            Save notifications
          </button>
        </div>
      </Card>
```

(After the user links in Telegram, react-query's default `refetchOnWindowFocus` refetches `useSettings` when they return to the tab, flipping the card to "Linked ✓" — no polling needed.)

- [ ] **Step 5: Verify with the real bundler**

Run: `yarn workspace @terrain/web build`
Expected: `tsc --noEmit` clean + Rolldown build succeeds (a passing `vite build` is the real check per CLAUDE.md).
Then: `yarn lint && yarn format:check`
Expected: clean (run `yarn format` if formatting differs).

---

### Task 9: Env examples, docs, final verification

**Files:**
- Modify: `apps/api/.env.example`
- Modify: `docs/ops/deploy.md`
- Modify: `docs/ops/local-dev.md`
- Modify: `CLAUDE.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: everything above; documents the env contract (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`, `WEB_BASE_URL`).

- [ ] **Step 1: Document the env vars**

Append to `apps/api/.env.example`:

```bash
# --- Telegram digest (all optional; unset = integration disabled) ---
# From @BotFather:
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
# Prod only — public HTTPS endpoint (https://<DOMAIN>/api/telegram/webhook).
# Unset in dev: the bot falls back to long polling automatically.
TELEGRAM_WEBHOOK_URL=
# Random string; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token.
# Generate: openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET=
# Base URL used in digest deep links back into the app.
WEB_BASE_URL=http://localhost:5180
```

- [ ] **Step 2: Update ops docs**

In `docs/ops/deploy.md`, add a short "Telegram digest" section: the four `TELEGRAM_*` vars + `WEB_BASE_URL` go into the API service env; the webhook URL is `https://<DOMAIN>/api/telegram/webhook` (Caddy's `handle_path /api/*` already strips the prefix and forwards to `api:3000`, so no Caddyfile change is needed); the webhook registers itself on API boot.

In `docs/ops/local-dev.md`, add a note: to smoke the bot locally, set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` in `apps/api/.env` and leave `TELEGRAM_WEBHOOK_URL` unset — the bot long-polls; link via Settings → Connect Telegram; trigger a send without waiting for the hour by temporarily calling `tick(new Date('...T<digestHour in your tz>:00:00Z'))` from a scratch script, or set `digestHour` to the next hour.

- [ ] **Step 3: Update status docs**

- `CLAUDE.md` "Status & roadmap": move the Telegram bot out of **Deferred**; add the digest to the built list (e.g. "Telegram digest + streak nudge (Stage 2 reminders, cut-scope per 2026-07-02 deep review)"). Keep MFA/password reset, JWT revocation deferred.
- `.superpowers/sdd/progress.md`: append a dated entry summarizing what was built (spec link, module layout, env contract, decisions: grammY, webhook-prod/polling-dev, digest+nudge scope).

- [ ] **Step 4: Full-tree verification**

Run:
```bash
yarn build && yarn test && yarn lint && yarn format:check
```
Expected: every workspace builds, all tests pass (API suite grew by ~30), lint and format clean.

- [ ] **Step 5: Manual smoke (requires a real bot token from @BotFather)**

1. `docker compose up -d && yarn workspace @terrain/api start` (with `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` in `apps/api/.env`) and `yarn workspace @terrain/web dev`.
2. Log in at `http://localhost:5180` → Settings → Connect Telegram → the `t.me` link opens → press **Start** in Telegram → bot replies "Linked ✅".
3. Return to the app tab — the card shows "Linked ✓".
4. Set digest hour to the next full hour (in your timezone) and wait for the cron, or force one tick from a scratch script.
5. Confirm the digest arrives with correct counts and the button opens the app.
6. Stop the API with `kill -9 $(lsof -ti:3000)` if `Ctrl-C` leaves a zombie (known nest-start behavior).

---

## Self-Review Notes

- **Spec coverage:** schema (T1), PATCH + GET view (T2), link-token/unlink + 503 (T3), composers incl. all-clear + fallbacks (T4), bot lifecycle/inert mode/linkAccount/403-unlink/sendTo (T5), webhook + secret token + @Public/@SkipThrottle + /start handler (T6), hourly cron/local-hour/DST/nudge suppression/per-user isolation (T7), web card + obsidianVault (T8), env + docs + smoke (T9). Spec's "reused token" case = token cleared on use → covered by the unknown-token path (T5 test 2).
- **Type consistency:** `SettingsView` (T2/T3/T8 mirror), `sendTo(userId, chatId, html, button?)` (T5 def, T7 calls), `DigestData`/`NudgeData` (T4 def, T7 calls), `tick(now)` (T7 def, T9 smoke).
- **No placeholders:** every code step carries the full code; every run step has a command + expected result.
