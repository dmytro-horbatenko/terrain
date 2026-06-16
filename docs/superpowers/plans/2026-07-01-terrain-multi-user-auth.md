# Terrain Multi-User Auth & Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Terrain from single-user/no-auth to a multi-tenant, authenticated app where each user's learning data is fully isolated.

**Architecture:** Add a `User` model and `userId` ownership to every table (native schema, one fresh init migration — no backfill). Email+password auth (argon2) issues a JWT carried in an httpOnly cookie; a global `JwtAuthGuard` attaches `req.userId`, which every service method takes as a parameter and scopes its Prisma queries by. The web gains a login/register gate and sends the cookie with `credentials: 'include'`.

**Tech Stack:** NestJS 11, Prisma 7 (+ `@prisma/adapter-pg`), `@nestjs/jwt`, `argon2`, `cookie-parser`, React 19 + TanStack Router + react-query, Vitest/Jest.

Spec: `docs/superpowers/specs/2026-07-01-terrain-multi-user-auth-design.md`

## Global Constraints

- **NO GIT COMMITS.** Per the standing user preference + CLAUDE.md, work stays uncommitted in the working tree. Each task's final step is a **checkpoint** (run tests + build), NOT a commit. Reviewers diff via git tree snapshots (`git add -A && git write-tree && git reset -q`), never commits.
- **Monorepo is CommonJS** for `apps/api` + `packages/*` (extensionless imports, no `"type":"module"`). `apps/web` is ESM.
- **Postgres on host port 5433** (Docker/OrbStack). Connection string in `apps/api/.env`.
- **Prisma 7 driver adapter:** `PrismaService` and `prisma/seed.ts` build `new PrismaClient({ adapter })` over `DATABASE_URL`; `import 'dotenv/config'` stays the first import in `main.ts` and `seed.ts`. DB URL lives in `prisma.config.ts` for the CLI, not `schema.prisma`.
- **`prisma migrate reset` and `docker compose down -v` are DENY-LISTED** (`.claude/settings.json`) — they wipe the postgres volume. Never call them. Reset the dev DB through an allowed path (Task A1).
- **oxfmt** (single quotes + trailing commas) + **oxlint**; run `yarn format` then `yarn format:check` + `yarn lint` clean before each checkpoint.
- **TypeScript 6**; `apps/api` needs explicit `types: ["node","jest"]`.
- **Identity fields** (verbatim, replace the hardcoded block): `name`, `role`, `learningStyle`, `codeStyle`, `noteSystem`.
- **Cookie name:** `token`. **Env var:** `JWT_SECRET`. **JWT payload:** `{ sub: userId, email }`. **Expiry:** 30 days. **Cookie flags:** `httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production', maxAge: 30d`.
- **Demo user:** email `demo@terrain.local`, password `demo-password` (dev only).

---

## File Structure

**Wave A — schema & auth core**
- `apps/api/prisma/schema.prisma` — rewrite: `User` model + `userId` on owned tables + per-user PKs.
- `apps/api/prisma/migrations/` — replace all migrations with one fresh `init`.
- `apps/api/prisma/seed.ts` — rewrite: demo user + DSA data under it.
- `apps/api/src/auth/auth.service.ts` — register/login/validate/updateProfile (argon2 + JWT).
- `apps/api/src/auth/auth.controller.ts` — `/auth/register|login|logout|me` (+ `PATCH /auth/me`).
- `apps/api/src/auth/jwt-auth.guard.ts` — global guard reading the cookie.
- `apps/api/src/auth/public.decorator.ts` — `@Public()`.
- `apps/api/src/auth/current-user.decorator.ts` — `@CurrentUser()`.
- `apps/api/src/auth/dto.ts` — `RegisterDto`, `LoginDto`, `UpdateProfileDto`.
- `apps/api/src/auth/auth.module.ts` — wires `JwtModule`, guard as `APP_GUARD`.
- `apps/api/src/main.ts` — add `cookie-parser`.
- `apps/api/src/app.module.ts` — register `AuthModule`.

**Wave B — scope every service** (modify + test each): `topics`, `reviews` (+ `sr-apply.ts`), `metrics`, `streak` (+ `streak.cron.ts`), `sessions` (+ `export-generator.service.ts`), `import`, `settings`, `topic-types`.

**Wave C — web**
- `apps/web/src/api/client.ts` — `credentials: 'include'` + auth endpoints.
- `apps/web/src/api/types.ts` — `User`, `AuthedUser` types.
- `apps/web/src/api/hooks.ts` — `useMe/useLogin/useRegister/useLogout/useUpdateProfile`.
- `apps/web/src/app/AuthGate.tsx` — gate wrapper.
- `apps/web/src/screens/Auth/index.tsx` — login/register screen.
- `apps/web/src/screens/Settings/index.tsx` — profile editor (new screen + route).
- `apps/web/src/app/router.tsx` + `apps/web/src/app/Layout.tsx` — add Settings route + nav; mount gate.

---

# WAVE A — Schema & Auth Core

### Task A1: Rewrite schema to multi-user + fresh init migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Replace: `apps/api/prisma/migrations/*`
- Test: none (verified by `migrate status` + `prisma generate` + build)

**Interfaces:**
- Produces: Prisma models `User`, and `userId`-scoped `Topic`/`Review`/`ApplicationEvent`/`SessionExport`/`StreakState`/`Settings`/`DailyLog`/`TopicType`. Every later task relies on these fields existing on `@prisma/client`.

- [ ] **Step 1: Add the `User` model** to `schema.prisma`:

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  name          String
  role          String?
  learningStyle String?
  codeStyle     String?
  noteSystem    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  topics        Topic[]
  reviews       Review[]
  appEvents     ApplicationEvent[]
  sessionExports SessionExport[]
  streakState   StreakState?
  settings      Settings?
  dailyLogs     DailyLog[]
  topicTypes    TopicType[]
}
```

- [ ] **Step 2: Add `userId` to owned models.** In `Topic`, `Review`, `ApplicationEvent`, `SessionExport` add, next to the existing relations:

```prisma
  userId String
  user   User   @relation(fields: [userId], references: [id])
  @@index([userId])
```

(For `Review`/`ApplicationEvent` this is the denormalized owner used by metrics; it always equals the topic's owner.)

- [ ] **Step 3: Rework the per-user singleton/keyed models.** Replace the four models wholesale:

```prisma
model StreakState {
  userId            String    @id
  user              User      @relation(fields: [userId], references: [id])
  currentStreak     Int       @default(0)
  longestStreak     Int       @default(0)
  freezeBalance     Int       @default(0)
  activeDayCounter  Int       @default(0)
  lastEvaluatedDate DateTime? @db.Date
}

