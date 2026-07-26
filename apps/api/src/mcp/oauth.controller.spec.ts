import { BadRequestException, Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IS_PUBLIC } from '../auth/public.decorator';
import { McpConfig } from './mcp.config';
import { OAuthController, OAuthTokenBoundaryFilter } from './oauth.controller';
import { AuthorizationRequestInput, MCP_CONFIG, OAuthService } from './oauth.service';

const CLIENT_SECRET = 'c'.repeat(32);
const authorizationRequest: AuthorizationRequestInput = {
  response_type: 'code',
  client_id: 'claude',
  redirect_uri: 'https://client.example/callback',
  scope: 'learning:read offline_access',
  state: 'opaque-state',
  code_challenge: 'challenge'.padEnd(43, 'x'),
  code_challenge_method: 'S256',
  resource: 'https://terrain.example.com/api/mcp',
};
const config: McpConfig = {
  publicApiUrl: 'https://terrain.example.com/api',
  issuer: 'https://terrain.example.com',
  resource: authorizationRequest.resource,
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
        redirectUris: [authorizationRequest.redirect_uri],
      },
    ],
  ]),
  allowedHosts: new Set(['terrain.example.com']),
  allowedOrigins: new Set(['https://terrain.example.com']),
};

@Controller('test-errors')
class TestErrorController {
  @Get()
  fail() {
    throw new BadRequestException('Normal non-token error.');
  }
}

