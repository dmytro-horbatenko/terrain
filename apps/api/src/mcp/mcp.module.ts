import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { LearningModule } from '../learning/learning.module';
import { McpBearerGuard } from './mcp-bearer.guard';
import { loadMcpConfig } from './mcp.config';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { OAuthController } from './oauth.controller';
import { MCP_CONFIG, OAuthService } from './oauth.service';

const MCP_PATH = /^\/mcp\/?$/i;

function unlessMcp(parser: RequestHandler): RequestHandler {
  return (request, response, next) =>
    MCP_PATH.test(request.path) ? next() : parser(request, response, next);
}

export function registerNonMcpBodyParsers(app: NestExpressApplication): void {
  app.use(unlessMcp(express.json()));
  app.use(unlessMcp(express.urlencoded({ extended: true })));
}

function privateNoStore(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
}

@Module({
  imports: [JwtModule.register({}), LearningModule],
  controllers: [OAuthController, McpController],
  providers: [
    OAuthService,
    McpService,
    McpBearerGuard,
    { provide: MCP_CONFIG, useFactory: loadMcpConfig },
  ],
})
export class McpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(privateNoStore).forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
