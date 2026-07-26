import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import {
  OAuthService,
  type AuthorizationRequestInput,
  type ExchangeCodeInput,
} from './oauth.service';
import type { McpConfig } from './mcp.config';

const NOW = new Date('2026-07-24T12:00:00.000Z');
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const CLIENT_SECRET = 'c'.repeat(32);
const OTHER_CLIENT_SECRET = 'd'.repeat(32);

const config: McpConfig = {
  publicApiUrl: 'https://terrain.example.com/api',
  issuer: 'https://terrain.example.com',
  resource: 'https://terrain.example.com/api/mcp',
  authorizationEndpoint: 'https://terrain.example.com/api/oauth/authorize',
  tokenEndpoint: 'https://terrain.example.com/api/oauth/token',
  protectedResourceMetadata: 'https://terrain.example.com/.well-known/oauth-protected-resource',
  authorizationServerMetadata: 'https://terrain.example.com/.well-known/oauth-authorization-server',
  webBaseUrl: 'https://terrain.example.com',
  tokenSecret: 'm'.repeat(64),
  clients: new Map([
    [
      'claude',
      {
        id: 'claude',
        name: 'Claude',
        secret: CLIENT_SECRET,
        redirectUris: ['https://client.example/callback', 'https://client.example/other-callback'],
      },
    ],
    [
      'chatgpt',
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        secret: OTHER_CLIENT_SECRET,
        redirectUris: ['https://chatgpt.example/callback'],
      },
    ],
  ]),
  allowedHosts: new Set(['terrain.example.com']),
  allowedOrigins: new Set(['https://terrain.example.com']),
};

type CodeRow = {
  id: string;
  codeHash: string;
  grantId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

type RefreshRow = {
  id: string;
  tokenHash: string;
  familyId: string;
  grantId: string;
  userId: string;
  clientId: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

type GrantRow = {
  id: string;
  userId: string;
  clientId: string;
  scopes: string[];
  grantedAt: Date;
  revokedAt: Date | null;
};

function matchesDate(value: Date, condition: { gt?: Date } | undefined): boolean {
  return !condition?.gt || value > condition.gt;
}

function makePrisma() {
  const state = {
    codes: [] as CodeRow[],
    refreshTokens: [] as RefreshRow[],
    grants: [] as GrantRow[],
  };
  let sequence = 0;

  const mcpAuthorizationCode = {
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `code-${++sequence}`,
        createdAt: new Date(),
        usedAt: null,
        ...data,
      } as CodeRow;
      state.codes.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) =>
      state.codes.find((row) => row.codeHash === where.codeHash),
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = state.codes.filter(
        (row) =>
          (where.id === undefined || row.id === where.id) &&
          (where.grantId === undefined || row.grantId === where.grantId) &&
          (where.usedAt === undefined || row.usedAt === where.usedAt) &&
          matchesDate(row.expiresAt, where.expiresAt),
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  };

  const mcpRefreshToken = {
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `refresh-${++sequence}`,
        createdAt: new Date(),
        revokedAt: null,
        ...data,
      } as RefreshRow;
      state.refreshTokens.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) =>
      state.refreshTokens.find((row) => row.tokenHash === where.tokenHash),
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = state.refreshTokens.filter(
        (row) =>
          (where.id === undefined || row.id === where.id) &&
          (where.familyId === undefined || row.familyId === where.familyId) &&
          (where.grantId === undefined || row.grantId === where.grantId) &&
          (where.userId === undefined || row.userId === where.userId) &&
          (where.clientId === undefined || row.clientId === where.clientId) &&
          (where.resource === undefined || row.resource === where.resource) &&
          (where.revokedAt === undefined || row.revokedAt === where.revokedAt) &&
          matchesDate(row.expiresAt, where.expiresAt),
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  };

  const mcpOAuthGrant = {
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = where.userId_clientId;
      let row = state.grants.find(
        (grant) => grant.userId === key.userId && grant.clientId === key.clientId,
      );
      if (row) {
        Object.assign(row, update);
      } else {
        row = { id: `grant-${++sequence}`, revokedAt: null, ...create } as GrantRow;
        state.grants.push(row);
      }
      return row;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const key = where.userId_clientId;
      return state.grants.find(
        (grant) => grant.userId === key.userId && grant.clientId === key.clientId,
      );
    }),
    findMany: jest.fn(async ({ where }: any) =>
      state.grants.filter(
        (grant) =>
          (where.userId === undefined || grant.userId === where.userId) &&
          (where.revokedAt === undefined || grant.revokedAt === where.revokedAt),
      ),
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = state.grants.filter(
        (grant) =>
          (where.userId === undefined || grant.userId === where.userId) &&
          (where.clientId === undefined || grant.clientId === where.clientId) &&
          (where.id === undefined || grant.id === where.id) &&
          (where.revokedAt === undefined || grant.revokedAt === where.revokedAt),
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  };

  const tx = { mcpAuthorizationCode, mcpRefreshToken, mcpOAuthGrant };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(tx);
      } catch (error) {
        state.codes.splice(0, state.codes.length, ...snapshot.codes);
        state.refreshTokens.splice(0, state.refreshTokens.length, ...snapshot.refreshTokens);
        state.grants.splice(0, state.grants.length, ...snapshot.grants);
        throw error;
      }
    }),
  };
  return { prisma: prisma as any, state };
}