describe('OAuthController', () => {
  let app: INestApplication;
  let oauth: {
    validateAuthorizationRequest: jest.Mock;
    approve: jest.Mock;
    deny: jest.Mock;
    exchangeCode: jest.Mock;
    refresh: jest.Mock;
    listGrants: jest.Mock;
    revokeGrant: jest.Mock;
  };

  async function createApp(mcpConfig: McpConfig | null) {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
      controllers: [OAuthController, TestErrorController],
      providers: [
        { provide: OAuthService, useValue: oauth },
        { provide: MCP_CONFIG, useValue: mcpConfig },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }) },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    const instance = module.createNestApplication();
    instance.useGlobalFilters(new OAuthTokenBoundaryFilter(instance.getHttpAdapter()));
    instance.use(cookieParser());
    await instance.init();
    return instance;
  }

  beforeEach(async () => {
    oauth = {
      validateAuthorizationRequest: jest.fn().mockReturnValue({
        client: { id: 'claude', name: 'Claude' },
        scopes: ['learning:read', 'offline_access'],
        original: authorizationRequest,
      }),
      approve: jest.fn().mockResolvedValue('https://client.example/callback?code=code&state=x'),
      deny: jest
        .fn()
        .mockReturnValue('https://client.example/callback?error=access_denied&state=x'),
      exchangeCode: jest.fn().mockResolvedValue({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 900,
        scope: 'learning:read offline_access',
        refresh_token: 'refresh-token',
      }),
      refresh: jest.fn().mockResolvedValue({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 900,
        scope: 'learning:read offline_access',
        refresh_token: 'new-refresh-token',
      }),
      listGrants: jest.fn().mockResolvedValue([
        {
          clientId: 'claude',
          clientName: 'Claude',
          scopes: ['learning:read', 'offline_access'],
          connectedAt: '2026-07-24T10:00:00.000Z',
        },
      ]),
      revokeGrant: jest.fn().mockResolvedValue(undefined),
    };
    app = await createApp(config);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the exact protected-resource metadata publicly', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource')
      .expect(200);

    expect(response.body).toEqual({
      resource: 'https://terrain.example.com/api/mcp',
      authorization_servers: ['https://terrain.example.com'],
      scopes_supported: ['learning:read', 'offline_access'],
      bearer_methods_supported: ['header'],
    });
  });

  it('returns the exact authorization-server metadata publicly', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/oauth-authorization-server')
      .expect(200);

    expect(response.body).toEqual({
      issuer: 'https://terrain.example.com',
      authorization_endpoint: 'https://terrain.example.com/api/oauth/authorize',
      token_endpoint: 'https://terrain.example.com/api/oauth/token',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['learning:read', 'offline_access'],
    });
  });

  it('validates GET authorize and redirects to the web approval route', async () => {
    const response = await request(app.getHttpServer())
      .get('/oauth/authorize')
      .query(authorizationRequest)
      .expect(302);

    expect(oauth.validateAuthorizationRequest).toHaveBeenCalledWith(authorizationRequest);
    const approval = new URL(response.headers.location);
    expect(approval.origin + approval.pathname).toBe('https://terrain.example.com/oauth/authorize');
    expect(Object.fromEntries(approval.searchParams)).toEqual(authorizationRequest);
  });

  it('requires the browser cookie for approve and deny', async () => {
    await request(app.getHttpServer())
      .post('/oauth/authorize')
      .send({ ...authorizationRequest, approved: true })
      .expect(401);

    expect(oauth.approve).not.toHaveBeenCalled();
    expect(oauth.deny).not.toHaveBeenCalled();
  });

  it.each([
    [true, 'approve', 'https://client.example/callback?code=code&state=x'],
    [false, 'deny', 'https://client.example/callback?error=access_denied&state=x'],
  ] as const)('revalidates and handles approved=%s server-side', async (approved, action, url) => {
    const response = await request(app.getHttpServer())
      .post('/oauth/authorize')
      .set('Cookie', 'token=valid')
      .send({ ...authorizationRequest, approved })
      .expect(200);

    expect(oauth.validateAuthorizationRequest).toHaveBeenCalledWith(authorizationRequest);
    if (action === 'approve') {
      expect(oauth.approve).toHaveBeenCalledWith('user-1', authorizationRequest);
    } else {
      expect(oauth.deny).toHaveBeenCalledWith(authorizationRequest);
    }
    expect(response.body).toEqual({ redirectUrl: url });
  });

  it('exchanges a form-encoded code with HTTP Basic client authentication', async () => {
    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`claude:${CLIENT_SECRET}`).toString('base64')}`)
      .send({
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: authorizationRequest.redirect_uri,
        code_verifier: 'verifier',
        resource: authorizationRequest.resource,
      })
      .expect(200);

    expect(oauth.exchangeCode).toHaveBeenCalledWith({
      code: 'code',
      clientId: 'claude',
      clientSecret: CLIENT_SECRET,
      redirectUri: authorizationRequest.redirect_uri,
      codeVerifier: 'verifier',
      resource: authorizationRequest.resource,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body.access_token).toBe('access-token');
  });

  it('refreshes with form-encoded body client authentication', async () => {
    await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        resource: authorizationRequest.resource,
        client_id: 'claude',
        client_secret: CLIENT_SECRET,
      })
      .expect(200);

    expect(oauth.refresh).toHaveBeenCalledWith({
      refreshToken: 'refresh-token',
      clientId: 'claude',
      clientSecret: CLIENT_SECRET,
      resource: authorizationRequest.resource,
    });
  });

  it('rejects conflicting Basic and body credentials without calling the service', async () => {
    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .set('Authorization', `Basic ${Buffer.from(`claude:${CLIENT_SECRET}`).toString('base64')}`)
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        resource: authorizationRequest.resource,
        client_id: 'claude',
        client_secret: CLIENT_SECRET,
      })
      .expect(400);

    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description: 'Use exactly one client authentication method.',
    });
    expect(response.headers['www-authenticate']).toBeUndefined();
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it('returns a challenged safe 401 for malformed Basic authentication', async () => {
    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .set('Authorization', 'Basic !!!not-base64!!!')
      .send({
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: authorizationRequest.redirect_uri,
        code_verifier: 'verifier',
        resource: authorizationRequest.resource,
      })
      .expect(401);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['www-authenticate']).toBe('Basic realm="Terrain OAuth token"');
    expect(response.body).toEqual({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|exception|message/i);
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown client', 'unknown', CLIENT_SECRET],
    ['wrong secret', 'claude', 'x'.repeat(32)],
  ])('returns the same challenged safe 401 for Basic %s', async (_name, clientId, clientSecret) => {
    oauth.exchangeCode.mockRejectedValueOnce(
      new BadRequestException({
        error: 'invalid_client',
        error_description: 'Client authentication failed.',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .set(
        'Authorization',
        `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      )
      .send({
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: authorizationRequest.redirect_uri,
        code_verifier: 'verifier',
        resource: authorizationRequest.resource,
      })
      .expect(401);

    expect(response.headers['www-authenticate']).toBe('Basic realm="Terrain OAuth token"');
    expect(response.body).toEqual({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
    expect(JSON.stringify(response.body)).not.toContain(clientId);
    expect(JSON.stringify(response.body)).not.toContain(clientSecret);
  });

  it('keeps body client authentication failures at safe unchallenged HTTP 400', async () => {
    oauth.exchangeCode.mockRejectedValueOnce(
      new BadRequestException({
        error: 'invalid_client',
        error_description: 'Client authentication failed.',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: authorizationRequest.redirect_uri,
        code_verifier: 'verifier',
        resource: authorizationRequest.resource,
        client_id: 'unknown',
        client_secret: CLIENT_SECRET,
      })
      .expect(400);

    expect(response.headers['www-authenticate']).toBeUndefined();
    expect(response.body).toEqual({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
  });

  it('normalizes the actual throttler rejection on the 11th token request', async () => {
    const send = () =>
      request(app.getHttpServer()).post('/oauth/token').type('form').send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        resource: authorizationRequest.resource,
        client_id: 'claude',
        client_secret: CLIENT_SECRET,
      });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await send().expect(200);
    }
    const response = await send().expect(429);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({
      error: 'temporarily_unavailable',
      error_description: 'Too many token requests. Try again later.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/throttler|exception|stack|message/i);
  });

  it('rejects an absent token body with a safe OAuth error', async () => {
    const response = await request(app.getHttpServer()).post('/oauth/token').expect(400);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({
      error: 'unsupported_grant_type',
      error_description: 'Grant type is not supported.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|typeerror/i);
  });

  it('normalizes malformed JSON before the token handler runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .set('Content-Type', 'application/json')
      .send('{"grant_type":')
      .expect(400);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description: 'Malformed token request.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/parser|syntax|nest|class|message|stack/i);
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it.each(['/oauth/token/', '/OAUTH/TOKEN'])(
    'normalizes malformed JSON on the Express token alias %s',
    async (path) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .set('Content-Type', 'application/json')
        .send('{"grant_type":')
        .expect(400);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Malformed token request.',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/parser|syntax|nest|class|message|stack/i);
    },
  );

  it('leaves the tokenization sibling path on Nest default handling', async () => {
    const response = await request(app.getHttpServer())
      .post('/oauth/tokenization')
      .set('Content-Type', 'application/json')
      .send('{"grant_type":')
      .expect(400);

    expect(response.headers['cache-control']).toBeUndefined();
    expect(response.headers.pragma).toBeUndefined();
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: expect.any(String),
    });
    expect(response.body.error_description).toBeUndefined();
  });

  it('returns a cache-safe stable 404 while the token endpoint is disabled', async () => {
    const disabledApp = await createApp(null);
    try {
      const response = await request(disabledApp.getHttpServer())
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: 'refresh-token',
          resource: authorizationRequest.resource,
          client_id: 'claude',
          client_secret: CLIENT_SECRET,
        })
        .expect(404);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(response.body).toEqual({
        error: 'temporarily_unavailable',
        error_description: 'Token endpoint is unavailable.',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/config|nest|class|message|stack/i);
    } finally {
      await disabledApp.close();
    }
  });

  it('normalizes unexpected token failures without leaking details', async () => {
    oauth.refresh.mockRejectedValueOnce(new Error('database password leaked'));

    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        resource: authorizationRequest.resource,
        client_id: 'claude',
        client_secret: CLIENT_SECRET,
      })
      .expect(500);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({
      error: 'server_error',
      error_description: 'Token request could not be processed.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /database|password|nest|class|message|stack/i,
    );
  });

  it('leaves non-token exceptions on Nest default handling', async () => {
    const response = await request(app.getHttpServer())
      .get('/test-errors')
      .set('Cookie', 'token=valid')
      .expect(400);

    expect(response.headers['cache-control']).toBeUndefined();
    expect(response.body).toEqual({
      message: 'Normal non-token error.',
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('returns cache-safe OAuth errors without implementation details', async () => {
    oauth.exchangeCode.mockRejectedValueOnce(
      new BadRequestException({
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired.',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: 'bad-code',
        redirect_uri: authorizationRequest.redirect_uri,
        code_verifier: 'bad-verifier',
        resource: authorizationRequest.resource,
        client_id: 'claude',
        client_secret: CLIENT_SECRET,
      })
      .expect(400);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Authorization code is invalid or expired.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|prisma|sql/i);
  });

  it('lists only safe active-grant fields for the current user', async () => {
    const response = await request(app.getHttpServer())
      .get('/oauth/grants')
      .set('Cookie', 'token=valid')
      .expect(200);

    expect(oauth.listGrants).toHaveBeenCalledWith('user-1');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual([
      {
        clientId: 'claude',
        clientName: 'Claude',
        scopes: ['learning:read', 'offline_access'],
        connectedAt: '2026-07-24T10:00:00.000Z',
      },
    ]);
    expect(Object.keys(response.body[0]).sort()).toEqual([
      'clientId',
      'clientName',
      'connectedAt',
      'scopes',
    ]);
  });

  it('revokes only the current user and requested client', async () => {
    await request(app.getHttpServer())
      .delete('/oauth/grants/claude')
      .set('Cookie', 'token=valid')
      .expect(204);

    expect(oauth.revokeGrant).toHaveBeenCalledWith('user-1', 'claude');
  });

  it('marks only discovery, GET authorize, and token as public and throttles token to 10/min', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.protectedResource)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.authorizationServer)).toBe(
      true,
    );
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.authorize)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.approve)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.grants)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.revoke)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.token)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', OAuthController.prototype.token)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', OAuthController.prototype.token)).toBe(
      60_000,
    );
  });
});