model Settings {
  userId         String  @id
  user           User    @relation(fields: [userId], references: [id])
  obsidianVault  String?
  telegramChatId String?
}

model DailyLog {
  userId         String          @relation_placeholder // see note
  user           User            @relation(fields: [userId], references: [id])
  date           DateTime        @db.Date
  dayType        DayType
  eveningNote    String?
  sessionQuality SessionQuality?
  @@id([userId, date])
}

model TopicType {
  userId String
  user   User    @relation(fields: [userId], references: [id])
  key    String
  label  String
  color  String?
  @@id([userId, key])
}
```

> **Note:** delete the `@relation_placeholder` pseudo-line — it's only here to flag that `DailyLog.userId` is a plain `String` field (`userId String`) with the composite `@@id([userId, date])` as the PK (drop the old `date ... @id`). Final `DailyLog` first line is `userId String`.

- [ ] **Step 4: Delete old migrations.** Remove every folder under `apps/api/prisma/migrations/` (keep `migration_lock.toml`).

Run: `rm -rf apps/api/prisma/migrations/2026*`
Expected: only `migration_lock.toml` remains.

- [ ] **Step 5: Reset the dev DB (allowed path).** `migrate reset` is denied. Drop+recreate the database (not the Docker volume) via psql in the running container:

Run:
```bash
docker exec -i consistency-db-1 psql -U terrain -d postgres -c "DROP DATABASE IF EXISTS terrain WITH (FORCE); CREATE DATABASE terrain;"
```
Expected: `DROP DATABASE` / `CREATE DATABASE`. (If the container/db names differ, read them from `docker-compose.yml` + `apps/api/.env` `DATABASE_URL`.)

- [ ] **Step 6: Generate the fresh init migration + client.**

Run:
```bash
yarn workspace @terrain/api exec prisma migrate dev --name init
yarn workspace @terrain/api exec prisma generate
```
Expected: one new `*_init` migration created and applied; client regenerated with `User` + `userId` types.

- [ ] **Step 7: Add `JWT_SECRET` to dev env.** Append to `apps/api/.env`:

```
JWT_SECRET=dev-only-change-in-prod
```

- [ ] **Step 8: Checkpoint.**

Run: `yarn workspace @terrain/api exec prisma migrate status && yarn workspace @terrain/api build`
Expected: "Database schema is up to date"; build exits 0. (API unit tests will fail here — their Prisma mocks lack `userId`; Wave B fixes them. That is expected at this checkpoint; do not "fix" tests yet.)

---

### Task A2: Rewrite the seed (demo user + DSA under it)

**Files:**
- Modify: `apps/api/prisma/seed.ts`
- Test: none (verified by running the seed)

**Interfaces:**
- Consumes: `User` model + `userId` fields from Task A1.
- Produces: a demo user (`demo@terrain.local`) owning the seeded topics/types/streak/settings.

- [ ] **Step 1: Read the current seed** (`apps/api/prisma/seed.ts`) to reuse its DSA topic list and type list verbatim.

- [ ] **Step 2: Hash the demo password + upsert the demo user first.** At the top of the seed's main function, before any topic writes:

```ts
import argon2 from 'argon2';
// ...
const passwordHash = await argon2.hash('demo-password');
const demo = await prisma.user.upsert({
  where: { email: 'demo@terrain.local' },
  update: {},
  create: {
    email: 'demo@terrain.local',
    passwordHash,
    name: 'Dima',
    role: 'Mid-senior full-stack dev, TypeScript + Solidity + DeFi',
    learningStyle: 'Socratic, depth-first, tabulation over memoization',
    codeStyle: 'readable > optimized, TypeScript',
    noteSystem: 'OneNote (iPad drawings) + Obsidian (markdown)',
  },
});
```

- [ ] **Step 3: Thread `userId: demo.id`** into every `create`/`upsert` in the seed: each topic, each `topicType` (its `where` becomes `{ userId_key: { userId: demo.id, key } }`), the `streakState` (`where: { userId: demo.id }`), and `settings` (`where: { userId: demo.id }`).

- [ ] **Step 4: Run the seed.**

Run: `yarn workspace @terrain/api exec tsx prisma/seed.ts`
Expected: no errors; idempotent on a second run.

- [ ] **Step 5: Verify ownership.**

Run:
```bash
docker exec -i consistency-db-1 psql -U terrain -d terrain -c "SELECT count(*) FROM \"Topic\" t JOIN \"User\" u ON t.\"userId\"=u.id WHERE u.email='demo@terrain.local';"
```
Expected: the DSA topic count (16) — all owned by demo.

- [ ] **Step 6: Checkpoint.** Re-run the seed (idempotency). Expected: clean second run.

---

### Task A3: Auth service (argon2 + JWT)

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/dto.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `JwtService` (from `@nestjs/jwt`).
- Produces:
  - `AuthService.register(dto: RegisterDto): Promise<{ user: SafeUser; token: string }>`
  - `AuthService.login(dto: LoginDto): Promise<{ user: SafeUser; token: string }>`
  - `AuthService.me(userId: string): Promise<SafeUser>`
  - `AuthService.updateProfile(userId: string, dto: UpdateProfileDto): Promise<SafeUser>`
  - `type SafeUser = Omit<User, 'passwordHash'>`
  - DTOs: `RegisterDto { email; password; name }`, `LoginDto { email; password }`, `UpdateProfileDto { name?; role?; learningStyle?; codeStyle?; noteSystem?; obsidianVault? }`

- [ ] **Step 1: Add dependencies.**

Run: `yarn workspace @terrain/api add argon2 @nestjs/jwt cookie-parser && yarn workspace @terrain/api add -D @types/cookie-parser`
Expected: added to `apps/api/package.json`.

- [ ] **Step 2: Write the DTOs** (`apps/api/src/auth/dto.ts`) as class-validator classes (mirror the repo's existing DTO style):

```ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(1) name!: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
export class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() learningStyle?: string;
  @IsOptional() @IsString() codeStyle?: string;
  @IsOptional() @IsString() noteSystem?: string;
  @IsOptional() @IsString() obsidianVault?: string;
}
```

- [ ] **Step 3: Write the failing test** (`auth.service.spec.ts`). Mock Prisma + JwtService:

```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const jwt = { signAsync: jest.fn().mockResolvedValue('tok') } as any;
function makePrisma(user: any = null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'u1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'u1', ...data })),
    },
    streakState: { create: jest.fn() },
    settings: { create: jest.fn() },
  } as any;
}

