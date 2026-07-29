# Read-only Learning MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ChatGPT and Claude retrieve the same authenticated
`LearningContext` as Terrain’s diagnostic REST endpoint through one read-only
remote MCP tool.

**Architecture:** Mount stable MCP SDK v1 Streamable HTTP inside the existing
Nest/Express process. A small OAuth authorization-code/PKCE provider reuses the
Terrain browser login, issues short-lived audience-bound access JWTs, and
stores only hashed authorization codes and rotating refresh tokens. The MCP
tool delegates directly to `LearningContextService`; it owns no learning
policy or persistence.

**Tech Stack:** Node 24, TypeScript 6, NestJS 11, Prisma 7/Postgres,
`@modelcontextprotocol/sdk` 1.29.0, Zod 3.25, Jest/Supertest, React 19, Caddy.

## Preconditions and constraints

- Complete and deploy
  `docs/superpowers/plans/2026-07-24-adaptive-learning-context.md` first.
- Follow §8 of
  `docs/superpowers/specs/2026-07-24-adaptive-learning-context-mcp-design.md`.
- Expose exactly one tool: `get_learning_context({ topic? })`.
- The tool is read-only and calls `LearningContextService.context`; it does not
  copy roadmap, recommendation, or evidence rules.
- Use stateless Streamable HTTP with JSON responses. No sessions, SSE
  resumability, notifications, resources, prompts, separate process, or
  container.
- Support only pre-registered confidential clients. No dynamic client
  registration.
- The only Terrain permission is `learning:read`; `offline_access` only asks
  for refresh-token issuance.
- Require authorization code + PKCE S256, an exact redirect URI, an exact MCP
  `resource`, refresh-token rotation, and audience validation.
- Never persist raw authorization codes, refresh tokens, or client secrets.
- Keep browser-cookie and MCP access-token signing secrets separate.
- Do not commit unless the user explicitly asks.

## Public URL model

One environment value avoids conflicting path assumptions:

```text
MCP_PUBLIC_API_URL=https://terrain.example.com/api
```

Derive:

```text
issuer                 https://terrain.example.com
resource               https://terrain.example.com/api/mcp
authorization endpoint https://terrain.example.com/api/oauth/authorize
token endpoint         https://terrain.example.com/api/oauth/token
protected metadata     https://terrain.example.com/.well-known/oauth-protected-resource
server metadata        https://terrain.example.com/.well-known/oauth-authorization-server
```

For direct local API tests, use `MCP_PUBLIC_API_URL=http://localhost:3000`, so
the resource is `http://localhost:3000/mcp`.

## File map

**Create**

- `apps/api/src/mcp/mcp.config.ts` — validated public URLs, clients, secrets,
  hosts, and origins.
- `apps/api/src/mcp/mcp.config.spec.ts` — fail-closed configuration tests.
- `apps/api/src/mcp/oauth.service.ts` — authorization-code, access-token, and
  rotating-refresh-token flow.
- `apps/api/src/mcp/oauth.service.spec.ts` — PKCE, replay, scope, resource, and
  client tests.
- `apps/api/src/mcp/oauth.controller.ts` — discovery, authorize, token, and
  grant-revocation routes.
- `apps/api/src/mcp/oauth.controller.spec.ts` — HTTP metadata and redirect
  contract.
- `apps/api/src/mcp/mcp-bearer.guard.ts` — Bearer validation plus
  host/origin checks.
- `apps/api/src/mcp/mcp-bearer.guard.spec.ts` — 401 challenge, audience, scope,
  host, origin, and user tests.
- `apps/api/src/mcp/mcp.service.ts` — one tool and per-request stateless
  transport.
- `apps/api/src/mcp/mcp.controller.ts` — authenticated POST plus protocol-safe
  GET/DELETE rejection.
- `apps/api/src/mcp/mcp.controller.spec.ts` — JSON-RPC transport tests.
- `apps/api/src/mcp/mcp.module.ts` — API module wiring.
- `apps/api/prisma/migrations/20260724000002_mcp_oauth/migration.sql` — hashed
  OAuth state.
- `apps/web/src/screens/OAuthAuthorize/index.tsx` — login-gated approval screen.

**Modify**