function jwtStub(): JwtService {
  return { signAsync: jest.fn().mockResolvedValue('access-jwt') } as any;
}

function authorizationRequest(
  override: Partial<AuthorizationRequestInput> = {},
): AuthorizationRequestInput {
  return {
    response_type: 'code',
    client_id: 'claude',
    redirect_uri: 'https://client.example/callback',
    scope: 'learning:read offline_access',
    state: 'opaque-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: config.resource,
    ...override,
  };
}

function exchangeInput(code: string, override: Partial<ExchangeCodeInput> = {}): ExchangeCodeInput {
  return {
    code,
    clientId: 'claude',
    clientSecret: CLIENT_SECRET,
    redirectUri: 'https://client.example/callback',
    codeVerifier: VERIFIER,
    resource: config.resource,
    ...override,
  };
}

function errorCode(error: unknown): unknown {
  return error instanceof BadRequestException
    ? (error.getResponse() as { error?: string }).error
    : undefined;
}

async function expectInvalidGrant(action: Promise<unknown>) {
  try {
    await action;
    throw new Error('Expected invalid_grant.');
  } catch (error) {
    expect(errorCode(error)).toBe('invalid_grant');
  }
}

async function issueCode(
  service: OAuthService,
  userId = 'user-1',
  request = authorizationRequest(),
) {
  const callback = new URL(await service.approve(userId, request));
  return callback.searchParams.get('code')!;
}

