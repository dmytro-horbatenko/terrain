import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { type McpConfig } from './mcp.config';
import { McpBearerGuard } from './mcp-bearer.guard';

const TOKEN_SECRET = 'mcp-token-secret-that-is-at-least-32-bytes';
const CHALLENGE =
  'Bearer resource_metadata="https://terrain.example.com/.well-known/oauth-protected-resource", scope="learning:read"';

const userFindUnique = jest.fn();
const grantFindUnique = jest.fn();
const prisma = {
  user: { findUnique: userFindUnique },
  mcpOAuthGrant: { findUnique: grantFindUnique },
} as unknown as PrismaService;
const jwt = new JwtService();

function mcpConfig(): McpConfig {
  return {
    publicApiUrl: 'https://terrain.example.com/api',
    issuer: 'https://terrain.example.com',
    resource: 'https://terrain.example.com/api/mcp',
    authorizationEndpoint: 'https://terrain.example.com/api/oauth/authorize',
    tokenEndpoint: 'https://terrain.example.com/api/oauth/token',
    protectedResourceMetadata: 'https://terrain.example.com/.well-known/oauth-protected-resource',
    authorizationServerMetadata:
      'https://terrain.example.com/.well-known/oauth-authorization-server',
    webBaseUrl: 'https://terrain.example.com',
    tokenSecret: TOKEN_SECRET,
    clients: new Map([
      [
        'chatgpt',
        {
          id: 'chatgpt',
          name: 'ChatGPT',
          secret: 'client-secret-that-is-at-least-32-bytes',
          redirectUris: ['https://chatgpt.com/oauth/callback'],
        },
      ],
    ]),
    allowedHosts: new Set(['terrain.example.com']),
    allowedOrigins: new Set(['https://terrain.example.com', 'https://chatgpt.com']),
  };
}

type HeaderValue = string | string[] | undefined;