it('register hashes the password, creates streak+settings, returns a token', async () => {
  const prisma = makePrisma(null);
  const svc = new AuthService(prisma, jwt);
  const res = await svc.register({ email: 'a@b.co', password: 'password1', name: 'A' });
  expect(res.token).toBe('tok');
  expect((res.user as any).passwordHash).toBeUndefined();
  expect(prisma.user.create).toHaveBeenCalled();
  expect(prisma.streakState.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
  expect(prisma.settings.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
});

it('register rejects a duplicate email with 409', async () => {
  const prisma = makePrisma({ id: 'x', email: 'a@b.co' });
  const svc = new AuthService(prisma, jwt);
  await expect(svc.register({ email: 'a@b.co', password: 'password1', name: 'A' }))
    .rejects.toBeInstanceOf(ConflictException);
});

it('login rejects a wrong password with 401', async () => {
  const prisma = makePrisma({ id: 'u1', email: 'a@b.co', passwordHash: 'not-a-real-hash' });
  const svc = new AuthService(prisma, jwt);
  await expect(svc.login({ email: 'a@b.co', password: 'wrong' }))
    .rejects.toBeInstanceOf(UnauthorizedException);
});
```

- [ ] **Step 4: Run it — verify it fails.**

Run: `yarn workspace @terrain/api test auth.service`
Expected: FAIL ("Cannot find module './auth.service'").

- [ ] **Step 5: Implement `AuthService`** (`apps/api/src/auth/auth.service.ts`):

```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto';

export type SafeUser = Omit<User, 'passwordHash'>;
const strip = (u: User): SafeUser => {
  const { passwordHash: _drop, ...rest } = u;
  return rest;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async sign(user: User): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email });
  }

  async register(dto: RegisterDto): Promise<{ user: SafeUser; token: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered.');
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });
    await this.prisma.streakState.create({ data: { userId: user.id } });
    await this.prisma.settings.create({ data: { userId: user.id } });
    return { user: strip(user), token: await this.sign(user) };
  }

  async login(dto: LoginDto): Promise<{ user: SafeUser; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return { user: strip(user), token: await this.sign(user) };
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return strip(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SafeUser> {
    const { obsidianVault, ...profile } = dto;
    const user = await this.prisma.user.update({ where: { id: userId }, data: profile });
    if (obsidianVault !== undefined) {
      await this.prisma.settings.update({ where: { userId }, data: { obsidianVault } });
    }
    return strip(user);
  }
}
```

- [ ] **Step 6: Run tests — verify pass.**

Run: `yarn workspace @terrain/api test auth.service`
Expected: 3 passing. (argon2 runs for real in the register/login-happy tests; the 401 test uses a bogus hash so `argon2.verify` returns false.)

- [ ] **Step 7: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task A4: Guard, decorators, controller, module wiring

**Files:**
- Create: `apps/api/src/auth/jwt-auth.guard.ts`, `public.decorator.ts`, `current-user.decorator.ts`, `auth.controller.ts`, `auth.module.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/auth/jwt-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthService` (A3), `JwtService`.
- Produces:
  - `@Public()` — `SetMetadata('isPublic', true)`; guard skips it.
  - `@CurrentUser()` — param decorator returning `req.userId: string`.
  - `JwtAuthGuard` (registered as `APP_GUARD`) — reads `req.cookies.token`, verifies, sets `req.userId`; throws 401 otherwise; bypasses `@Public()` routes.
  - Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me`.

- [ ] **Step 1: `public.decorator.ts`:**

```ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

- [ ] **Step 2: `current-user.decorator.ts`:**

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().userId,
);
```

- [ ] **Step 3: Write the failing guard test** (`jwt-auth.guard.spec.ts`):

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
const jwt = { verifyAsync: jest.fn() } as any;
function ctx(cookies: any) {
  const req: any = { cookies };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
    _req: req,
  } as any;
}

it('sets req.userId from a valid cookie token', async () => {
  jwt.verifyAsync.mockResolvedValue({ sub: 'u1', email: 'a@b.co' });
  const guard = new JwtAuthGuard(reflector, jwt);
  const c = ctx({ token: 'good' });
  await expect(guard.canActivate(c)).resolves.toBe(true);
  expect(c._req.userId).toBe('u1');
});

it('throws 401 when the cookie is missing', async () => {
  const guard = new JwtAuthGuard(reflector, jwt);
  await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
});

it('allows @Public() routes without a token', async () => {
  reflector.getAllAndOverride.mockReturnValueOnce(true);
  const guard = new JwtAuthGuard(reflector, jwt);
  await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
});
```

- [ ] **Step 4: Run it — verify it fails.** Run: `yarn workspace @terrain/api test jwt-auth.guard` → FAIL (module missing).

- [ ] **Step 5: Implement `jwt-auth.guard.ts`:**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.token;
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
```

- [ ] **Step 6: Run guard tests — verify pass.** Run: `yarn workspace @terrain/api test jwt-auth.guard` → 3 passing.

- [ ] **Step 7: Implement `auth.controller.ts`** (cookie set/clear via passthrough Response):

```ts
import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
function setCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS,
  });
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.register(dto);
    setCookie(res, token);
    return user;
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.login(dto);
    setCookie(res, token);
    return user;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token');
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @Patch('me')
  updateProfile(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(userId, dto);
  }
}
```