async function issueRefresh(
  service: OAuthService,
  userId = 'user-1',
  clientId: 'claude' | 'chatgpt' = 'claude',
) {
  const isClaude = clientId === 'claude';
  const request = authorizationRequest(
    isClaude
      ? {}
      : {
          client_id: 'chatgpt',
          redirect_uri: 'https://chatgpt.example/callback',
        },
  );
  const code = await issueCode(service, userId, request);
  return service.exchangeCode(
    exchangeInput(code, {
      clientId,
      clientSecret: isClaude ? CLIENT_SECRET : OTHER_CLIENT_SECRET,
      redirectUri: isClaude
        ? 'https://client.example/callback'
        : 'https://chatgpt.example/callback',
    }),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

it('rolls back fake transaction state when its callback throws', async () => {
  const { prisma, state } = makePrisma();
  state.grants.push({
    id: 'grant-before',
    userId: 'user-1',
    clientId: 'claude',
    scopes: ['learning:read'],
    grantedAt: NOW,
    revokedAt: null,
  });

  await expect(
    prisma.$transaction(async (tx: any) => {
      await tx.mcpOAuthGrant.updateMany({
        where: { id: 'grant-before' },
        data: { revokedAt: NOW },
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');

  expect(state.grants[0].revokedAt).toBeNull();
});

describe('authorization request validation', () => {
  it('accepts only the registered code/S256/resource request and normalizes allowed scopes', () => {
    const { prisma } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);

    const validated = service.validateAuthorizationRequest(
      authorizationRequest({ scope: 'offline_access learning:read' }),
    );

    expect(validated).toMatchObject({
      client: { id: 'claude', name: 'Claude' },
      scopes: ['learning:read', 'offline_access'],
      original: authorizationRequest({ scope: 'offline_access learning:read' }),
    });
    expect((validated.client as any).secret).toBeUndefined();
  });

  it.each([
    ['unknown client', { client_id: 'unknown' }],
    ['redirect mismatch', { redirect_uri: 'https://attacker.example/callback' }],
    ['wrong response type', { response_type: 'token' }],
    ['missing challenge', { code_challenge: '' }],
    ['plain PKCE', { code_challenge_method: 'plain' }],
    ['empty state', { state: '   ' }],
    ['missing read scope', { scope: 'offline_access' }],
    ['duplicate scope', { scope: 'learning:read learning:read' }],
    ['extra scope', { scope: 'learning:read learning:write' }],
    ['wrong resource', { resource: 'https://terrain.example.com/api/other' }],
  ])('rejects %s', (_name, override) => {
    const { prisma } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);

    expect(() => service.validateAuthorizationRequest(authorizationRequest(override))).toThrow(
      BadRequestException,
    );
  });
});

describe('authorization approval and denial', () => {
  it('persists only a five-minute code hash and returns the raw code with original state', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);

    const callback = new URL(await service.approve('user-1', authorizationRequest()));
    const rawCode = callback.searchParams.get('code')!;

    expect(callback.origin + callback.pathname).toBe('https://client.example/callback');
    expect(callback.searchParams.get('state')).toBe('opaque-state');
    expect(rawCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.codes).toHaveLength(1);
    expect(state.codes[0]).toMatchObject({
      codeHash: createHash('sha256').update(rawCode).digest('hex'),
      userId: 'user-1',
      clientId: 'claude',
      usedAt: null,
    });
    expect(state.grants[0].id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.codes[0].grantId).toBe(state.grants[0].id);
    expect(state.codes[0].expiresAt.getTime() - NOW.getTime()).toBe(5 * 60 * 1000);
    expect(JSON.stringify(state)).not.toContain(rawCode);
    expect(state.grants).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        clientId: 'claude',
        scopes: ['learning:read', 'offline_access'],
        revokedAt: null,
      }),
    ]);
  });

  it('rotates the grant generation on every approval and binds each code to its generation', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);

    await issueCode(service);
    const firstGrantId = state.grants[0].id;
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'second-state' }),
    );

    expect(state.grants).toHaveLength(1);
    expect(state.grants[0]).toMatchObject({
      userId: 'user-1',
      clientId: 'claude',
      scopes: ['learning:read'],
      revokedAt: null,
    });
    expect(state.grants[0].id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.grants[0].id).not.toBe(firstGrantId);
    expect(state.codes.map((code) => code.grantId)).toEqual([firstGrantId, state.grants[0].id]);
  });

  it('denies only to a trusted callback, preserves state, and writes nothing', () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);

    const callback = new URL(service.deny(authorizationRequest()));

    expect(callback.origin + callback.pathname).toBe('https://client.example/callback');
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('opaque-state');
    expect(state).toEqual({ codes: [], refreshTokens: [], grants: [] });
    expect(() =>
      service.deny(authorizationRequest({ redirect_uri: 'https://attacker.example/callback' })),
    ).toThrow(BadRequestException);
    expect(() =>
      service.deny(authorizationRequest({ resource: 'https://terrain.example.com/api/other' })),
    ).toThrow(BadRequestException);
  });
});

