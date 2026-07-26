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

type McpScope = 'learning:read' | 'offline_access';

const CLIENT_ID = /^[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function invalid(field: string): never {
  throw new Error(`Invalid MCP configuration: ${field}.`);
}

function configuredUrl(value: unknown, field: string): URL {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.includes('\\') ||
    value.includes('*') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return invalid(field);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(field);
  }

  if (
    url.username ||
    url.password ||
    url.hostname.endsWith('.') ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
  ) {
    return invalid(field);
  }
  if (value !== url.href && value !== url.origin) {
    return invalid(field);
  }
  return url;
}

function parsePublicApiUrl(value: string): { publicApiUrl: string; url: URL } {
  const url = configuredUrl(value, 'MCP_PUBLIC_API_URL');
  const local = LOOPBACK_HOSTS.has(url.hostname);
  if (
    (local && url.pathname !== '/' && url.pathname !== '/api' && url.pathname !== '/api/') ||
    (!local && url.pathname !== '/api' && url.pathname !== '/api/')
  ) {
    return invalid('MCP_PUBLIC_API_URL');
  }

  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return { publicApiUrl: `${url.origin}${pathname}`, url };
}

function configuredOrigin(value: unknown, field: string): URL {
  const url = configuredUrl(value, field);
  if (url.pathname !== '/') return invalid(field);
  return url;
}

function parseClients(raw: string | undefined): Map<string, McpClient> {
  let input: unknown;
  try {
    input = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return invalid('MCP_OAUTH_CLIENTS');
  }
  if (!Array.isArray(input) || input.length === 0) {
    return invalid('MCP_OAUTH_CLIENTS');
  }

  const clients = new Map<string, McpClient>();
  const clientSecrets = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('MCP_OAUTH_CLIENTS');
    }

    const candidate = value as Record<string, unknown>;
    const { id, name, secret, redirectUris } = candidate;
    if (
      typeof id !== 'string' ||
      !CLIENT_ID.test(id) ||
      clients.has(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof secret !== 'string' ||
      secret.length < 32 ||
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0
    ) {
      return invalid('MCP_OAUTH_CLIENTS');
    }
    if (clientSecrets.has(secret)) {
      return invalid('MCP_OAUTH_CLIENTS client secrets must be unique');
    }

    const seenRedirects = new Set<string>();
    for (const redirectUri of redirectUris) {
      configuredUrl(redirectUri, 'MCP_OAUTH_CLIENTS redirect URI');
      if (typeof redirectUri !== 'string' || seenRedirects.has(redirectUri)) {
        return invalid('MCP_OAUTH_CLIENTS');
      }
      seenRedirects.add(redirectUri);
    }

    clientSecrets.add(secret);
    clients.set(id, {
      id,
      name,
      secret,
      redirectUris: [...seenRedirects],
    });
  }
  return clients;
}

function parseAllowedOrigins(raw: string | undefined, resourceOrigin: string): Set<string> {
  const origins = new Set([resourceOrigin]);
  if (!raw?.trim()) return origins;

  for (const value of raw.split(',').map((origin) => origin.trim())) {
    if (!value) invalid('MCP_ALLOWED_ORIGINS');
    const url = configuredOrigin(value, 'MCP_ALLOWED_ORIGINS');
    origins.add(url.origin);
  }
  return origins;
}

export function normalizeMcpScopes(input: string): McpScope[] {
  const scopes = input.trim() ? input.trim().split(/\s+/) : [];
  const unique = new Set(scopes);
  if (
    unique.size !== scopes.length ||
    !unique.has('learning:read') ||
    [...unique].some((scope) => scope !== 'learning:read' && scope !== 'offline_access')
  ) {
    throw new Error('Invalid MCP authorization scope.');
  }
  return unique.has('offline_access') ? ['learning:read', 'offline_access'] : ['learning:read'];
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig | null {
  const publicApiInput = env.MCP_PUBLIC_API_URL;
  if (!publicApiInput?.trim()) return null;

  const { publicApiUrl, url: publicApi } = parsePublicApiUrl(publicApiInput);
  const webBase = configuredOrigin(env.WEB_BASE_URL, 'WEB_BASE_URL');
  const tokenSecret = env.MCP_TOKEN_SECRET;
  if (!tokenSecret || tokenSecret.length < 32) invalid('MCP_TOKEN_SECRET');
  const clients = parseClients(env.MCP_OAUTH_CLIENTS);
  if (env.JWT_SECRET !== undefined && tokenSecret === env.JWT_SECRET) {
    invalid('MCP_TOKEN_SECRET must differ from JWT_SECRET');
  }
  if ([...clients.values()].some((client) => client.secret === tokenSecret)) {
    invalid('MCP_TOKEN_SECRET must differ from MCP_OAUTH_CLIENTS client secrets');
  }

  const issuer = publicApi.origin;
  return {
    publicApiUrl,
    issuer,
    resource: `${publicApiUrl}/mcp`,
    authorizationEndpoint: `${publicApiUrl}/oauth/authorize`,
    tokenEndpoint: `${publicApiUrl}/oauth/token`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource`,
    authorizationServerMetadata: `${issuer}/.well-known/oauth-authorization-server`,
    webBaseUrl: webBase.origin,
    tokenSecret,
    clients,
    allowedHosts: new Set([publicApi.host]),
    allowedOrigins: parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS, publicApi.origin),
  };
}