- [ ] **Step 8: Implement `auth.module.ts`** (JWT config + global guard):

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
```

- [ ] **Step 9: Add cookie-parser** in `main.ts` (after `const app = ...`, before `listen`):

```ts
import cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
```

- [ ] **Step 10: Register `AuthModule`** in `app.module.ts` imports (add `AuthModule` to the array + import line). Since the guard is global, EVERY existing route now requires auth (Wave B scopes them by the now-available `req.userId`).

- [ ] **Step 11: Checkpoint + live smoke.** Boot the API, then:

```bash
yarn workspace @terrain/api build   # exit 0
# in one shell: yarn workspace @terrain/api start
curl -i -s -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@terrain.local","password":"demo-password"}' | grep -i 'set-cookie\|200\|401'
curl -i -s localhost:3000/topics | grep -i '401'   # protected now → 401 without cookie
```
Expected: login returns 200 + `Set-Cookie: token=...`; `/topics` without a cookie returns 401. Stop the dev server with `kill -9 $(lsof -ti:3000)`.

---

# WAVE B — Scope Every Service by `userId`

**The scoping pattern (applies to every task in this wave):**
1. Each service method gains a **leading `userId: string` parameter**.
2. Every Prisma read/write adds `userId` to its `where` (reads) or `data` (creates). `findUnique({ where: { id } })` on an owned row becomes `findFirst({ where: { id, userId } })` so a cross-user id 404s instead of leaking.
3. Each controller method adds `@CurrentUser() userId: string` and passes it first.
4. Each spec's Prisma mock adds `userId` to expected `where`/`data`; add one **cross-user isolation test** per task asserting user B's row is invisible to user A.

---

### Task B1: Scope TopicsService (pattern-setter) + isolation tests

**Files:**
- Modify: `apps/api/src/topics/topics.service.ts`, `apps/api/src/topics/topics.controller.ts`
- Test: `apps/api/src/topics/topics.service.spec.ts`

**Interfaces:**
- Produces (new signatures, `userId` first): `registerType(userId, topicType)`, `create(userId, dto)`, `findAll(userId)`, `getDetail(userId, id)`, `findOne(userId, id)`, `addAppEvent(userId, topicId, dto)`, `update(userId, id, dto)`, `addPrerequisite(userId, topicId, prerequisiteId)`, `removePrerequisite(userId, topicId, prerequisiteId)`, `remove(userId, id)`, and private `assertNoParentCycle(userId, id, parentId)`, `assertNoPrereqCycle(userId, topicId, prerequisiteId)`.

- [ ] **Step 1: Write the failing isolation test** (append to `topics.service.spec.ts`). The existing suite already mocks `prisma.topic`; add:

```ts
it('getDetail scopes by userId so another user\'s topic 404s', async () => {
  const prisma: any = { topic: { findUnique: jest.fn().mockResolvedValue(null) } };
  const svc = new TopicsService(prisma, metricsMock);
  await expect(svc.getDetail('userA', 'topic-owned-by-B')).rejects.toThrow(/not found/i);
});

it('create stamps the userId onto the new topic', async () => {
  const created = jest.fn().mockResolvedValue({ id: 't1' });
  const prisma: any = { topic: { create: created }, topicType: { upsert: jest.fn() } };
  const svc = new TopicsService(prisma, metricsMock);
  await svc.create('userA', { title: 'X', domain: 'D', topicType: 'pattern' } as any);
  expect(created).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'userA' }) });
});
```

> If `metricsMock` isn't already a helper in the file, define `const metricsMock: any = { topicLabels: () => ({ blocked: false, reviewing: false }), masteryStatus: () => ({}) }`.

- [ ] **Step 2: Run it — verify it fails.** Run: `yarn workspace @terrain/api test topics.service` → FAIL (arity/`userId` missing).

- [ ] **Step 3: Add `userId` to every method + query.** Apply the pattern. Key transforms:
  - `registerType(userId, topicType)` → `upsert({ where: { userId_key: { userId, key } }, update: {}, create: { userId, key, label } })`.
  - `create(userId, dto)` → `topic.create({ data: { ...dto, userId } })`.
  - `findAll(userId)` → `topic.findMany({ where: { userId }, ... })`.
  - `getDetail(userId, id)` / `findOne(userId, id)` → `topic.findFirst({ where: { id, userId }, ... })` (was `findUnique`).
  - `addAppEvent(userId, topicId, dto)` → `applicationEvent.create({ data: { ...eventData, userId } })` (denormalized owner) after `findOne(userId, topicId)`.
  - `update(userId, id, dto)` → guard via `findOne(userId, id)`; `assertNoParentCycle(userId, ...)`; `registerType(userId, ...)`; `topic.update({ where: { id }, data })` (id already proven owned).
  - `assertNoParentCycle(userId, id, parentId)` and `assertNoPrereqCycle(userId, ...)` → every `topic.findUnique`/`prerequisite.findMany` walk adds `userId` to the `where`.
  - `addPrerequisite(userId, topicId, prerequisiteId)` → `findOne(userId, topicId)` **and** `findOne(userId, prerequisiteId)` (this is the cross-user link guard — both must be the caller's), then upsert unchanged.
  - `removePrerequisite(userId, topicId, prerequisiteId)` → `prerequisite.deleteMany({ where: { topicId, prerequisiteId } })` after a `findOne(userId, topicId)` ownership check.
  - `remove(userId, id)` → `topic.findFirst({ where: { id, userId }, include: { _count: ... } })`; the `$transaction` bodies add `userId` to `updateMany`/`deleteMany` `where` where they target topics (`updateMany({ where: { parentId: id, userId }, ... })`).

- [ ] **Step 4: Update the controller** (`topics.controller.ts`): add `@CurrentUser() userId: string` to every handler and pass it first. Example:

```ts
@Get() findAll(@CurrentUser() userId: string) { return this.topics.findAll(userId); }
@Get(':id') getDetail(@CurrentUser() userId: string, @Param('id') id: string) {
  return this.topics.getDetail(userId, id);
}
```
(Repeat for POST/PATCH/DELETE, app-events, and both prerequisite routes.)

- [ ] **Step 5: Update existing spec calls.** Every existing `svc.method(...)` call in `topics.service.spec.ts` gets a leading `'userA'` (or any id), and mocks that assert `findUnique` now assert `findFirst` with `{ id, userId }`.

- [ ] **Step 6: Run the topics suite — verify pass.** Run: `yarn workspace @terrain/api test topics.service` → all passing (existing + 2 new).

- [ ] **Step 7: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B2: Scope ReviewsService + denormalize userId in sr-apply

**Files:**
- Modify: `apps/api/src/reviews/sr-apply.ts`, `apps/api/src/reviews/reviews.service.ts`, `apps/api/src/reviews/reviews.controller.ts`
- Test: `apps/api/src/reviews/sr-apply.spec.ts`, `apps/api/src/reviews/reviews.service.spec.ts`

**Interfaces:**
- Produces:
  - `buildReviewWrites(topic, quality, mode, note, now, durationMin?)` — **unchanged signature**, but its returned `review` object now includes `userId: topic.userId` (the denormalized owner comes from the topic, so no new param).
  - `ReviewsService.logReview(userId, dto)`, `ReviewsService.findByTopic(userId, topicId)`.

- [ ] **Step 1: Write the failing sr-apply test** (append to `sr-apply.spec.ts`):

```ts
it('stamps the review with the topic owner\'s userId', () => {
  const topic: any = { id: 't1', userId: 'userA', easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewAt: null };
  const { review } = buildReviewWrites(topic, 5, 'app_log', undefined, new Date('2026-07-01T00:00:00Z'));
  expect(review.userId).toBe('userA');
});
```

- [ ] **Step 2: Run it — FAIL** (`review.userId` undefined). Run: `yarn workspace @terrain/api test sr-apply`.

- [ ] **Step 3: Add `userId` to the returned review** in `sr-apply.ts` — inside the returned `review: { ... }` object add `userId: topic.userId,`. (`Topic` now carries `userId`, so no signature change.)

- [ ] **Step 4: Scope `ReviewsService`.**
  - `logReview(userId, dto)` → `topic.findFirst({ where: { id: dto.topicId, userId } })` (was `findUnique`); throw 404 if missing; the `buildReviewWrites` result already carries `userId`; transaction `topic.update({ where: { id: dto.topicId }, data })` unchanged (ownership proven).
  - `findByTopic(userId, topicId)` → `review.findMany({ where: { topicId, userId }, ... })`.

- [ ] **Step 5: Update `reviews.controller.ts`** — `@CurrentUser() userId` on both handlers; pass first. The GET keeps its `topicId` required-query 400 guard.

- [ ] **Step 6: Update `reviews.service.spec.ts`** existing calls with a leading `userId` and `findUnique`→`findFirst` mock/assert change.

- [ ] **Step 7: Run reviews + sr-apply suites — pass.** Run: `yarn workspace @terrain/api test reviews sr-apply`.

- [ ] **Step 8: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B3: Scope MetricsService

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts`, `apps/api/src/metrics/metrics.controller.ts`
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Produces (userId first): `struggleRatio7d(userId, now)`, `heatmap(userId, now, days?)`, `dueTopics(userId, now, domain?)`, `dashboard(userId, now, domain?)`. Pure helpers `topicLabels(...)` and `masteryStatus(...)` are **unchanged** (no DB).