- `apps/api/package.json` and `yarn.lock` — stable MCP SDK and direct Zod
  dependency.
- `apps/api/prisma/schema.prisma` — authorization code and refresh token
  models.
- `apps/api/src/app.module.ts` — import `McpModule`.
- `apps/api/src/main.ts` — validate enabled MCP configuration at startup.
- `apps/api/.env.example` — disabled-by-default MCP settings.
- `apps/web/src/api/client.ts` — approve/deny and grant endpoints.
- `apps/web/src/api/types.ts` — OAuth request/grant response types.
- `apps/web/src/app/router.tsx` — `/oauth/authorize` route.
- `apps/web/src/screens/Settings/index.tsx` — list/revoke connected clients.
- `apps/web/Caddyfile` — proxy root OAuth discovery documents.
- `docs/ops/deploy.md` — production setup, callback registration, verification,
  and revocation.

---

### Task 1: Pin dependencies and validate configuration

**Files:**

- Modify: `apps/api/package.json`
- Modify: `yarn.lock`
- Create: `apps/api/src/mcp/mcp.config.ts`
- Create: `apps/api/src/mcp/mcp.config.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**

- `loadMcpConfig(env = process.env): McpConfig | null`
- Unset `MCP_PUBLIC_API_URL` means MCP/OAuth is disabled.
- A partially configured integration fails API startup.

- [ ] **Step 1: Write failing configuration tests**

Pin:

```ts
it('is disabled when MCP_PUBLIC_API_URL is absent', () => {
  expect(loadMcpConfig({})).toBeNull();
});

it('derives the production issuer, resource, and endpoints', () => {
  const config = loadMcpConfig({
    MCP_PUBLIC_API_URL: 'https://terrain.example.com/api',
    MCP_TOKEN_SECRET: 'm'.repeat(64),
    MCP_OAUTH_CLIENTS: JSON.stringify([
      {
        id: 'claude',
        name: 'Claude',
        secret: 'c'.repeat(32),
        redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      },
    ]),
    WEB_BASE_URL: 'https://terrain.example.com',
  })!;

  expect(config).toMatchObject({
    issuer: 'https://terrain.example.com',
    resource: 'https://terrain.example.com/api/mcp',
    authorizationEndpoint: 'https://terrain.example.com/api/oauth/authorize',
    tokenEndpoint: 'https://terrain.example.com/api/oauth/token',
    protectedResourceMetadata:
      'https://terrain.example.com/.well-known/oauth-protected-resource',
  });
});

it.each([
  ['missing token secret', { MCP_TOKEN_SECRET: undefined }],
  ['short token secret', { MCP_TOKEN_SECRET: 'short' }],
  ['missing clients', { MCP_OAUTH_CLIENTS: undefined }],
  ['non-HTTPS production URL', { MCP_PUBLIC_API_URL: 'http://terrain.example.com/api' }],
  ['API URL with query', { MCP_PUBLIC_API_URL: 'https://terrain.example.com/api?x=1' }],
  ['duplicate client id', { MCP_OAUTH_CLIENTS: DUPLICATE_CLIENTS }],
  ['non-HTTPS remote redirect', { MCP_OAUTH_CLIENTS: HTTP_REDIRECT_CLIENT }],
])('rejects %s', (_name, override) => {
  expect(() => loadMcpConfig({ ...VALID_ENV, ...override })).toThrow();
});
```

Also accept `http://localhost` API/redirect URLs in non-production tests and
reject wildcard redirect URIs.

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand mcp.config.spec.ts
```

Expected: FAIL because the config module does not exist.

- [ ] **Step 3: Install the two direct dependencies**

Add:

```json
"@modelcontextprotocol/sdk": "1.29.0",
"zod": "3.25.76"
```

Then run:

```bash
yarn install
```

Expected: `apps/api/package.json` and `yarn.lock` change; no other manifest
changes.

- [ ] **Step 4: Implement fail-closed parsing**

Use this shape:

```ts
export type McpClient = {
  id: string;
  name: string;
  secret: string;
  redirectUris: string[];
};

