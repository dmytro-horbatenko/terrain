import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Throttle, ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import type { McpConfig } from './mcp.config';
import { type AuthorizationRequestInput, MCP_CONFIG, OAuthService } from './oauth.service';

const TOKEN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const AUTHORIZATION_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

function oauthError(error: string, error_description: string): never {
  throw new BadRequestException({ error, error_description });
}

class OAuthBasicClientException extends UnauthorizedException {
  constructor() {
    super({
      error: 'invalid_client',
      error_description: 'Client authentication failed.',
    });
  }
}

const SAFE_OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unsupported_grant_type',
]);

@Catch()
export class OAuthTokenBoundaryFilter extends BaseExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request>();
    if (!/^\/oauth\/token\/?$/i.test(request.path)) return super.catch(exception, host);

    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    if (exception instanceof OAuthBasicClientException) {
      response.setHeader('WWW-Authenticate', 'Basic realm="Terrain OAuth token"');
      return response.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed.',
      });
    }
    if (exception instanceof ThrottlerException) {
      return response.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Too many token requests. Try again later.',
      });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (
        status === 400 &&
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { error?: unknown }).error === 'string' &&
        SAFE_OAUTH_ERRORS.has((body as { error: string }).error) &&
        typeof (body as { error_description?: unknown }).error_description === 'string'
      ) {
        return response.status(400).json(body);
      }
      if (status === 400) {
        return response.status(400).json({
          error: 'invalid_request',
          error_description: 'Malformed token request.',
        });
      }
      if (status === 404) {
        return response.status(404).json({
          error: 'temporarily_unavailable',
          error_description: 'Token endpoint is unavailable.',
        });
      }
    }
    return response.status(500).json({
      error: 'server_error',
      error_description: 'Token request could not be processed.',
    });
  }
}

function fields(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function authorizationInput(input: unknown): AuthorizationRequestInput {
  const value = fields(input);
  return Object.fromEntries(
    AUTHORIZATION_FIELDS.map((field) => [field, value[field]]),
  ) as AuthorizationRequestInput;
}

function formField(input: Record<string, unknown>, field: string): string {
  return typeof input[field] === 'string' ? input[field] : '';
}

function decodeBasicPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new OAuthBasicClientException();
  }
}

function clientCredentials(
  authorization: string | undefined,
  body: Record<string, unknown>,
): { clientId: string; clientSecret: string; method: 'basic' | 'post' } {
  const hasBodyCredentials = body.client_id !== undefined || body.client_secret !== undefined;
  if (authorization && hasBodyCredentials) {
    oauthError('invalid_request', 'Use exactly one client authentication method.');
  }
  if (!authorization) {
    return {
      clientId: formField(body, 'client_id'),
      clientSecret: formField(body, 'client_secret'),
      method: 'post',
    };
  }

  const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)?.[1];
  if (!encoded || encoded.length % 4 !== 0) {
    throw new OAuthBasicClientException();
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) throw new OAuthBasicClientException();
  return {
    clientId: decodeBasicPart(decoded.slice(0, separator)),
    clientSecret: decodeBasicPart(decoded.slice(separator + 1)),
    method: 'basic',
  };
}

function isInvalidClient(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { error?: unknown }).error === 'invalid_client'
  );
}

@Controller()
export class OAuthController {
  constructor(
    private oauth: OAuthService,
    @Inject(MCP_CONFIG) private config: McpConfig | null,
  ) {}

  private configured(): McpConfig {
    if (!this.config) throw new NotFoundException();
    return this.config;
  }

  @Public()
  @Get('.well-known/oauth-protected-resource')
  protectedResource() {
    const config = this.configured();
    return {
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: ['learning:read', 'offline_access'],
      bearer_methods_supported: ['header'],
    };
  }

  @Public()
  @Get('.well-known/oauth-authorization-server')
  authorizationServer() {
    const config = this.configured();
    return {
      issuer: config.issuer,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['learning:read', 'offline_access'],
    };
  }

  @Public()
  @Get('oauth/authorize')
  authorize(@Query() query: Record<string, unknown>, @Res() response: Response) {
    const config = this.configured();
    const validated = this.oauth.validateAuthorizationRequest(authorizationInput(query));
    const approval = new URL('/oauth/authorize', config.webBaseUrl);
    for (const [key, value] of Object.entries(validated.original)) {
      approval.searchParams.set(key, value);
    }
    response.setHeader('Cache-Control', 'no-store');
    return response.redirect(302, approval.toString());
  }

  @HttpCode(200)
  @Post('oauth/authorize')
  async approve(
    @CurrentUser() userId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const value = fields(body);
    const input = authorizationInput(body);
    this.oauth.validateAuthorizationRequest(input);
    if (typeof value.approved !== 'boolean') {
      oauthError('invalid_request', 'Approval decision is required.');
    }
    const redirectUrl = value.approved
      ? await this.oauth.approve(userId, input)
      : this.oauth.deny(input);
    return { redirectUrl };
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @HttpCode(200)
  @Post('oauth/token')
  token(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.configured();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    const value = fields(body);
    const credentials = clientCredentials(authorization, value);
    const { clientId, clientSecret } = credentials;
    const remapBasicFailure = <T>(operation: Promise<T>) =>
      operation.catch((error) => {
        if (credentials.method === 'basic' && isInvalidClient(error)) {
          throw new OAuthBasicClientException();
        }
        throw error;
      });
    const grantType = formField(value, 'grant_type');
    if (grantType === 'authorization_code') {
      return remapBasicFailure(
        this.oauth.exchangeCode({
          code: formField(value, 'code'),
          clientId,
          clientSecret,
          redirectUri: formField(value, 'redirect_uri'),
          codeVerifier: formField(value, 'code_verifier'),
          resource: formField(value, 'resource'),
        }),
      );
    }
    if (grantType === 'refresh_token') {
      return remapBasicFailure(
        this.oauth.refresh({
          refreshToken: formField(value, 'refresh_token'),
          clientId,
          clientSecret,
          resource: formField(value, 'resource'),
        }),
      );
    }
    return oauthError('unsupported_grant_type', 'Grant type is not supported.');
  }

  @Get('oauth/grants')
  grants(@CurrentUser() userId: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.oauth.listGrants(userId);
  }

  @HttpCode(204)
  @Delete('oauth/grants/:clientId')
  async revoke(@CurrentUser() userId: string, @Param('clientId') clientId: string) {
    await this.oauth.revokeGrant(userId, clientId);
  }
}