describe('authorization code exchange', () => {
  it('atomically redeems a code only once and rejects it after five minutes', async () => {
    const first = makePrisma();
    const service = new OAuthService(first.prisma, jwtStub(), config);
    const code = await issueCode(service);

    await service.exchangeCode(exchangeInput(code));
    await expectInvalidGrant(service.exchangeCode(exchangeInput(code)));
    expect(first.state.codes[0].usedAt).toEqual(NOW);
    expect(first.prisma.$transaction).toHaveBeenCalled();
    expect(first.prisma.mcpAuthorizationCode.updateMany).toHaveBeenCalledWith({
      where: {
        id: first.state.codes[0].id,
        grantId: first.state.codes[0].grantId,
        usedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW },
    });

    const expired = makePrisma();
    const expiredService = new OAuthService(expired.prisma, jwtStub(), config);
    const expiredCode = await issueCode(expiredService);
    jest.setSystemTime(new Date(NOW.getTime() + 5 * 60 * 1000 + 1));
    await expectInvalidGrant(expiredService.exchangeCode(exchangeInput(expiredCode)));
    expect(expired.state.codes[0].usedAt).toBeNull();
  });

  it('does not consume the code for a wrong verifier, redirect, secret, or resource', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const code = await issueCode(service);

    const invalidInputs = [
      exchangeInput(code, { codeVerifier: `${VERIFIER.slice(0, -1)}A` }),
      exchangeInput(code, { redirectUri: 'https://client.example/other-callback' }),
      exchangeInput(code, { clientSecret: 'x'.repeat(32) }),
      exchangeInput(code, {
        clientId: 'chatgpt',
        clientSecret: OTHER_CLIENT_SECRET,
        redirectUri: 'https://chatgpt.example/callback',
      }),
      exchangeInput(code, { resource: 'https://terrain.example.com/api/other' }),
    ];
    for (const input of invalidInputs) {
      await expect(service.exchangeCode(input)).rejects.toBeInstanceOf(BadRequestException);
      expect(state.codes[0].usedAt).toBeNull();
    }

    await expect(service.exchangeCode(exchangeInput(code))).resolves.toMatchObject({
      token_type: 'Bearer',
    });
  });

  it('returns invalid_grant without side effects when the atomic code claim loses a race', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const code = await issueCode(service);
    prisma.mcpAuthorizationCode.updateMany.mockResolvedValueOnce({ count: 0 });

    await expectInvalidGrant(service.exchangeCode(exchangeInput(code)));

    expect(state.codes[0].usedAt).toBeNull();
    expect(state.refreshTokens).toHaveLength(0);
    expect(state.grants[0].revokedAt).toBeNull();
  });

  it('rejects a code whose scopes differ from its current grant generation', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const code = await issueCode(service);
    state.codes[0].scopes = ['learning:read'];

    await expectInvalidGrant(service.exchangeCode(exchangeInput(code)));
    expect(state.codes[0].usedAt).toBeNull();
  });

  it('invalidates an offline code when reapproval downgrades the grant scopes', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const offlineCode = await issueCode(service);
    const oldGrantId = state.codes[0].grantId;
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'downgraded' }),
    );

    await expectInvalidGrant(service.exchangeCode(exchangeInput(offlineCode)));
    expect(state.grants[0]).toMatchObject({
      scopes: ['learning:read'],
      revokedAt: null,
    });
    expect(state.grants[0].id).not.toBe(oldGrantId);
  });

  it('does not redeem a code after its user/client grant is revoked', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const code = await issueCode(service);
    await service.revokeGrant('user-1', 'claude');

    await expectInvalidGrant(service.exchangeCode(exchangeInput(code)));
    expect(state.codes[0].usedAt).toBeNull();
  });

  it('signs an exact 15-minute issuer/audience-bound MCP access JWT', async () => {
    jest.useRealTimers();
    const { prisma, state } = makePrisma();
    const jwt = new JwtService();
    const service = new OAuthService(prisma, jwt, config);
    const code = await issueCode(service);

    const response = await service.exchangeCode(exchangeInput(code));
    const claims = await jwt.verifyAsync(response.access_token, {
      secret: config.tokenSecret,
      issuer: config.issuer,
      audience: config.resource,
    });

    expect(claims).toMatchObject({
      sub: 'user-1',
      iss: config.issuer,
      aud: config.resource,
      client_id: 'claude',
      grant_id: state.grants[0].id,
      scope: 'learning:read offline_access',
      token_use: 'mcp_access',
    });
    expect(claims.exp - claims.iat).toBe(900);
    expect(response).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'learning:read offline_access',
    });
  });

  it('keeps a disconnected access token bound to its old grant after reapproval', async () => {
    jest.useRealTimers();
    const { prisma, state } = makePrisma();
    const jwt = new JwtService();
    const service = new OAuthService(prisma, jwt, config);
    const oldAccess = await issueRefresh(service);
    const oldClaims = await jwt.verifyAsync(oldAccess.access_token, {
      secret: config.tokenSecret,
      issuer: config.issuer,
      audience: config.resource,
    });

    await service.revokeGrant('user-1', 'claude');
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'reapproved' }),
    );

    expect(oldClaims.grant_id).toEqual(expect.any(String));
    expect(oldClaims.grant_id).not.toBe(state.grants[0].id);
    expect(state.grants[0]).toMatchObject({ scopes: ['learning:read'], revokedAt: null });
  });

  it('issues a refresh token only for offline_access and stores only its hash', async () => {
    const online = makePrisma();
    const onlineService = new OAuthService(online.prisma, jwtStub(), config);
    const onlineCode = await issueCode(
      onlineService,
      'user-1',
      authorizationRequest({ scope: 'learning:read' }),
    );
    const onlineResponse = await onlineService.exchangeCode(exchangeInput(onlineCode));
    expect(onlineResponse.refresh_token).toBeUndefined();
    expect(online.state.refreshTokens).toHaveLength(0);

    const offline = makePrisma();
    const offlineService = new OAuthService(offline.prisma, jwtStub(), config);
    const offlineResponse = await issueRefresh(offlineService);
    const rawRefresh = offlineResponse.refresh_token!;

    expect(rawRefresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(offline.state.refreshTokens).toEqual([
      expect.objectContaining({
        tokenHash: createHash('sha256').update(rawRefresh).digest('hex'),
        grantId: offline.state.grants[0].id,
        userId: 'user-1',
        clientId: 'claude',
        revokedAt: null,
      }),
    ]);
    expect(offline.state.refreshTokens[0].expiresAt.getTime() - NOW.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(JSON.stringify(offline.state)).not.toContain(rawRefresh);
  });
});

