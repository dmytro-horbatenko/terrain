import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { type McpClient, type McpConfig, normalizeMcpScopes } from './mcp.config';

export const MCP_CONFIG = Symbol('MCP_CONFIG');

export type AuthorizationRequestInput = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
};

export type ValidatedAuthorizationRequest = {
  client: Pick<McpClient, 'id' | 'name'>;
  scopes: Array<'learning:read' | 'offline_access'>;
  original: AuthorizationRequestInput;
};

export type ExchangeCodeInput = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
};

export type RefreshInput = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  resource: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: 900;
  scope: string;
  refresh_token?: string;
};

export type OAuthGrant = {
  clientId: string;
  clientName: string;
  scopes: string[];
  connectedAt: string;
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const FIVE_MINUTES = 5 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_CLIENT_SECRET = 'invalid-client-secret'.padEnd(32, '.');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const pkceS256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

function equalSecret(actual: string, expected: string): boolean {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function sameScopes(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length && actual.every((scope, index) => scope === expected[index])
  );
}

function oauthError(
  error: 'invalid_request' | 'invalid_client' | 'invalid_grant',
  error_description: string,
): never {
  throw new BadRequestException({ error, error_description });
}

@Injectable()
export class OAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    @Inject(MCP_CONFIG) private config: McpConfig | null,
  ) {}

  private configured(): McpConfig {
    if (!this.config) throw new NotFoundException();
    return this.config;
  }

  private client(clientId: unknown, clientSecret: unknown): McpClient {
    const config = this.configured();
    const id = typeof clientId === 'string' ? clientId : '';
    const secret = typeof clientSecret === 'string' ? clientSecret : '';
    const client = config.clients.get(id);
    const valid = equalSecret(secret, client?.secret ?? DUMMY_CLIENT_SECRET);
    if (!client || !valid) oauthError('invalid_client', 'Client authentication failed.');
    return client;
  }

  private callback(input: AuthorizationRequestInput) {
    const config = this.configured();
    const client =
      typeof input?.client_id === 'string' ? config.clients.get(input.client_id) : undefined;
    if (
      !client ||
      typeof input.redirect_uri !== 'string' ||
      !client.redirectUris.includes(input.redirect_uri) ||
      typeof input.resource !== 'string' ||
      input.resource !== config.resource ||
      typeof input.state !== 'string' ||
      !input.state.trim()
    ) {
      oauthError('invalid_request', 'Invalid authorization request.');
    }
    return { config, client };
  }

  validateAuthorizationRequest(input: AuthorizationRequestInput): ValidatedAuthorizationRequest {
    const { client } = this.callback(input);
    let scopes: Array<'learning:read' | 'offline_access'>;
    try {
      scopes = normalizeMcpScopes(input.scope);
    } catch {
      return oauthError('invalid_request', 'Invalid authorization request.');
    }
    if (
      input.response_type !== 'code' ||
      input.code_challenge_method !== 'S256' ||
      typeof input.code_challenge !== 'string' ||
      !TOKEN.test(input.code_challenge)
    ) {
      oauthError('invalid_request', 'Invalid authorization request.');
    }

    const original: AuthorizationRequestInput = {
      response_type: input.response_type,
      client_id: input.client_id,
      redirect_uri: input.redirect_uri,
      scope: input.scope,
      state: input.state,
      code_challenge: input.code_challenge,
      code_challenge_method: input.code_challenge_method,
      resource: input.resource,
    };
    return {
      client: { id: client.id, name: client.name },
      scopes,
      original,
    };
  }

  async approve(userId: string, input: AuthorizationRequestInput): Promise<string> {
    const request = this.validateAuthorizationRequest(input);
    const code = randomToken();
    const grantId = randomToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.mcpOAuthGrant.upsert({
        where: { userId_clientId: { userId, clientId: request.client.id } },
        update: { id: grantId, scopes: request.scopes, grantedAt: now, revokedAt: null },
        create: {
          id: grantId,
          userId,
          clientId: request.client.id,
          scopes: request.scopes,
          grantedAt: now,
        },
      });
      await tx.mcpAuthorizationCode.create({
        data: {
          codeHash: sha256(code),
          grantId,
          userId,
          clientId: request.client.id,
          redirectUri: request.original.redirect_uri,
          codeChallenge: request.original.code_challenge,
          scopes: request.scopes,
          resource: request.original.resource,
          expiresAt: new Date(now.getTime() + FIVE_MINUTES),
        },
      });
    });

    const callback = new URL(request.original.redirect_uri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', request.original.state);
    return callback.toString();
  }

  deny(input: AuthorizationRequestInput): string {
    this.callback(input);
    const callback = new URL(input.redirect_uri);
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('state', input.state);
    return callback.toString();
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokenResponse> {
    const config = this.configured();
    const client = this.client(input?.clientId, input?.clientSecret);
    if (
      typeof input.code !== 'string' ||
      !TOKEN.test(input.code) ||
      typeof input.redirectUri !== 'string' ||
      !client.redirectUris.includes(input.redirectUri) ||
      typeof input.codeVerifier !== 'string' ||
      !VERIFIER.test(input.codeVerifier) ||
      input.resource !== config.resource
    ) {
      oauthError('invalid_grant', 'Authorization code is invalid or expired.');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const code = await tx.mcpAuthorizationCode.findUnique({
        where: { codeHash: sha256(input.code) },
      });
      if (
        !code ||
        code.usedAt ||
        code.expiresAt <= now ||
        code.clientId !== client.id ||
        code.redirectUri !== input.redirectUri ||
        code.resource !== input.resource ||
        !equalSecret(pkceS256(input.codeVerifier), code.codeChallenge)
      ) {
        oauthError('invalid_grant', 'Authorization code is invalid or expired.');
      }

      const grant = await tx.mcpOAuthGrant.findUnique({
        where: { userId_clientId: { userId: code.userId, clientId: code.clientId } },
      });
      if (
        !grant ||
        grant.id !== code.grantId ||
        grant.revokedAt ||
        !sameScopes(code.scopes, grant.scopes)
      ) {
        oauthError('invalid_grant', 'Authorization grant is invalid.');
      }

      const claim = await tx.mcpAuthorizationCode.updateMany({
        where: { id: code.id, grantId: code.grantId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count !== 1) {
        oauthError('invalid_grant', 'Authorization code is invalid or expired.');
      }

      let refreshToken: string | undefined;
      if (code.scopes.includes('offline_access')) {
        refreshToken = randomToken();
        await tx.mcpRefreshToken.create({
          data: {
            tokenHash: sha256(refreshToken),
            familyId: randomToken(),
            grantId: code.grantId,
            userId: code.userId,
            clientId: code.clientId,
            scopes: code.scopes,
            resource: code.resource,
            expiresAt: new Date(now.getTime() + THIRTY_DAYS),
          },
        });
      }
      return {
        userId: code.userId,
        clientId: code.clientId,
        grantId: code.grantId,
        scopes: code.scopes,
        refreshToken,
      };
    });
    return this.tokenResponse(result);
  }

  async refresh(input: RefreshInput): Promise<OAuthTokenResponse> {
    const config = this.configured();
    const client = this.client(input?.clientId, input?.clientSecret);
    if (
      typeof input.refreshToken !== 'string' ||
      !TOKEN.test(input.refreshToken) ||
      input.resource !== config.resource
    ) {
      oauthError('invalid_grant', 'Refresh token is invalid or expired.');
    }

    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const token = await tx.mcpRefreshToken.findUnique({
        where: { tokenHash: sha256(input.refreshToken) },
      });
      if (!token || token.clientId !== client.id || token.resource !== input.resource) {
        return null;
      }

      const revokeReplay = async () => {
        await tx.mcpRefreshToken.updateMany({
          where: {
            familyId: token.familyId,
            grantId: token.grantId,
            userId: token.userId,
            clientId: token.clientId,
            resource: token.resource,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await tx.mcpOAuthGrant.updateMany({
          where: {
            id: token.grantId,
            userId: token.userId,
            clientId: token.clientId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      };
      if (token.revokedAt || token.expiresAt <= now) {
        await revokeReplay();
        return null;
      }

      const grant = await tx.mcpOAuthGrant.findUnique({
        where: { userId_clientId: { userId: token.userId, clientId: token.clientId } },
      });
      if (
        !grant ||
        grant.id !== token.grantId ||
        grant.revokedAt ||
        !sameScopes(token.scopes, grant.scopes)
      ) {
        await revokeReplay();
        return null;
      }

      const claim = await tx.mcpRefreshToken.updateMany({
        where: {
          id: token.id,
          grantId: token.grantId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (claim.count !== 1) {
        await revokeReplay();
        return null;
      }

      const refreshToken = randomToken();
      await tx.mcpRefreshToken.create({
        data: {
          tokenHash: sha256(refreshToken),
          familyId: token.familyId,
          grantId: token.grantId,
          userId: token.userId,
          clientId: token.clientId,
          scopes: token.scopes,
          resource: token.resource,
          expiresAt: new Date(now.getTime() + THIRTY_DAYS),
        },
      });
      return {
        userId: token.userId,
        clientId: token.clientId,
        grantId: token.grantId,
        scopes: token.scopes,
        refreshToken,
      };
    });
    if (!outcome) oauthError('invalid_grant', 'Refresh token is invalid or expired.');
    return this.tokenResponse(outcome);
  }

  async listGrants(userId: string): Promise<OAuthGrant[]> {
    const config = this.configured();
    const grants = await this.prisma.mcpOAuthGrant.findMany({
      where: { userId, revokedAt: null },
      select: { clientId: true, scopes: true, grantedAt: true },
      orderBy: { grantedAt: 'asc' },
    });
    return grants.map((grant) => ({
      clientId: grant.clientId,
      clientName: config.clients.get(grant.clientId)?.name ?? grant.clientId,
      scopes: grant.scopes,
      connectedAt: grant.grantedAt.toISOString(),
    }));
  }

  async revokeGrant(userId: string, clientId: string): Promise<void> {
    this.configured();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.mcpOAuthGrant.updateMany({
        where: { userId, clientId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.mcpRefreshToken.updateMany({
        where: { userId, clientId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  private async tokenResponse(input: {
    userId: string;
    clientId: string;
    grantId: string;
    scopes: string[];
    refreshToken?: string;
  }): Promise<OAuthTokenResponse> {
    const config = this.configured();
    const accessToken = await this.jwt.signAsync(
      {
        sub: input.userId,
        client_id: input.clientId,
        grant_id: input.grantId,
        scope: input.scopes.join(' '),
        token_use: 'mcp_access',
      },
      {
        secret: config.tokenSecret,
        issuer: config.issuer,
        audience: config.resource,
        expiresIn: '15m',
      },
    );
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      scope: input.scopes.join(' '),
      ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
    };
  }
}