- [ ] **Step 1: Write the failing test** (append to `metrics.service.spec.ts`):

```ts
it('struggleRatio7d scopes reviews to the user', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma: any = { review: { findMany } };
  const svc = new MetricsService(prisma);
  await svc.struggleRatio7d('userA', new Date('2026-07-01T00:00:00Z'));
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: 'userA' }) }),
  );
});
```

- [ ] **Step 2: Run — FAIL.** Run: `yarn workspace @terrain/api test metrics.service`.

- [ ] **Step 3: Add `userId` to each query.**
  - `struggleRatio7d`: `review.findMany({ where: { userId, reviewedAt: { gte: cutoff } }, ... })`.
  - `heatmap`: `review.findMany({ where: { userId, reviewedAt: { gte: start } }, ... })`.
  - `dueTopics`: `topic.findMany({ where: { userId, status: 'active', nextReviewAt: {...}, ...(domain?{domain}:{}) } })`.
  - `dashboard`: pass `userId` into the three parallel calls; `topic.groupBy({ by:['status'], _count:true, where: { userId, ...(domain?{domain}:{}) } })` (note: `where` is now always present).

- [ ] **Step 4: Update `metrics.controller.ts`** — `@CurrentUser() userId` on `dashboard` + `heatmap`; pass first (before `now`/domain). The controller constructs `now = new Date()` as before.

- [ ] **Step 5: Update existing spec calls** with a leading `userId`.

- [ ] **Step 6: Run — pass.** Run: `yarn workspace @terrain/api test metrics.service`.

- [ ] **Step 7: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B4: Scope StreakService + multi-user cron

**Files:**
- Modify: `apps/api/src/streak/streak.service.ts`, `apps/api/src/streak/streak.cron.ts`, `apps/api/src/streak/streak.controller.ts`
- Test: `apps/api/src/streak/streak.service.spec.ts`

**Interfaces:**
- Produces (userId first): `getState(userId)`, `evaluateDay(userId, date)`, `skipToday(userId, now)`. Pure `classifyDay(...)`/`applyDay(...)` unchanged. Cron `evaluateYesterday()` iterates all users.

- [ ] **Step 1: Write the failing test** (append to `streak.service.spec.ts`):

```ts
it('getState upserts the caller\'s per-user streak row', async () => {
  const upsert = jest.fn().mockResolvedValue({ userId: 'userA', currentStreak: 0 });
  const prisma: any = { streakState: { upsert } };
  const svc = new StreakService(prisma);
  await svc.getState('userA');
  expect(upsert).toHaveBeenCalledWith({ where: { userId: 'userA' }, update: {}, create: { userId: 'userA' } });
});
```

- [ ] **Step 2: Run — FAIL.** Run: `yarn workspace @terrain/api test streak.service`.

- [ ] **Step 3: Scope the service.**
  - `getState(userId)` → `streakState.upsert({ where: { userId }, update: {}, create: { userId } })`.
  - `evaluateDay(userId, date)`: `dailyLog.findUnique({ where: { userId_date: { userId, date: start } } })`; `review.count({ where: { userId, reviewedAt: {...} } })`; `topic.count({ where: { userId, status:'active', nextReviewAt:{...} } })`; `getState(userId)`; transaction `dailyLog.create({ data: { userId, date: start, dayType } })` + `streakState.update({ where: { userId }, data: next })`.
  - `skipToday(userId, now)`: same `dailyLog` composite-key lookup + `create({ data: { userId, date: start, dayType: frozen } })` + `streakState.update({ where: { userId }, data: {...} })`.

- [ ] **Step 4: Multi-user cron** (`streak.cron.ts`): inject `PrismaService`; iterate users:

```ts
@Injectable()
export class StreakCron {
  private readonly logger = new Logger(StreakCron.name);
  constructor(
    private streak: StreakService,
    private prisma: PrismaService,
  ) {}

  @Cron('5 0 * * *')
  async evaluateYesterday() {
    const yesterday = new Date(Date.now() - 86_400_000);
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const u of users) await this.streak.evaluateDay(u.id, yesterday);
    this.logger.log(`Evaluated streak for ${users.length} users on ${yesterday.toDateString()}`);
  }
}
```
(Confirm `StreakModule` imports `PrismaModule` or that Prisma is global — it is `@Global`, so injection works without a new import.)

- [ ] **Step 5: Update `streak.controller.ts`** — `@CurrentUser() userId` on `GET /streak` (`getState(userId)`) and `POST /streak/skip` (`skipToday(userId, new Date())`).

- [ ] **Step 6: Update existing spec calls** with a leading `userId`; any `dailyLog.findUnique`/`streakState.update` assertions switch to the composite/`userId` keys.

- [ ] **Step 7: Run — pass.** Run: `yarn workspace @terrain/api test streak.service`.