describe('refresh rotation and grants', () => {
  it('does not mutate grants while MCP is disabled', async () => {
    const { prisma } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), null);

    await expect(service.revokeGrant('user-1', 'claude')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rotates a refresh token inside one transaction and keeps its family', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const issued = await issueRefresh(service);
    const oldRaw = issued.refresh_token!;
    const oldRow = state.refreshTokens[0];
    prisma.$transaction.mockClear();

    const rotated = await service.refresh({
      refreshToken: oldRaw,
      clientId: 'claude',
      clientSecret: CLIENT_SECRET,
      resource: config.resource,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(oldRow.revokedAt).toEqual(NOW);
    expect(rotated.refresh_token).not.toBe(oldRaw);
    expect(state.refreshTokens).toHaveLength(2);
    expect(state.refreshTokens[1]).toMatchObject({
      familyId: oldRow.familyId,
      grantId: oldRow.grantId,
      tokenHash: createHash('sha256').update(rotated.refresh_token!).digest('hex'),
      revokedAt: null,
    });
    expect(JSON.stringify(state)).not.toContain(rotated.refresh_token!);
    expect(prisma.mcpRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: oldRow.id,
        grantId: oldRow.grantId,
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { revokedAt: NOW },
    });
  });

  it('commits scoped replay revocation when the atomic refresh claim loses a race', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const issued = await issueRefresh(service);
    const row = state.refreshTokens[0];
    prisma.mcpRefreshToken.updateMany.mockResolvedValueOnce({ count: 0 });

    await expectInvalidGrant(
      service.refresh({
        refreshToken: issued.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    expect(state.refreshTokens[0].revokedAt).toEqual(NOW);
    expect(state.grants[0].revokedAt).toEqual(NOW);
    expect(prisma.mcpRefreshToken.updateMany).toHaveBeenLastCalledWith({
      where: {
        familyId: row.familyId,
        grantId: row.grantId,
        userId: row.userId,
        clientId: row.clientId,
        resource: row.resource,
        revokedAt: null,
      },
      data: { revokedAt: NOW },
    });
  });

  it('rejects a refresh token whose scopes differ from its current grant generation', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const issued = await issueRefresh(service);
    state.refreshTokens[0].scopes = ['learning:read'];

    await expectInvalidGrant(
      service.refresh({
        refreshToken: issued.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );
    expect(state.refreshTokens).toHaveLength(1);
  });

  it('invalidates an offline refresh token when reapproval downgrades the grant scopes', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const issued = await issueRefresh(service);
    const oldGrantId = state.refreshTokens[0].grantId;
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'downgraded' }),
    );

    await expectInvalidGrant(
      service.refresh({
        refreshToken: issued.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );
    expect(state.grants[0]).toMatchObject({
      scopes: ['learning:read'],
      revokedAt: null,
    });
    expect(state.grants[0].id).not.toBe(oldGrantId);
  });

  it('revokes the entire family and grant when a rotated token is replayed', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const issued = await issueRefresh(service);
    const oldRaw = issued.refresh_token!;
    const rotated = await service.refresh({
      refreshToken: oldRaw,
      clientId: 'claude',
      clientSecret: CLIENT_SECRET,
      resource: config.resource,
    });

    await expectInvalidGrant(
      service.refresh({
        refreshToken: oldRaw,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    const familyId = state.refreshTokens[0].familyId;
    expect(state.refreshTokens.filter((token) => token.familyId === familyId).every(Boolean)).toBe(
      true,
    );
    expect(
      state.refreshTokens
        .filter((token) => token.familyId === familyId)
        .every((token) => token.revokedAt !== null),
    ).toBe(true);
    expect(state.grants[0].revokedAt).toEqual(NOW);
    await expectInvalidGrant(
      service.refresh({
        refreshToken: rotated.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );
  });

  it('does not let an old revoked refresh replay revoke a newer grant generation', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const old = await issueRefresh(service);
    const oldGrantId = state.refreshTokens[0].grantId;
    await service.revokeGrant('user-1', 'claude');
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'reconnected' }),
    );
    const newGrantId = state.grants[0].id;

    await expectInvalidGrant(
      service.refresh({
        refreshToken: old.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    expect(newGrantId).not.toBe(oldGrantId);
    expect(state.grants[0]).toMatchObject({ id: newGrantId, revokedAt: null });
  });

  it('isolates replay revocation to the exact family generation and artifact bindings', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const old = await issueRefresh(service);
    const source = state.refreshTokens[0];
    await service.refresh({
      refreshToken: old.refresh_token!,
      clientId: 'claude',
      clientSecret: CLIENT_SECRET,
      resource: config.resource,
    });
    const decoys = [
      { ...source, id: 'decoy-grant', tokenHash: 'decoy-grant', grantId: 'other-grant' },
      { ...source, id: 'decoy-user', tokenHash: 'decoy-user', userId: 'user-2' },
      { ...source, id: 'decoy-client', tokenHash: 'decoy-client', clientId: 'chatgpt' },
      {
        ...source,
        id: 'decoy-resource',
        tokenHash: 'decoy-resource',
        resource: 'https://terrain.example.com/api/other',
      },
    ].map((row) => ({ ...row, revokedAt: null }));
    state.refreshTokens.push(...decoys);
    prisma.mcpRefreshToken.updateMany.mockClear();
    prisma.mcpOAuthGrant.updateMany.mockClear();

    await expectInvalidGrant(
      service.refresh({
        refreshToken: old.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    expect(decoys.every((row) => row.revokedAt === null)).toBe(true);
    expect(prisma.mcpRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        familyId: source.familyId,
        grantId: source.grantId,
        userId: source.userId,
        clientId: source.clientId,
        resource: source.resource,
        revokedAt: null,
      },
      data: { revokedAt: NOW },
    });
    expect(prisma.mcpOAuthGrant.updateMany).toHaveBeenCalledWith({
      where: {
        id: source.grantId,
        userId: source.userId,
        clientId: source.clientId,
        revokedAt: null,
      },
      data: { revokedAt: NOW },
    });
  });

  it('does not let an old expired refresh replay revoke a newer grant generation', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const old = await issueRefresh(service);
    const oldGrantId = state.refreshTokens[0].grantId;
    jest.setSystemTime(new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000));
    await issueCode(
      service,
      'user-1',
      authorizationRequest({ scope: 'learning:read', state: 'reconnected' }),
    );
    const newGrantId = state.grants[0].id;

    await expectInvalidGrant(
      service.refresh({
        refreshToken: old.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    expect(newGrantId).not.toBe(oldGrantId);
    expect(state.grants[0]).toMatchObject({ id: newGrantId, revokedAt: null });
  });

  it('lists safe grant fields and revokes only the current user/client pair', async () => {
    const { prisma, state } = makePrisma();
    const service = new OAuthService(prisma, jwtStub(), config);
    const userOneClaude = await issueRefresh(service, 'user-1', 'claude');
    await issueRefresh(service, 'user-1', 'chatgpt');
    await issueRefresh(service, 'user-2', 'claude');

    await service.revokeGrant('user-1', 'claude');

    expect(
      state.grants.find((row) => row.userId === 'user-1' && row.clientId === 'claude')?.revokedAt,
    ).toEqual(NOW);
    expect(
      state.grants.find((row) => row.userId === 'user-1' && row.clientId === 'chatgpt')?.revokedAt,
    ).toBeNull();
    expect(
      state.grants.find((row) => row.userId === 'user-2' && row.clientId === 'claude')?.revokedAt,
    ).toBeNull();
    expect(
      state.refreshTokens.find((row) => row.userId === 'user-1' && row.clientId === 'claude')
        ?.revokedAt,
    ).toEqual(NOW);
    expect(
      state.refreshTokens.find((row) => row.userId === 'user-2' && row.clientId === 'claude')
        ?.revokedAt,
    ).toBeNull();
    await expectInvalidGrant(
      service.refresh({
        refreshToken: userOneClaude.refresh_token!,
        clientId: 'claude',
        clientSecret: CLIENT_SECRET,
        resource: config.resource,
      }),
    );

    expect(await service.listGrants('user-1')).toEqual([
      {
        clientId: 'chatgpt',
        clientName: 'ChatGPT',
        scopes: ['learning:read', 'offline_access'],
        connectedAt: NOW.toISOString(),
      },
    ]);
    expect(JSON.stringify(await service.listGrants('user-1'))).not.toMatch(
      /token|hash|secret|grant-/i,
    );
  });
});