export type McpConfig = {
  publicApiUrl: string;
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  protectedResourceMetadata: string;
  authorizationServerMetadata: string;
  webBaseUrl: string;
  tokenSecret: string;
  clients: Map<string, McpClient>;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
};
```

Use `URL` and `JSON.parse`; do not add a configuration library. Normalize the
API URL by removing one trailing slash. Require:

- `MCP_TOKEN_SECRET.length >= 32`;
- one or more unique clients;
- client IDs matching `/^[a-z0-9_-]{1,64}$/`;
- client secrets of at least 32 characters;
- non-empty, exact redirect URL arrays;
- HTTPS except for hostnames `localhost` and `127.0.0.1`;
- no query, hash, embedded username, or password in configured URLs.

`MCP_ALLOWED_ORIGINS` is a comma-separated addition to the resource origin.
Do not add ChatGPT or Claude origins by default; server-to-server clients
normally omit `Origin`, and any sent value must be explicitly allowed.

Authorization scope parsing treats whitespace-separated values as a set and
normalizes accepted output to `['learning:read']` or
`['learning:read', 'offline_access']`; duplicates and any other value fail.

- [ ] **Step 5: Validate at bootstrap and document disabled defaults**

Call `loadMcpConfig()` in `bootstrap()` before `NestFactory.create`. It returns
`null` when disabled and throws a secret-free error when partially configured.

Add empty values to `.env.example`:

```dotenv
# --- Read-only remote MCP (optional; unset MCP_PUBLIC_API_URL = disabled) ---
MCP_PUBLIC_API_URL=
MCP_TOKEN_SECRET=
MCP_OAUTH_CLIENTS=
MCP_ALLOWED_ORIGINS=
```

- [ ] **Step 6: Run tests and API build**

```bash
yarn workspace @terrain/api test --runInBand mcp.config.spec.ts
yarn workspace @terrain/api build
git diff --check
```

Expected: config tests pass and the API builds.

---

### Task 2: Persist one-time codes and rotating refresh tokens

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260724000002_mcp_oauth/migration.sql`
- Create: `apps/api/src/mcp/oauth.service.ts`
- Create: `apps/api/src/mcp/oauth.service.spec.ts`

**Interfaces:**

- `validateAuthorizationRequest(input): ValidatedAuthorizationRequest`
- `approve(userId, input): Promise<string>` returns the client callback URL.
- `deny(input): string` returns the client callback URL with `access_denied`.
- `exchangeCode(input): Promise<OAuthTokenResponse>`
- `refresh(input): Promise<OAuthTokenResponse>`
- `listGrants(userId)` and `revokeGrant(userId, clientId)`.

- [ ] **Step 1: Write failing security-path tests**

Cover:

1. exact registered redirect, `response_type=code`, `S256`, non-empty state,
   `learning:read`, optional `offline_access`, and exact resource are accepted;
2. unknown client, redirect mismatch, missing PKCE, `plain`, extra scope, or
   wrong resource are rejected;
3. approval stores only SHA-256 code hash and redirects with raw code + state;
4. a code expires after five minutes and can be redeemed once;
5. wrong `code_verifier`, redirect, client secret, or resource cannot redeem;
6. access JWT has `sub`, `iss`, `aud`, `scope`, `token_use=mcp_access`, and a
   15-minute expiry plus `client_id`;
7. `offline_access` produces a raw refresh token while only its hash is stored;
8. refresh rotates the token in one transaction;
9. replay of a revoked refresh token revokes its token family and grant;
10. grant revocation immediately invalidates access and refresh tokens for
    only the current user/client.

The PKCE fixture:

```ts
const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const challenge = createHash('sha256').update(verifier).digest('base64url');
```

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand oauth.service.spec.ts
```

Expected: FAIL because the service and Prisma models do not exist.

- [ ] **Step 3: Add the Prisma models**

Add relations to `User`:

```prisma
mcpAuthorizationCodes McpAuthorizationCode[]
mcpRefreshTokens      McpRefreshToken[]
mcpOAuthGrants        McpOAuthGrant[]
```

Add:

```prisma
model McpAuthorizationCode {
  id            String    @id @default(uuid())
  codeHash      String    @unique
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientId      String
  redirectUri   String
  codeChallenge String
  scopes        String[]
  resource      String
  expiresAt     DateTime
  usedAt        DateTime?
  createdAt     DateTime  @default(now())

  @@index([userId, clientId])
  @@index([expiresAt])
}