- [ ] **Step 8: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B5: Scope Sessions/export-generator + per-user identity block

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts`, `apps/api/src/sessions/sessions.service.ts`, `apps/api/src/sessions/sessions.controller.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts`, `apps/api/src/sessions/sessions.service.spec.ts`

**Interfaces:**
- Produces:
  - `ExportGeneratorService.generate({ mode?, focusTopicId?, now, userId })` — adds `userId`; identity block built from the user's profile instead of the `WHO_I_AM` constant.
  - `SessionsService.createExport(userId, opts)`.

- [ ] **Step 1: Write the failing test** (append to `export-generator.service.spec.ts`). Extend the existing prisma mock with `user.findUnique` and assert scoping + identity:

```ts
it('scopes topics to the user and renders the user\'s profile as the identity block', async () => {
  const prisma: any = {
    topic: { findMany: jest.fn().mockResolvedValue([]) },
    applicationEvent: { count: jest.fn().mockResolvedValue(0) },
    sessionExport: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'userA', name: 'Neo', role: 'Hacker', learningStyle: 'x', codeStyle: 'y', noteSystem: 'z' }) },
  };
  const metrics: any = { struggleRatio7d: jest.fn().mockResolvedValue(0), dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }) };
  const svc = new ExportGeneratorService(prisma, metrics);
  const md = await svc.generate({ now: new Date('2026-07-01T00:00:00Z'), userId: 'userA' });
  expect(prisma.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'userA' }) }));
  expect(md).toContain('Name: Neo');
  expect(md).not.toContain('Name: Dima');
});
```

- [ ] **Step 2: Run — FAIL.** Run: `yarn workspace @terrain/api test export-generator`.

- [ ] **Step 3: Implement.**
  - `generate(opts)` reads `opts.userId`; `topic.findMany` `where` merges `{ userId, ...(domainFilter ? { domain: domainFilter } : {}) }`.
  - Replace the `WHO_I_AM` constant usage: load `const user = await this.prisma.user.findUnique({ where: { id: opts.userId } })` and build the block:

```ts
const whoIAm = `## WHO I AM (stable)
Name: ${user?.name ?? ''}
Role: ${user?.role ?? ''}
Learning style: ${user?.learningStyle ?? ''}
Code style: ${user?.codeStyle ?? ''}
Note system: ${user?.noteSystem ?? ''}`;
```
  (Delete the module-level `WHO_I_AM` constant.)
  - `due(now, domain)` → pass `userId` into `metrics.dueTopics(userId, now, domain)`; make `due` take `userId`.
  - `struggleRatio7d` call → `metrics.struggleRatio7d(userId, opts.now)`.
  - `mastery(topics)` → `applicationEvent.count({ where: { topicId: t.id, userId: opts.userId } })` (thread `userId` into `mastery`).
  - Suggested-next-focus `sessionExport.findFirst` and `recentSessions()` `findMany` → add `userId` to their `where` (thread `userId` into `recentSessions`).

- [ ] **Step 4: Scope `SessionsService.createExport(userId, opts)`** → `generator.generate({ ...opts, now: new Date(), userId })`; `sessionExport.create({ data: { ...existing, userId } })`; the follow-up `update` unchanged.

- [ ] **Step 5: Update `sessions.controller.ts`** — `@CurrentUser() userId` on the export handler; `createExport(userId, opts)`.

- [ ] **Step 6: Update existing export-generator spec** — every prisma mock block adds `user.findUnique` returning a profile, and each `generate(...)` call adds `userId`. (There are multiple sessionExport mock blocks; add `user.findUnique` to each.)

- [ ] **Step 7: Run — pass.** Run: `yarn workspace @terrain/api test export-generator sessions.service`.

- [ ] **Step 8: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B6: Scope ImportService

**Files:**
- Modify: `apps/api/src/import/import.service.ts`, `apps/api/src/import/import.controller.ts`
- Test: `apps/api/src/import/import.service.spec.ts`

**Interfaces:**
- Produces: `ImportService.preview(userId, raw)`, `ImportService.apply(userId, raw)`; protected `load(userId, raw)` (scopes `topic.findMany` + verifies the SessionExport belongs to the user). `buildPlan` is pure over its args — **unchanged signature**.

- [ ] **Step 1: Write the failing test** (append to `import.service.spec.ts`). Assert the SessionExport lookup is user-scoped:

```ts
it('apply stamps created topics + reviews with the caller userId', async () => {
  // Build on the file's existing preview/apply mock harness; assert that
  // tx.topic.create is called with data.userId === the caller and
  // tx.review.create data.userId === the caller.
});
```
(Fill using the file's existing inline-mock `sessionExport`/`topic` stubs; the concrete assertion is `expect(txTopicCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'userA' }) })`.)

- [ ] **Step 2: Run — FAIL.** Run: `yarn workspace @terrain/api test import.service`.

- [ ] **Step 3: Scope the service.**
  - `load(userId, raw)`: `topic.findMany({ where: { userId } })`; SessionExport lookup becomes `sessionExport.findFirst({ where: { id: parsed.sessionId, userId } })` (was `findUnique` by id) → 404 if it belongs to another user.
  - `preview(userId, raw)` / `apply(userId, raw)` thread `userId` into `load` and pass to the transaction body.
  - In `apply`'s transaction: `topic.create({ data: { ...fields, userId, aiProposed: true, status: 'planned' } })`; `topicType.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, label } })`; reviews use `buildReviewWrites(topic, ...)` whose result already carries `userId` (from B2) — `tx.review.create({ data: writes.review })` unchanged; `tx.review`/`tx.topic.update` `where` target ids already proven owned via the user-scoped `existing` list.
  - The atomic claim `sessionExport.updateMany({ where: { id, importedAt: null }, ... })` → add `userId` to the `where`.

- [ ] **Step 4: Update `import.controller.ts`** — `@CurrentUser() userId` on both `/sessions/import/preview` and `/sessions/import`; pass first.

- [ ] **Step 5: Update existing spec calls** with a leading `userId`; `sessionExport.findUnique` mocks/asserts switch to `findFirst` with `{ id, userId }`.

- [ ] **Step 6: Run — pass.** Run: `yarn workspace @terrain/api test import.service`.

- [ ] **Step 7: Checkpoint.** `yarn workspace @terrain/api build` → exit 0.

---

### Task B7: Scope Settings + TopicTypes; full-suite gate

**Files:**
- Modify: `apps/api/src/settings/settings.controller.ts`, `apps/api/src/topic-types/topic-types.controller.ts`
- Test: `apps/api/src/settings/settings.controller.spec.ts` (create), `apps/api/src/topic-types/topic-types.controller.spec.ts` (create)

**Interfaces:**
- Produces: `GET /settings` → the caller's row (`settings.findUnique({ where: { userId } })`, default when absent); `GET /topic-types` → `topicType.findMany({ where: { userId } })`.

- [ ] **Step 1: Write failing controller tests** — assert each queries by `@CurrentUser()` userId. Example (`topic-types.controller.spec.ts`):

```ts
it('lists only the caller\'s topic types', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const ctrl = new TopicTypesController({ topicType: { findMany } } as any);
  await ctrl.list('userA');
  expect(findMany).toHaveBeenCalledWith({ where: { userId: 'userA' }, orderBy: expect.anything() });
});
```

- [ ] **Step 2: Run — FAIL.** Run: `yarn workspace @terrain/api test topic-types settings`.

- [ ] **Step 3: Scope both controllers.** Add `@CurrentUser() userId` to each handler. `topic-types`: `findMany({ where: { userId }, orderBy: { label: 'asc' } })`. `settings`: `settings.findUnique({ where: { userId } })`, returning the existing default shape when null (now `{ userId, obsidianVault: null, telegramChatId: null }`).

- [ ] **Step 4: Run — pass.** Run: `yarn workspace @terrain/api test topic-types settings`.

- [ ] **Step 5: FULL-SUITE GATE.**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build`
Expected: all suites green (existing + new isolation/auth tests), build 0.