function httpContext(
  input: {
    headers?: Record<string, HeaderValue>;
    rawHeaders?: string[];
    cookies?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, HeaderValue> = {
    host: 'terrain.example.com',
    ...input.headers,
  };
  const rawHeaders =
    input.rawHeaders ??
    Object.entries(headers).flatMap(([name, value]) =>
      typeof value === 'string' ? [name, value] : (value ?? []).flatMap((item) => [name, item]),
    );
  const request: {
    headers: Record<string, HeaderValue>;
    rawHeaders: string[];
    cookies?: Record<string, string>;
    userId?: string;
  } = { headers, rawHeaders, cookies: input.cookies };
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

describe('McpBearerGuard', () => {
  let config: McpConfig;
  let guard: McpBearerGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    config = mcpConfig();
    guard = new McpBearerGuard(prisma, jwt, config);
    userFindUnique.mockResolvedValue({ id: 'user-1' });
    grantFindUnique.mockResolvedValue({
      id: 'grant-1',
      revokedAt: null,
    });
  });

  async function token(
    claims: Record<string, unknown> = {},
    options: {
      secret?: string;
      issuer?: string;
      audience?: string;
      expiresIn?: number | '15m';
      omitExpiry?: boolean;
      algorithm?: 'HS256' | 'HS512';
    } = {},
  ): Promise<string> {
    const {
      secret = TOKEN_SECRET,
      issuer = config.issuer,
      audience = config.resource,
      expiresIn = '15m',
      omitExpiry,
      algorithm = 'HS256',
    } = options;
    return jwt.signAsync(
      {
        sub: 'user-1',
        client_id: 'chatgpt',
        grant_id: 'grant-1',
        scope: 'learning:read',
        token_use: 'mcp_access',
        ...claims,
      },
      {
        secret,
        issuer,
        audience,
        algorithm,
        ...(omitExpiry ? {} : { expiresIn }),
      },
    );
  }

  async function expectUnauthorized(requestContext: ReturnType<typeof httpContext>): Promise<void> {
    let thrown: unknown;
    try {
      await guard.canActivate(requestContext.context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).message).toBe('Unauthorized');
    expect(requestContext.response.setHeader).toHaveBeenCalledWith('WWW-Authenticate', CHALLENGE);
    expect(requestContext.request.userId).toBeUndefined();
  }

  it('returns 404 before transport or authentication checks when MCP is disabled', async () => {
    guard = new McpBearerGuard(prisma, jwt, null);
    const requestContext = httpContext({ headers: { host: 'wrong.example.com' } });

    await expect(guard.canActivate(requestContext.context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(requestContext.response.setHeader).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    'evil.example.com',
    'TERRAIN.EXAMPLE.COM',
    'terrain.example.com.',
    'terrain.example.com:443',
  ])('rejects non-exact Host %p before authentication', async (host) => {
    const requestContext = httpContext({ headers: { host } });

    await expect(guard.canActivate(requestContext.context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(requestContext.response.setHeader).not.toHaveBeenCalled();
  });

  it('rejects an array or repeated Host header', async () => {
    for (const requestContext of [
      httpContext({ headers: { host: ['terrain.example.com'] } }),
      httpContext({
        headers: { host: 'terrain.example.com' },
        rawHeaders: ['host', 'terrain.example.com', 'Host', 'terrain.example.com'],
      }),
    ]) {
      await expect(guard.canActivate(requestContext.context)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it.each([
    'https://evil.example.com',
    'https://terrain.example.com/',
    'HTTPS://terrain.example.com',
  ])('rejects non-exact present Origin %p before authentication', async (origin) => {
    const requestContext = httpContext({ headers: { origin } });

    await expect(guard.canActivate(requestContext.context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(requestContext.response.setHeader).not.toHaveBeenCalled();
  });

  it('rejects an array or repeated Origin header', async () => {
    for (const requestContext of [
      httpContext({ headers: { origin: ['https://terrain.example.com'] } }),
      httpContext({
        headers: { origin: 'https://terrain.example.com' },
        rawHeaders: [
          'host',
          'terrain.example.com',
          'origin',
          'https://terrain.example.com',
          'Origin',
          'https://terrain.example.com',
        ],
      }),
    ]) {
      await expect(guard.canActivate(requestContext.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('never authenticates from the browser cookie', async () => {
    const requestContext = httpContext({ cookies: { token: await token() } });

    await expectUnauthorized(requestContext);
  });

  it.each([
    undefined,
    '',
    'Basic abc',
    'Bearer',
    'Bearer abc def',
    'Bearer abc, Bearer def',
    ['Bearer abc'],
  ])('rejects malformed Authorization value %p', async (authorization) => {
    await expectUnauthorized(httpContext({ headers: { authorization } }));
  });

  it('rejects repeated Authorization headers', async () => {
    const accessToken = await token();
    await expectUnauthorized(
      httpContext({
        headers: { authorization: `Bearer ${accessToken}` },
        rawHeaders: [
          'host',
          'terrain.example.com',
          'authorization',
          `Bearer ${accessToken}`,
          'Authorization',
          `Bearer ${accessToken}`,
        ],
      }),
    );
  });

  it.each([
    ['invalid token', async () => 'not-a-jwt'],
    [
      'wrong signing secret',
      async () => token({}, { secret: 'different-mcp-secret-that-is-at-least-32-bytes' }),
    ],
    ['disallowed HS512 algorithm', async () => token({}, { algorithm: 'HS512' })],
    ['expired token', async () => token({}, { expiresIn: -1 })],
    ['missing expiry', async () => token({}, { omitExpiry: true })],
    ['wrong issuer', async () => token({}, { issuer: 'https://issuer.example.com' })],
    [
      'wrong audience',
      async () => token({}, { audience: 'https://terrain.example.com/api/other' }),
    ],
  ])('rejects a token with %s without leaking verification details', async (_name, makeToken) => {
    const requestContext = httpContext({
      headers: { authorization: `Bearer ${await makeToken()}` },
    });

    await expectUnauthorized(requestContext);
  });

  it.each([
    ['wrong token use', { token_use: 'browser_access' }],
    ['missing token use', { token_use: undefined }],
    ['missing learning scope', { scope: 'offline_access' }],
    ['array scope', { scope: ['learning:read'] }],
    ['empty subject', { sub: ' ' }],
    ['non-string subject', { sub: ['user-1'] }],
    ['empty client', { client_id: '' }],
    ['non-string client', { client_id: ['chatgpt'] }],
    ['empty grant generation', { grant_id: ' ' }],
    ['non-string grant generation', { grant_id: ['grant-1'] }],
  ])('rejects claims with %s', async (_name, claims) => {
    const requestContext = httpContext({
      headers: { authorization: `Bearer ${await token(claims)}` },
    });

    await expectUnauthorized(requestContext);
  });

  it('rejects a client removed from configuration', async () => {
    const accessToken = await token();
    config.clients.delete('chatgpt');

    await expectUnauthorized(httpContext({ headers: { authorization: `Bearer ${accessToken}` } }));
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a deleted or foreign user', async () => {
    userFindUnique.mockResolvedValue(null);
    const requestContext = httpContext({
      headers: { authorization: `Bearer ${await token({ sub: 'user-2' })}` },
    });

    await expectUnauthorized(requestContext);
    expect(grantFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['missing grant', null],
    ['revoked grant', { id: 'grant-1', revokedAt: new Date() }],
    ['superseded grant generation', { id: 'grant-2', revokedAt: null }],
  ])('rejects a %s', async (_name, grant) => {
    grantFindUnique.mockResolvedValue(grant);
    const requestContext = httpContext({
      headers: { authorization: `Bearer ${await token()}` },
    });

    await expectUnauthorized(requestContext);
  });

  it.each([undefined, 'https://terrain.example.com', 'https://chatgpt.com'])(
    'accepts exact allowed Origin %p and writes only the bearer subject',
    async (origin) => {
      const requestContext = httpContext({
        headers: {
          authorization: `bearer ${await token()}`,
          ...(origin ? { origin } : {}),
        },
        cookies: { token: 'browser-user-token' },
      });

      await expect(guard.canActivate(requestContext.context)).resolves.toBe(true);
      expect(requestContext.request.userId).toBe('user-1');
      expect(userFindUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { id: true },
      });
      expect(grantFindUnique).toHaveBeenCalledWith({
        where: {
          userId_clientId: {
            userId: 'user-1',
            clientId: 'chatgpt',
          },
        },
        select: { id: true, revokedAt: true },
      });
    },
  );
});