model McpRefreshToken {
  id        String    @id @default(uuid())
  tokenHash String    @unique
  familyId  String
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientId  String
  scopes    String[]
  resource  String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, clientId])
  @@index([familyId])
  @@index([expiresAt])
}

model McpOAuthGrant {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientId  String
  scopes    String[]
  grantedAt DateTime  @default(now())
  revokedAt DateTime?

  @@unique([userId, clientId])
}
```

The migration creates both tables, unique/indexes, and cascading foreign keys.
It does not alter or delete learning data.

Run:

```bash
yarn workspace @terrain/api exec prisma generate
```

Expected: client generation succeeds.

- [ ] **Step 4: Implement cryptographic primitives with Node stdlib**

Keep these private helpers in `oauth.service.ts`:

```ts
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const pkceS256 = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

function equalSecret(actual: string, expected: string): boolean {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
```

Validate verifier syntax with `/^[A-Za-z0-9._~-]{43,128}$/`. Hash codes and
refresh tokens before every database write/lookup.

- [ ] **Step 5: Implement authorization approval and denial**

Approval:

1. revalidates every request field;
2. generates a random code;
3. stores its hash with a five-minute expiry and authenticated `userId`;
4. upserts the user/client grant with `revokedAt: null`;
5. returns the exact registered redirect URI with `code` and original `state`.

Denial revalidates the client/redirect/resource and returns that URI with
`error=access_denied` and the original state. It writes nothing.

- [ ] **Step 6: Implement code exchange and refresh rotation**

Authenticate the configured client with constant-time comparison. Code
exchange uses a transaction that:

1. finds the hash;
2. rejects used/expired/mismatched rows;
3. verifies PKCE;
4. atomically marks `usedAt` with `updateMany` constrained by `usedAt: null`
   and `expiresAt > now`, requiring `count === 1`;
5. optionally creates a 30-day refresh-token row.

Sign access tokens through the existing `JwtService`, overriding global cookie
defaults:

```ts
await this.jwt.signAsync(
  {
    sub: userId,
    client_id: clientId,
    scope: scopes.join(' '),
    token_use: 'mcp_access',
  },
  {
    secret: config.tokenSecret,
    issuer: config.issuer,
    audience: config.resource,
    expiresIn: '15m',
  },
);
```

Return:

```ts
{
  access_token: accessToken,
  token_type: 'Bearer',
  expires_in: 900,
  scope: scopes.join(' '),
  ...(refreshToken ? { refresh_token: refreshToken } : {}),
}
```

Refresh lookup and old-token revocation occur in one transaction. Claim the
old row with `updateMany` constrained by `revokedAt: null` and
`expiresAt > now`, requiring `count === 1` before creating its replacement in
the same family. A revoked token replay
updates every unrevoked row in that family and revokes the user/client grant
before returning `invalid_grant`. Code exchange and refresh both require an
unrevoked grant.

- [ ] **Step 7: Run focused tests and migration status**

```bash
yarn workspace @terrain/api test --runInBand oauth.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/api exec prisma migrate status
```

Expected: tests/build pass; migration is pending locally or applied, with no
drift/reset instruction.

---

### Task 3: Add OAuth discovery, approval UI, and revocation

**Files:**

- Create: `apps/api/src/mcp/oauth.controller.ts`
- Create: `apps/api/src/mcp/oauth.controller.spec.ts`
- Create: `apps/web/src/screens/OAuthAuthorize/index.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/screens/Settings/index.tsx`

**Interfaces:**

- Public:
  - `GET /.well-known/oauth-protected-resource`
  - `GET /.well-known/oauth-authorization-server`
  - `GET /oauth/authorize`
  - `POST /oauth/token`
- Cookie-authenticated:
  - `POST /oauth/authorize`
  - `GET /oauth/grants`
  - `DELETE /oauth/grants/:clientId`

- [ ] **Step 1: Write controller tests first**

Assert exact protected-resource metadata:

```json
{
  "resource": "https://terrain.example.com/api/mcp",
  "authorization_servers": ["https://terrain.example.com"],
  "scopes_supported": ["learning:read", "offline_access"],
  "bearer_methods_supported": ["header"]
}
```

Assert server metadata includes:

```json
{
  "issuer": "https://terrain.example.com",
  "authorization_endpoint": "https://terrain.example.com/api/oauth/authorize",
  "token_endpoint": "https://terrain.example.com/api/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["learning:read", "offline_access"]
}
```

Also pin:

- GET authorize validates then redirects to the Terrain web approval route;
- POST approve/deny requires the browser cookie;
- token responses set `Cache-Control: no-store` and `Pragma: no-cache`;
- OAuth errors use `{ error, error_description }` without stack traces;
- grant listing omits token hashes and IDs.

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand oauth.controller.spec.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement discovery and authorization routes**

Use one controller with method-level `@Public()` only on discovery, authorize
GET, and token POST. GET authorize validates the query and redirects to:

```ts
const approval = new URL('/oauth/authorize', config.webBaseUrl);
for (const [key, value] of Object.entries(validated.original)) {
  approval.searchParams.set(key, value);
}
return response.redirect(302, approval.toString());
```

The web page remains behind the existing `AuthGate`: if the learner has no
cookie, the current login screen appears at the same URL; after login, the
router mounts and renders approval without a new return-to mechanism.

POST authorize accepts the same request fields plus `approved: boolean`,
revalidates server-side, and returns `{ redirectUrl }` from `approve` or
`deny`. The browser then uses `window.location.assign(redirectUrl)`.

Token POST accepts URL-encoded OAuth field names and client authentication via
HTTP Basic or `client_id` + `client_secret` body fields. Reject conflicting
credentials. Add a ten-per-minute endpoint throttle.

- [ ] **Step 4: Build the small approval screen**

Add typed route search for:

```ts
{
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}
```

Render:

```text
Connect this AI client to Terrain?
Allow read-only access to your learning context and roadmap decisions.
[Allow] [Deny]
```

Display `client_id` and requested scopes. Both buttons post to the server; do
not construct callback URLs in the browser. Disable both while pending and
surface API errors without exposing request secrets.

- [ ] **Step 5: Add grant listing and revocation**

`GET /oauth/grants` reads active `McpOAuthGrant` rows and returns:

```ts
type OAuthGrant = {
  clientId: string;
  clientName: string;
  scopes: string[];
  connectedAt: string;
};
```

`DELETE /oauth/grants/:clientId` runs `updateMany` with both `userId` and
`clientId` for both the grant and refresh tokens in one transaction. Because
the bearer guard checks the grant, disconnect also invalidates already-issued
access tokens immediately. Add a Settings section listing connections with a
**Disconnect** button. No general OAuth-admin screen is needed.

- [ ] **Step 6: Run API/web tests and builds**

```bash
yarn workspace @terrain/api test --runInBand oauth.controller.spec.ts oauth.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/web build
```

Expected: tests and both production builds pass.

---

### Task 4: Enforce Bearer, scope, resource, host, and origin

**Files:**

- Create: `apps/api/src/mcp/mcp-bearer.guard.ts`
- Create: `apps/api/src/mcp/mcp-bearer.guard.spec.ts`

**Interfaces:**

- `McpBearerGuard` sets `request.userId` only after full validation.
- Every authentication failure includes an RFC 9728 discovery challenge.

- [ ] **Step 1: Write failing guard tests**

Pin:

- absent/malformed/invalid/expired token returns `401`;
- disabled MCP returns `404` without an OAuth challenge;
- cookie alone never authenticates MCP;
- wrong `iss`, `aud`, `token_use`, or missing `learning:read` returns `401`;
- a token naming a client removed from configuration returns `401`;
- a missing/revoked user-client grant returns `401`;
- a deleted/foreign user returns `401`;
- mismatched Host returns `400`;
- an absent Origin is accepted;
- configured/resource origins are accepted;
- any other present Origin returns `403`;
- success writes only the token subject to `request.userId`.

Every `401` must contain:

```text
WWW-Authenticate: Bearer resource_metadata="https://terrain.example.com/.well-known/oauth-protected-resource", scope="learning:read"
```

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand mcp-bearer.guard.spec.ts
```

Expected: FAIL because the guard does not exist.

- [ ] **Step 3: Implement transport-boundary validation**

Validation order:

1. MCP must be configured or the route returns `404`;
2. request Host equals `new URL(config.resource).host`;
3. a present Origin is in `config.allowedOrigins`;
4. Authorization is exactly one `Bearer` token;
5. verify JWT using `config.tokenSecret`, `issuer`, and `audience`;
6. require `token_use === 'mcp_access'`;
7. split `scope` on spaces and require `learning:read`;
8. require string `sub` and `client_id`, and require that client to remain
   configured;
9. confirm the user exists and their user/client grant is unrevoked;
10. set `request.userId`.

Set the challenge header immediately before every `UnauthorizedException`.
Never include JWT errors or token content in the response.

- [ ] **Step 4: Run guard tests and API build**

```bash
yarn workspace @terrain/api test --runInBand mcp-bearer.guard.spec.ts
yarn workspace @terrain/api build
```

Expected: all pass.

---

### Task 5: Expose one stateless read-only MCP tool

**Files:**

- Create: `apps/api/src/mcp/mcp.service.ts`
- Create: `apps/api/src/mcp/mcp.controller.ts`
- Create: `apps/api/src/mcp/mcp.controller.spec.ts`
- Create: `apps/api/src/mcp/mcp.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- `POST /mcp` handles stateless MCP JSON-RPC.
- Authenticated `GET /mcp` and `DELETE /mcp` return protocol-safe `405`.
- Tool: `get_learning_context({ topic?: string })`.

- [ ] **Step 1: Write the tool and transport tests first**

Use the real SDK transport through the Nest controller with
`LearningContextService` mocked. Supertest coverage:

1. no bearer returns `401` + discovery challenge;
2. initialize succeeds with a valid access token;
3. `tools/list` returns only `get_learning_context` and read-only annotations;
4. `tools/call` returns the shared `LearningContext` as structured content and
   calls `learning.context` with the bearer user plus optional topic;
5. another user’s topic returns a safe tool error;
6. an unexpected service error returns a generic message without stack/SQL;
7. GET and DELETE return JSON-RPC `405`;
8. responses carry `Cache-Control: private, no-store`.

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand mcp.controller.spec.ts
```

Expected: FAIL because the MCP service/controller do not exist.

- [ ] **Step 3: Register exactly one tool**

Use SDK v1 subpath imports:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { learningContextSchema } from '@terrain/types';
import { z } from 'zod';
```

Register:

```ts
server.registerTool(
  'get_learning_context',
  {
    title: 'Get learning context',
    description:
      'Read Terrain’s current topic, roadmap selection, blockers, prerequisites, and learning evidence.',
    inputSchema: {
      topic: z.string().trim().min(1).max(300).optional(),
    },
    outputSchema: learningContextSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ topic }) => {
    try {
      const context = await this.learning.context(userId, { topic });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(context) }],
        structuredContent: context,
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        return {
          content: [{ type: 'text' as const, text: error.message }],
          isError: true,
        };
      }
      this.logger.error('get_learning_context failed', error);
      return {
        content: [{ type: 'text' as const, text: 'Unable to load learning context.' }],
        isError: true,
      };
    }
  },
);
```

The server factory closes over only the validated bearer `userId`.

- [ ] **Step 4: Handle each POST with a fresh stateless transport**

```ts
const server = this.createServer(userId);
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});
response.on('close', () => {
  void transport.close();
  void server.close();
});
await server.connect(transport);
await transport.handleRequest(request, response, request.body);
```

Catch transport errors. If headers are unsent, return only:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32603, "message": "Internal server error" },
  "id": null
}
```