- [ ] **Step 6: Live multi-user smoke.** Boot API; register two users; confirm isolation:

```bash
# register A + B, saving cookies
curl -s -c /tmp/a.txt -X POST localhost:3000/auth/register -H 'content-type: application/json' -d '{"email":"a@x.co","password":"password1","name":"A"}' >/dev/null
curl -s -c /tmp/b.txt -X POST localhost:3000/auth/register -H 'content-type: application/json' -d '{"email":"b@x.co","password":"password1","name":"B"}' >/dev/null
# A creates a topic
TID=$(curl -s -b /tmp/a.txt -X POST localhost:3000/topics -H 'content-type: application/json' -d '{"title":"A-only","domain":"D","topicType":"pattern"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# B must NOT see it, and must 404 on GET by id
curl -s -b /tmp/b.txt localhost:3000/topics            # -> [] (empty)
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/b.txt localhost:3000/topics/$TID   # -> 404
```
Expected: B's list is empty; B's GET of A's topic id is 404. Stop the server with `kill -9 $(lsof -ti:3000)`.

- [ ] **Step 7: Checkpoint.** `yarn format && yarn format:check && yarn lint` → clean.

---

# WAVE C — Web

### Task C1: API client — credentials + auth endpoints + types

**Files:**
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts`
- Test: none (typecheck via build; behavior verified in C2 smoke)

**Interfaces:**
- Produces: `api.me()`, `api.login(input)`, `api.register(input)`, `api.logout()`, `api.updateProfile(input)`; types `AuthedUser`, `LoginInput`, `RegisterInput`, `UpdateProfileInput`.

- [ ] **Step 1: Send the cookie on every request.** In `client.ts` `req()`, add `credentials: 'include'` to the `fetch` init:

```ts
const res = await fetch(BASE + path, {
  credentials: 'include',
  headers: init?.body != null ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  ...init,
});
```
(Place `credentials` before `...init` so callers can't accidentally drop it; `...init` does not set `credentials`.)

- [ ] **Step 2: Add auth types** to `types.ts`:

```ts
export interface AuthedUser {
  id: string; email: string; name: string;
  role: string | null; learningStyle: string | null;
  codeStyle: string | null; noteSystem: string | null;
}
export interface LoginInput { email: string; password: string; }
export interface RegisterInput { email: string; password: string; name: string; }
export interface UpdateProfileInput {
  name?: string; role?: string; learningStyle?: string;
  codeStyle?: string; noteSystem?: string; obsidianVault?: string;
}
```

- [ ] **Step 3: Add auth methods** to the `api` object in `client.ts` (import the new types):

```ts
  // auth
  me: () => req<AuthedUser>('/auth/me'),
  login: (input: LoginInput) => req<AuthedUser>('/auth/login', { method: 'POST', ...json(input) }),
  register: (input: RegisterInput) => req<AuthedUser>('/auth/register', { method: 'POST', ...json(input) }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  updateProfile: (input: UpdateProfileInput) =>
    req<AuthedUser>('/auth/me', { method: 'PATCH', ...json(input) }),
```

- [ ] **Step 4: Checkpoint.** `yarn workspace @terrain/web build` → exit 0 (tsc + vite).

---

### Task C2: Auth hooks, gate, and login/register screen

**Files:**
- Modify: `apps/web/src/api/hooks.ts`, `apps/web/src/main.tsx`
- Create: `apps/web/src/app/AuthGate.tsx`, `apps/web/src/screens/Auth/index.tsx`
- Test: none (verified by live CDP smoke)

**Interfaces:**
- Consumes: `api.me/login/register/logout` (C1).
- Produces: `useMe()`, `useLogin()`, `useRegister()`, `useLogout()` hooks; `<AuthGate>` wrapper; `<AuthScreen>`.

- [ ] **Step 1: Add auth hooks** to `hooks.ts` (follow the file's existing react-query patterns):

```ts
export const meKey = ['me'] as const;
export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api.me(), retry: false });
}
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.logout(), onSuccess: () => qc.clear() });
}
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.updateProfile(input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}
```
(Import `LoginInput`, `RegisterInput`, `UpdateProfileInput` from `./types`; `useQueryClient` if not already imported.)

- [ ] **Step 2: Create `AuthScreen`** (`screens/Auth/index.tsx`) — email + password, plus a name field in register mode, a mode toggle, and error via the existing toast/`ErrorBox`. On success the `me` cache is set (Step 1), which flips the gate. Minimal real component:

```tsx
import { useState } from 'react';
import { useLogin, useRegister } from '../../api/hooks';
import { Card, useToast } from '../../components';

