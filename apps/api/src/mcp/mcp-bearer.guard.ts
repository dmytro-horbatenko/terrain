import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { McpConfig } from './mcp.config';
import { MCP_CONFIG } from './oauth.service';

function repeatedHeader(request: Request, name: string): boolean {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) count += 1;
  }
  return count > 1;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Injectable()
export class McpBearerGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    @Inject(MCP_CONFIG) private config: McpConfig | null,
  ) {}

  private unauthorized(response: Response, config: McpConfig): never {
    response.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${config.protectedResourceMetadata}", scope="learning:read"`,
    );
    throw new UnauthorizedException();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const config = this.config;
    if (!config) throw new NotFoundException();

    const host = request.headers.host;
    if (
      typeof host !== 'string' ||
      repeatedHeader(request, 'host') ||
      !config.allowedHosts.has(host)
    ) {
      throw new BadRequestException();
    }

    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      (typeof origin !== 'string' ||
        repeatedHeader(request, 'origin') ||
        !config.allowedOrigins.has(origin))
    ) {
      throw new ForbiddenException();
    }

    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string' &&
      !repeatedHeader(request, 'authorization') &&
      /^Bearer ([^\s,]+)$/i.exec(authorization);
    if (!match) return this.unauthorized(response, config);

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(match[1], {
        secret: config.tokenSecret,
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['HS256'],
      });
    } catch {
      return this.unauthorized(response, config);
    }

    if (
      payload.iss !== config.issuer ||
      payload.aud !== config.resource ||
      typeof payload.exp !== 'number' ||
      payload.token_use !== 'mcp_access' ||
      typeof payload.scope !== 'string' ||
      !payload.scope.split(' ').includes('learning:read') ||
      !nonEmptyString(payload.sub) ||
      !nonEmptyString(payload.client_id) ||
      !nonEmptyString(payload.grant_id) ||
      !config.clients.has(payload.client_id)
    ) {
      return this.unauthorized(response, config);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!user) return this.unauthorized(response, config);

    const grant = await this.prisma.mcpOAuthGrant.findUnique({
      where: {
        userId_clientId: {
          userId: payload.sub,
          clientId: payload.client_id,
        },
      },
      select: { id: true, revokedAt: true },
    });
    if (!grant || grant.revokedAt || grant.id !== payload.grant_id) {
      return this.unauthorized(response, config);
    }

    request.userId = payload.sub;
    return true;
  }
}