Do not log request Authorization headers or JSON text results.

- [ ] **Step 5: Add the guarded controller and module**

Put `@Public()` on the MCP controller so the global cookie guard skips it, then
apply `@UseGuards(McpBearerGuard)` at controller level. POST passes the request,
response, and `request.userId` to `McpService`.

GET/DELETE return status 405 and:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32000, "message": "Method not allowed." },
  "id": null
}
```

`McpModule` imports `LearningModule`, provides all MCP/OAuth services, the
bearer guard, and one `MCP_CONFIG` provider whose factory returns
`loadMcpConfig()`. Services accept `McpConfig | null`; disabled routes return
`404` instead of crashing API startup. Declare both controllers and import the
module once in `AppModule`.

- [ ] **Step 6: Run all MCP/API tests and build**

```bash
yarn workspace @terrain/api test --runInBand \
  mcp.config.spec.ts oauth.service.spec.ts oauth.controller.spec.ts \
  mcp-bearer.guard.spec.ts mcp.controller.spec.ts
yarn workspace @terrain/api test --runInBand
yarn workspace @terrain/api build
```

Expected: focused and full API suites pass; build exits 0.

---

### Task 6: Proxy discovery, deploy, and verify real clients

**Files:**

- Modify: `apps/web/Caddyfile`
- Modify: `docs/ops/deploy.md`

**Interfaces:** Makes root discovery and `/api/mcp` reachable at production
URLs without exposing the API container.

- [ ] **Step 1: Add the two exact Caddy discovery handlers**

Place before `handle_path /api/*`:

```caddy
handle /.well-known/oauth-protected-resource {
	reverse_proxy api:3000
}

handle /.well-known/oauth-authorization-server {
	reverse_proxy api:3000
}
```

Keep `/api/mcp`, `/api/oauth/*`, and every existing API route under the current
`handle_path /api/*`; no new port or container is added.

- [ ] **Step 2: Document production setup**

Add to `docs/ops/deploy.md`:

1. generate `MCP_TOKEN_SECRET` with `openssl rand -hex 32`;
2. start creating the ChatGPT/Claude connector and copy the exact callback URL
   each client displays;
3. generate a different `openssl rand -hex 32` client secret for each;
4. set `MCP_PUBLIC_API_URL` to the public API URL ending in `/api`;
5. set `MCP_OAUTH_CLIENTS` to the one-line JSON array of client IDs, display
   names, secrets, and exact callback URLs;
6. add the same IDs/secrets in each client’s advanced OAuth settings;
7. rebuild/restart and apply the migration;
8. disconnect a client from Terrain Settings to revoke its refresh-token
   family.

State that ChatGPT needs an account/plan that permits custom MCP apps and that
the setup should advertise `offline_access` so its refresh connection remains
usable.

- [ ] **Step 3: Run repository verification**

```bash
yarn workspace @terrain/types test
yarn workspace @terrain/api test --runInBand
yarn workspace @terrain/web test
yarn build
yarn lint
yarn format:check
git diff --check
```

Expected: zero failures.

- [ ] **Step 4: Apply the non-destructive migration**

```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate deploy
```

Expected: `20260724000002_mcp_oauth` applies without reset or data loss.

- [ ] **Step 5: Smoke discovery and unauthenticated challenge**

Against the production-style URL:

```bash
curl -fsS https://terrain.example.com/.well-known/oauth-protected-resource
curl -fsS https://terrain.example.com/.well-known/oauth-authorization-server
curl -i -X POST https://terrain.example.com/api/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

Expected: both metadata documents match Task 3; MCP returns `401` with
`resource_metadata` and `learning:read`.

- [ ] **Step 6: Smoke Inspector, Claude, and ChatGPT**

For each client:

1. connect to `https://terrain.example.com/api/mcp`;
2. complete Terrain login and approve read-only access;
3. inspect tools and confirm only `get_learning_context`;
4. call it without a topic and with
   `Accounts, transactions & gas`;
5. confirm the result equals the REST `LearningContext` contract and reports
   the 5/13 blocker when that fixture is current;
6. disconnect it in Terrain Settings and confirm the old refresh token can no
   longer reconnect.

- [ ] **Step 7: Final diff and security audit**

```bash
git status --short
git diff --stat
git diff --check
rg -n 'MCP_TOKEN_SECRET=.+|\"secret\":\"[^$]' \
  apps docs --glob '!apps/api/.env.example'
```

Expected: only planned files changed, no real secrets appear, and no commit was
created.

## Protocol references

- [MCP stable TypeScript SDK v1 package](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP Streamable HTTP server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [ChatGPT developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta)
- [Claude remote custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