export default function AuthScreen() {
  const { toast } = useToast();
  const login = useLogin();
  const register = useRegister();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const pending = login.isPending || register.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const onError = (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Auth failed', 'error');
    if (mode === 'login') login.mutate({ email, password }, { onError });
    else register.mutate({ email, password, name }, { onError });
  };

  return (
    <div className="page" style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1 className="page-title">Terrain</h1>
      <Card title={mode === 'login' ? 'Log in' : 'Create account'}>
        <form className="col gap-3" onSubmit={submit}>
          {mode === 'register' && (
            <input className="input" placeholder="Name" value={name}
              onChange={(e) => setName(e.target.value)} required />
          )}
          <input className="input" type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Password (min 8)" value={password}
            onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <button className="btn btn-primary" disabled={pending} type="submit">
            {pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
          <button type="button" className="btn btn-sm"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
          </button>
        </form>
      </Card>
    </div>
  );
}
```
(If `input`/`btn` classes differ, reuse whatever the existing forms — e.g. `TopicForm.tsx` — use.)

- [ ] **Step 3: Create `AuthGate`** (`app/AuthGate.tsx`) — gate the app on `useMe()`:

```tsx
import type { ReactNode } from 'react';
import { useMe } from '../api/hooks';
import { Loading } from '../components';
import AuthScreen from '../screens/Auth';

export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Loading label="Loading…" />;
  if (me.isError || !me.data) return <AuthScreen />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Mount the gate** in `main.tsx` — wrap the existing `<RouterProvider router={router} />` with `<AuthGate>` **inside** the `QueryClientProvider` and `ToastProvider` (AuthScreen/useMe need both). Confirm the wrapping order by reading `main.tsx` first.

- [ ] **Step 5: Live CDP smoke.** Boot the stack (`docker compose up -d`, API, web), then drive `scripts/smoke.mjs` against `:5180`:
  - Unauthenticated `/` shows the login card (not the dashboard).
  - Register a fresh user → app renders, dashboard loads, `/topics` is empty for the new user.
  - Reload → still logged in (cookie persists).
  - 0 console errors on all routes.
Expected: gate behaves; new user sees an empty but functional app.

- [ ] **Step 6: Checkpoint.** `yarn workspace @terrain/web build` → exit 0.

---

### Task C3: Settings screen (profile editor) + empty states

**Files:**
- Create: `apps/web/src/screens/Settings/index.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/app/Layout.tsx`
- Modify (empty-state copy): `apps/web/src/screens/Roadmap/index.tsx`, `apps/web/src/screens/Export/index.tsx` (only where they say "add topics first")
- Test: none (verified by build + smoke)

**Interfaces:**
- Consumes: `useMe()`, `useUpdateProfile()`, `useLogout()` (C2).
- Produces: a `/settings` route + nav link; a profile form editing the identity fields + `obsidianVault`; a logout button.

- [ ] **Step 1: Create the Settings screen** (`screens/Settings/index.tsx`) — seed form state from `useMe()`, PATCH via `useUpdateProfile()`, toast on success/error, and a logout button (`useLogout()`):

```tsx
import { useEffect, useState } from 'react';
import { useMe, useUpdateProfile, useLogout } from '../../api/hooks';
import { Card, Loading, useToast } from '../../components';

export default function Settings() {
  const me = useMe();
  const update = useUpdateProfile();
  const logout = useLogout();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', role: '', learningStyle: '', codeStyle: '', noteSystem: '' });

  useEffect(() => {
    if (me.data) setForm({
      name: me.data.name ?? '', role: me.data.role ?? '',
      learningStyle: me.data.learningStyle ?? '', codeStyle: me.data.codeStyle ?? '',
      noteSystem: me.data.noteSystem ?? '',
    });
  }, [me.data]);

  if (me.isLoading) return <Loading label="Loading…" />;
  const field = (k: keyof typeof form, label: string) => (
    <label className="col gap-1">
      <span className="field-label">{label}</span>
      <input className="input" value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1 className="page-title">Settings</h1>
      <Card title="Profile — this drives your session export's WHO I AM block">
        <div className="col gap-3">
          {field('name', 'Name')}
          {field('role', 'Role')}
          {field('learningStyle', 'Learning style')}
          {field('codeStyle', 'Code style')}
          {field('noteSystem', 'Note system')}
          <button className="btn btn-primary" disabled={update.isPending}
            onClick={() => update.mutate(form, {
              onSuccess: () => toast('Profile saved', 'success'),
              onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
            })}>
            {update.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </Card>
      <Card title="Account">
        <button className="btn" onClick={() => logout.mutate()}>Log out</button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route** in `router.tsx` — add a `settingsRoute` (path `/settings`, component `Settings`) and include it in `rootRoute.addChildren([...])` (mirror the existing 5 routes).

- [ ] **Step 3: Add the nav link** in `Layout.tsx` — append `{ to: '/settings', label: 'Settings' }` (match the shape of the existing nav array).

- [ ] **Step 4: Refresh empty states** — in `Roadmap/index.tsx` and `Export/index.tsx`, where the copy currently says "add some topics first"/"No topics yet", update to guide the loop: "No topics yet — add one on the Topics screen, or run an Export and let Claude propose your roadmap." (Text-only change; keep existing conditionals.)

- [ ] **Step 5: Live smoke.** With a freshly-registered user: edit the profile → save → generate an Export → confirm the `## WHO I AM` block shows the edited name (not `Dima`). Log out → gate returns to login.

- [ ] **Step 6: Final checkpoint.**

Run: `yarn build && yarn test && yarn lint && yarn format:check`
Expected: every workspace builds; all suites green; lint + format clean.

---

## Self-Review (author's pass — completed)

**Spec coverage:** §3 data model → A1; §3.3 per-user PKs → A1; seed → A2; §4.1 mechanism → A3/A4; §4.2 endpoints → A4; §4.3 guard/scoping → A4 + all of Wave B; §4.4 multi-user cron → B4; §5 identity/profile → B5 + C3; §6 web (login/gate/credentials/profile/empty states) → C1–C3; §7 schema-rewrite/seed → A1/A2; §8 isolation tests → B1–B7 (+ live smoke B7/C2); §9 in-scope security → A3/A4 (hardening correctly deferred to Sub-project 2). No spec requirement is unmapped.

**Placeholder scan:** the only intentional non-code marker is the `@relation_placeholder` pseudo-line in A1 Step 3, which its own note instructs the implementer to delete — kept deliberately to flag the `DailyLog` PK subtlety. B6 Step 1's test body is described-then-given-a-concrete-assertion because it builds on the existing file's inline mock harness (which the implementer has in front of them); the exact assertion string is provided.

**Type consistency:** `SafeUser`/`AuthedUser`, `@CurrentUser() userId: string`, and the `userId`-first parameter order are consistent across A3→A4→Wave B; `buildReviewWrites` keeps its signature (userId derived from `topic.userId`) so B2 and B6 agree; cookie name `token`, `IS_PUBLIC` key, and `JWT_SECRET` match across guard/module/controller.
