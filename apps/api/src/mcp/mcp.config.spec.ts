import { loadMcpConfig, normalizeMcpScopes } from './mcp.config';

const CLIENT_SECRET = 'c'.repeat(32);
const TOKEN_SECRET = 'm'.repeat(64);
const CLIENT = {
  id: 'claude',
  name: 'Claude',
  secret: CLIENT_SECRET,
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
};
const VALID_ENV = {
  MCP_PUBLIC_API_URL: 'https://terrain.example.com/api',
  MCP_TOKEN_SECRET: TOKEN_SECRET,
  MCP_OAUTH_CLIENTS: JSON.stringify([CLIENT]),
  WEB_BASE_URL: 'https://terrain.example.com',
};

function configError(env: NodeJS.ProcessEnv): string | undefined {
  try {
    loadMcpConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('loadMcpConfig', () => {
  it('is disabled when MCP_PUBLIC_API_URL is absent', () => {
    expect(loadMcpConfig({ MCP_TOKEN_SECRET: TOKEN_SECRET })).toBeNull();
  });

  it('is disabled when MCP_PUBLIC_API_URL is blank', () => {
    expect(loadMcpConfig({ MCP_PUBLIC_API_URL: '   ' })).toBeNull();
  });

  it('derives and normalizes the production URLs', () => {
    const config = loadMcpConfig({
      ...VALID_ENV,
      MCP_PUBLIC_API_URL: 'https://terrain.example.com/api/',
    })!;

    expect(config).toMatchObject({
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
    });
    expect(config.clients.get('claude')).toEqual(CLIENT);
    expect(config.allowedHosts).toEqual(new Set(['terrain.example.com']));
    expect(config.allowedOrigins).toEqual(new Set(['https://terrain.example.com']));
  });

  it('accepts HTTP only for localhost and 127.0.0.1 URLs', () => {
    const config = loadMcpConfig({
      MCP_PUBLIC_API_URL: 'http://localhost:3000/',
      MCP_TOKEN_SECRET: TOKEN_SECRET,
      MCP_OAUTH_CLIENTS: JSON.stringify([
        {
          ...CLIENT,
          redirectUris: ['http://127.0.0.1:7777/callback'],
        },
      ]),
      MCP_ALLOWED_ORIGINS: 'http://127.0.0.1:5180',
      WEB_BASE_URL: 'http://localhost:5180/',
    })!;

    expect(config.publicApiUrl).toBe('http://localhost:3000');
    expect(config.resource).toBe('http://localhost:3000/mcp');
    expect(config.allowedHosts).toEqual(new Set(['localhost:3000']));
    expect(config.allowedOrigins).toEqual(
      new Set(['http://localhost:3000', 'http://127.0.0.1:5180']),
    );
  });

  it('accepts and normalizes the local /api path', () => {
    const config = loadMcpConfig({
      ...VALID_ENV,
      MCP_PUBLIC_API_URL: 'http://127.0.0.1:3000/api/',
      WEB_BASE_URL: 'http://localhost:5180',
    })!;

    expect(config).toMatchObject({
      publicApiUrl: 'http://127.0.0.1:3000/api',
      issuer: 'http://127.0.0.1:3000',
      resource: 'http://127.0.0.1:3000/api/mcp',
      authorizationEndpoint: 'http://127.0.0.1:3000/api/oauth/authorize',
      tokenEndpoint: 'http://127.0.0.1:3000/api/oauth/token',
    });
  });

  it('preserves a canonical exact registered callback path', () => {
    const redirectUri = 'https://client.example.com/OAuth/Callback/v2/';
    const config = loadMcpConfig({
      ...VALID_ENV,
      MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, redirectUris: [redirectUri] }]),
    })!;

    expect(config.clients.get(CLIENT.id)?.redirectUris).toEqual([redirectUri]);
  });

  it('adds only explicitly configured origins to the resource origin', () => {
    const config = loadMcpConfig({
      ...VALID_ENV,
      MCP_ALLOWED_ORIGINS: 'https://chatgpt.com, https://claude.ai',
    })!;

    expect(config.allowedOrigins).toEqual(
      new Set(['https://terrain.example.com', 'https://chatgpt.com', 'https://claude.ai']),
    );
  });

  it.each([
    ['missing token secret', { MCP_TOKEN_SECRET: undefined }],
    ['short token secret', { MCP_TOKEN_SECRET: 'short' }],
    ['missing clients', { MCP_OAUTH_CLIENTS: undefined }],
    ['missing web base URL', { WEB_BASE_URL: undefined }],
    ['malformed clients JSON', { MCP_OAUTH_CLIENTS: '{' }],
    ['non-array clients', { MCP_OAUTH_CLIENTS: '{}' }],
    ['empty clients', { MCP_OAUTH_CLIENTS: '[]' }],
    [
      'duplicate client id',
      { MCP_OAUTH_CLIENTS: JSON.stringify([CLIENT, { ...CLIENT, name: 'Duplicate' }]) },
    ],
    ['invalid client id', { MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, id: 'Claude!' }]) }],
    ['blank client name', { MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, name: ' ' }]) }],
    [
      'short client secret',
      { MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, secret: 'short' }]) },
    ],
    [
      'missing redirect URI array',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { id: CLIENT.id, name: CLIENT.name, secret: CLIENT.secret },
        ]),
      },
    ],
    [
      'empty redirect URI array',
      { MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, redirectUris: [] }]) },
    ],
    [
      'duplicate redirect URI',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { ...CLIENT, redirectUris: [CLIENT.redirectUris[0], CLIENT.redirectUris[0]] },
        ]),
      },
    ],
  ])('rejects %s', (_name, override) => {
    expect(() => loadMcpConfig({ ...VALID_ENV, ...override })).toThrow();
  });

  it('rejects an MCP signing secret shared with the browser JWT', () => {
    expect(configError({ ...VALID_ENV, JWT_SECRET: TOKEN_SECRET })).toBe(
      'Invalid MCP configuration: MCP_TOKEN_SECRET must differ from JWT_SECRET.',
    );
  });

  it('rejects an MCP signing secret shared with an OAuth client', () => {
    expect(
      configError({
        ...VALID_ENV,
        MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, secret: TOKEN_SECRET }]),
      }),
    ).toBe(
      'Invalid MCP configuration: MCP_TOKEN_SECRET must differ from MCP_OAUTH_CLIENTS client secrets.',
    );
  });

  it('rejects duplicate OAuth client secrets', () => {
    expect(
      configError({
        ...VALID_ENV,
        MCP_OAUTH_CLIENTS: JSON.stringify([
          CLIENT,
          {
            ...CLIENT,
            id: 'chatgpt',
            name: 'ChatGPT',
            redirectUris: ['https://chatgpt.com/oauth/callback'],
          },
        ]),
      }),
    ).toBe('Invalid MCP configuration: MCP_OAUTH_CLIENTS client secrets must be unique.');
  });

  it.each([
    ['production API URL', { MCP_PUBLIC_API_URL: 'http://terrain.example.com/api' }],
    ['web base URL', { WEB_BASE_URL: 'http://terrain.example.com' }],
    [
      'remote redirect URI',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { ...CLIENT, redirectUris: ['http://claude.ai/callback'] },
        ]),
      },
    ],
    ['allowed origin', { MCP_ALLOWED_ORIGINS: 'http://chatgpt.com' }],
  ])('rejects non-HTTPS %s', (_name, override) => {
    expect(() => loadMcpConfig({ ...VALID_ENV, ...override })).toThrow();
  });

  it.each([
    ['a production root', 'https://terrain.example.com'],
    ['a production path other than /api', 'https://terrain.example.com/v1'],
    ['an uppercase scheme', 'HTTPS://terrain.example.com/api'],
    ['an uppercase host', 'https://Terrain.Example.com/api'],
    ['a trailing-dot host', 'https://terrain.example.com./api'],
    ['an explicit default port', 'https://terrain.example.com:443/api'],
    ['a backslash', 'https://terrain.example.com\\api'],
    ['a dot segment', 'https://terrain.example.com/v1/../api'],
    ['an encoded dot segment', 'https://terrain.example.com/v1/%2e%2e/api'],
    ['a duplicate path slash', 'https://terrain.example.com//api'],
    ['duplicate trailing slashes', 'https://terrain.example.com/api//'],
    ['a non-canonical path case', 'https://terrain.example.com/API'],
  ])('rejects MCP_PUBLIC_API_URL with %s', (_name, value) => {
    expect(() => loadMcpConfig({ ...VALID_ENV, MCP_PUBLIC_API_URL: value })).toThrow();
  });

  it.each([
    ['an uppercase scheme', 'HTTPS://terrain.example.com'],
    ['an uppercase host', 'https://Terrain.Example.com'],
    ['an explicit default port', 'https://terrain.example.com:443'],
    ['a backslash', 'https://terrain.example.com\\'],
    ['a dot segment', 'https://terrain.example.com/app/..'],
    ['a path', 'https://terrain.example.com/app'],
    ['duplicate root slashes', 'https://terrain.example.com//'],
  ])('rejects WEB_BASE_URL with %s', (_name, value) => {
    expect(() => loadMcpConfig({ ...VALID_ENV, WEB_BASE_URL: value })).toThrow();
  });

  it.each([
    ['an uppercase scheme', 'HTTPS://client.example.com/OAuth/Callback'],
    ['an uppercase host', 'https://Client.Example.com/OAuth/Callback'],
    ['an explicit default port', 'https://client.example.com:443/OAuth/Callback'],
    ['a backslash', 'https://client.example.com\\OAuth\\Callback'],
    ['a dot segment', 'https://client.example.com/oauth/../OAuth/Callback'],
  ])('rejects a redirect URI with %s', (_name, redirectUri) => {
    expect(() =>
      loadMcpConfig({
        ...VALID_ENV,
        MCP_OAUTH_CLIENTS: JSON.stringify([{ ...CLIENT, redirectUris: [redirectUri] }]),
      }),
    ).toThrow();
  });

  it.each([
    ['API query', { MCP_PUBLIC_API_URL: 'https://terrain.example.com/api?x=1' }],
    ['API hash', { MCP_PUBLIC_API_URL: 'https://terrain.example.com/api#x' }],
    ['API userinfo', { MCP_PUBLIC_API_URL: 'https://user@terrain.example.com/api' }],
    ['API wildcard', { MCP_PUBLIC_API_URL: 'https://*.example.com/api' }],
    ['web query', { WEB_BASE_URL: 'https://terrain.example.com?x=1' }],
    [
      'redirect hash',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { ...CLIENT, redirectUris: ['https://claude.ai/callback#x'] },
        ]),
      },
    ],
    [
      'redirect userinfo',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { ...CLIENT, redirectUris: ['https://user@claude.ai/callback'] },
        ]),
      },
    ],
    [
      'redirect wildcard',
      {
        MCP_OAUTH_CLIENTS: JSON.stringify([
          { ...CLIENT, redirectUris: ['https://claude.ai/callback/*'] },
        ]),
      },
    ],
    ['origin path', { MCP_ALLOWED_ORIGINS: 'https://chatgpt.com/callback' }],
  ])('rejects configured URL with %s', (_name, override) => {
    expect(() => loadMcpConfig({ ...VALID_ENV, ...override })).toThrow();
  });

  it('does not include configured secrets in errors', () => {
    const message = configError({
      ...VALID_ENV,
      MCP_PUBLIC_API_URL: 'http://terrain.example.com/api',
    });
    expect(message).toBeDefined();
    expect(message).not.toContain(TOKEN_SECRET);
    expect(message).not.toContain(CLIENT_SECRET);
  });
});

describe('normalizeMcpScopes', () => {
  it.each([
    ['learning:read', ['learning:read']],
    ['  learning:read  ', ['learning:read']],
    ['offline_access learning:read', ['learning:read', 'offline_access']],
    ['learning:read\toffline_access', ['learning:read', 'offline_access']],
  ])('normalizes %p', (input, expected) => {
    expect(normalizeMcpScopes(input)).toEqual(expected);
  });

  it.each([
    '',
    'offline_access',
    'learning:write',
    'learning:read learning:read',
    'learning:read offline_access offline_access',
    'learning:read unknown',
  ])('rejects invalid scope set %p', (input) => {
    expect(() => normalizeMcpScopes(input)).toThrow();
  });
});
