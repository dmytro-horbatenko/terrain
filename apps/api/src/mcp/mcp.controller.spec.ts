import {
  Body,
  Controller,
  HttpException,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { LearningContext } from '@terrain/types';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import request from 'supertest';
import { LearningContextService } from '../learning/learning-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { McpConfig } from './mcp.config';
import { McpModule, registerNonMcpBodyParsers } from './mcp.module';
import { McpService } from './mcp.service';
import { MCP_CONFIG } from './oauth.service';

const TOKEN_SECRET = 'mcp-token-secret-that-is-at-least-32-bytes';
const PROTOCOL_VERSION = '2025-11-25';
const config: McpConfig = {
  publicApiUrl: 'https://terrain.example.com/api',
  issuer: 'https://terrain.example.com',
  resource: 'https://terrain.example.com/api/mcp',
  authorizationEndpoint: 'https://terrain.example.com/api/oauth/authorize',
  tokenEndpoint: 'https://terrain.example.com/api/oauth/token',
  protectedResourceMetadata: 'https://terrain.example.com/.well-known/oauth-protected-resource',
  authorizationServerMetadata: 'https://terrain.example.com/.well-known/oauth-authorization-server',
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
  allowedOrigins: new Set(['https://terrain.example.com']),
};
const learningContext: LearningContext = {
  schemaVersion: 1,
  generatedAt: '2026-07-24T12:00:00.000Z',
  learner: {
    role: 'Engineer',
    learningStyle: null,
    codeStyle: null,
    noteSystem: null,
  },
  target: null,
  selection: {
    source: 'none',
    importedFocus: null,
    learnableAlternatives: [],
  },
  prerequisites: [],
  mayRelyOn: [],
  doNotAssume: [],
  blockers: [],
};

const userFindUnique = jest.fn();
const grantFindUnique = jest.fn();
const prisma = {
  user: { findUnique: userFindUnique },
  mcpOAuthGrant: { findUnique: grantFindUnique },
} as unknown as PrismaService;

@Controller('parser-probe')
class ParserProbeController {
  @Post()
  body(@Body() body: unknown) {
    return body;
  }
}

describe('McpController', () => {
  let app: INestApplication;
  let learning: { context: jest.Mock };

  async function createApp(mcpConfig: McpConfig | null = config): Promise<NestExpressApplication> {
    const module = await Test.createTestingModule({
      imports: [McpModule],
      controllers: [ParserProbeController],
    })
      .overrideProvider(MCP_CONFIG)
      .useValue(mcpConfig)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(LearningContextService)
      .useValue(learning)
      .compile();
    const instance = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    registerNonMcpBodyParsers(instance);
    await instance.listen(0, '127.0.0.1');
    return instance;
  }

  async function accessToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new JwtService().signAsync(
      {
        sub: 'user-1',
        client_id: 'chatgpt',
        grant_id: 'grant-1',
        scope: 'learning:read',
        token_use: 'mcp_access',
        ...claims,
      },
      {
        secret: TOKEN_SECRET,
        issuer: config.issuer,
        audience: config.resource,
        expiresIn: '15m',
        algorithm: 'HS256',
      },
    );
  }

  async function rpc(body: object | string | undefined, token?: string): Promise<request.Response> {
    const bearer = token ?? (await accessToken());
    return request(app.getHttpServer())
      .post('/mcp')
      .set('Host', 'terrain.example.com')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Mcp-Protocol-Version', PROTOCOL_VERSION)
      .send(body);
  }

  async function chunkedRpc(body: string): Promise<{
    status: number;
    headers: NodeJS.Dict<string | string[]>;
    body: Record<string, unknown>;
  }> {
    const address = app.getHttpServer().address() as AddressInfo;
    const token = await accessToken();
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'terrain.example.com',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Mcp-Protocol-Version': PROTOCOL_VERSION,
            'Transfer-Encoding': 'chunked',
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        },
      );
      outgoing.on('error', reject);
      for (let offset = 0; offset < body.length; offset += 64 * 1024) {
        outgoing.write(body.slice(offset, offset + 64 * 1024));
      }
      outgoing.end();
    });
  }

  async function nonTerminatingOversizeRpc(): Promise<{
    status: number;
    headers: NodeJS.Dict<string | string[]>;
    socketDestroyed: boolean;
    furtherWriteAccepted: boolean;
    body: Record<string, unknown>;
  }> {
    const address = app.getHttpServer().address() as AddressInfo;
    const token = await accessToken();
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'terrain.example.com',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Mcp-Protocol-Version': PROTOCOL_VERSION,
            'Transfer-Encoding': 'chunked',
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            setImmediate(() => {
              const socketDestroyed = outgoing.destroyed || Boolean(outgoing.socket?.destroyed);
              let furtherWriteAccepted = false;
              if (!socketDestroyed) {
                furtherWriteAccepted = outgoing.write('still-feeding');
              }
              outgoing.destroy();
              resolve({
                status: incoming.statusCode ?? 0,
                headers: incoming.headers,
                socketDestroyed,
                furtherWriteAccepted,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              });
            });
          });
        },
      );
      outgoing.on('error', () => undefined);
      const timer = setTimeout(() => {
        outgoing.destroy();
        reject(new Error('Oversized non-terminating MCP request was not closed'));
      }, 1500);
      outgoing.once('close', () => clearTimeout(timer));
      outgoing.write('{"padding":"');
      for (let sent = 0; sent <= 1024 * 1024; sent += 64 * 1024) {
        outgoing.write('x'.repeat(64 * 1024));
      }
    });
  }

  async function declaredOversizeRpc(): Promise<{
    status: number;
    headers: NodeJS.Dict<string | string[]>;
    body: Record<string, unknown>;
  }> {
    const address = app.getHttpServer().address() as AddressInfo;
    const token = await accessToken();
    return new Promise((resolve, reject) => {
      let finished = false;
      let timer: NodeJS.Timeout;
      const finish = (result: {
        status: number;
        headers: NodeJS.Dict<string | string[]>;
        body: Record<string, unknown>;
      }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      };
      const outgoing = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'terrain.example.com',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Content-Length': String(1024 * 1024 + 1),
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            finish({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        },
      );
      timer = setTimeout(() => {
        outgoing.destroy();
        finish({ status: 0, headers: {}, body: {} });
      }, 250);
      outgoing.on('error', (error) => {
        if (!finished) reject(error);
      });
      outgoing.end('{}');
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    userFindUnique.mockResolvedValue({ id: 'user-1' });
    grantFindUnique.mockResolvedValue({ id: 'grant-1', revokedAt: null });
    learning = { context: jest.fn().mockResolvedValue(learningContext) };
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('challenges unauthenticated requests without consulting learning data', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Host', 'terrain.example.com')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      })
      .expect(401);

    expect(response.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://terrain.example.com/.well-known/oauth-protected-resource", scope="learning:read"',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('initializes a fresh stateless JSON transport', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }).then((result) => {
      expect(result.status).toBe(200);
      return result;
    });

    expect(response.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'terrain', version: '1.0.0' },
        instructions:
          'Use get_learning_context to supplement a copied Terrain learning-session export with current prior-learning evidence, prerequisites, blockers, and roadmap alternatives. The copied export remains authoritative for the session target, Session ID, chosen approach, source plan, conduct, and output contract. If no export is present, use the tool for Terrain roadmap and learning-context questions. This server is read-only.',
      },
    });
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('lists exactly one read-only tool with the shared output schema', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }).then((result) => {
      expect(result.status).toBe(200);
      return result;
    });

    expect(response.body.result.tools).toHaveLength(1);
    expect(response.body.result.tools[0]).toMatchObject({
      name: 'get_learning_context',
      title: 'Get learning context',
      inputSchema: {
        type: 'object',
        properties: { topic: { type: 'string', minLength: 1, maxLength: 300 } },
      },
      outputSchema: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'number', const: 1 },
          learner: { type: 'object' },
          target: expect.any(Object),
          selection: { type: 'object' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('returns structured learning context for the bearer user and optional topic', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_learning_context',
        arguments: { topic: '  Accounts  ' },
      },
    }).then((result) => {
      expect(result.status).toBe(200);
      return result;
    });

    expect(learning.context).toHaveBeenCalledTimes(1);
    expect(learning.context).toHaveBeenCalledWith('user-1', { topic: 'Accounts' });
    expect(response.body.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(learningContext) }],
      structuredContent: learningContext,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('challenges malformed JSON before reading the unauthenticated body', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Host', 'terrain.example.com')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":')
      .expect(401);

    expect(response.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://terrain.example.com/.well-known/oauth-protected-resource", scope="learning:read"',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('returns a protocol parse error for authenticated malformed JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Host', 'terrain.example.com')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":')
      .expect(400);

    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: Invalid JSON' },
      id: null,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared MCP body before reading it', async () => {
    const response = await declaredOversizeRpc();

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Request body too large.' },
      id: null,
    });
    expect(response.headers.connection).toBe('close');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('bounds a chunked MCP body without relying on Content-Length', async () => {
    const response = await chunkedRpc(`{"padding":"${'x'.repeat(1024 * 1024)}"}`);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Request body too large.' },
      id: null,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('closes a non-terminating oversized chunked connection after delivering 413', async () => {
    const response = await nonTerminatingOversizeRpc();

    expect(response.status).toBe(413);
    expect(response.headers.connection).toBe('close');
    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Request body too large.' },
      id: null,
    });
    expect(response.socketDestroyed).toBe(true);
    expect(response.furtherWriteAccepted).toBe(false);
    expect(learning.context).not.toHaveBeenCalled();
  });

  it('rejects every JSON-RPC batch before any tool call', async () => {
    const response = await rpc([
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'get_learning_context', arguments: {} },
      },
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_learning_context', arguments: { topic: 'Accounts' } },
      },
    ]).then((result) => {
      expect(result.status).toBe(400);
      return result;
    });

    expect(response.body).toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'JSON-RPC batches are not supported.' },
      id: null,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(learning.context).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON', 'json', { nested: { value: true } }],
    ['URL-encoded', 'form', { topic: 'Accounts' }],
  ] as const)(
    'preserves the default %s parser outside the exact MCP route',
    async (_name, type, body) => {
      const response = await request(app.getHttpServer())
        .post('/parser-probe')
        .type(type)
        .send(body)
        .expect(201);

      expect(response.body).toEqual(body);
    },
  );

  it('settles after the client aborts during delayed bearer validation', async () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const userStarted = deferred<void>();
    const userResult = deferred<{ id: string }>();
    const grantStarted = deferred<void>();
    const grantResult = deferred<{ id: string; revokedAt: null }>();
    userFindUnique.mockImplementationOnce(() => {
      userStarted.resolve();
      return userResult.promise;
    });
    grantFindUnique.mockImplementationOnce(() => {
      grantStarted.resolve();
      return grantResult.promise;
    });

    const originalHandle = McpService.prototype.handle;
    const serviceEntered = deferred<void>();
    const serviceSettled = deferred<void>();
    let capturedRequest: Request | undefined;
    const handleSpy = jest
      .spyOn(McpService.prototype, 'handle')
      .mockImplementation(
        async function (this: McpService, request, response, userId): Promise<void> {
          capturedRequest = request;
          serviceEntered.resolve();
          try {
            await originalHandle.call(this, request, response, userId);
          } finally {
            serviceSettled.resolve();
          }
        },
      );
    const connectSpy = jest.spyOn(McpServer.prototype, 'connect');
    const address = app.getHttpServer().address() as AddressInfo;
    const outgoing = httpRequest({
      hostname: '127.0.0.1',
      port: address.port,
      path: '/mcp',
      method: 'POST',
      headers: {
        Host: 'terrain.example.com',
        Authorization: `Bearer ${await accessToken()}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
    });
    outgoing.on('error', () => undefined);

    try {
      outgoing.flushHeaders();
      await userStarted.promise;
      const clientClosed = new Promise<void>((resolve) => outgoing.once('close', resolve));
      outgoing.destroy();
      await clientClosed;
      userResult.resolve({ id: 'user-1' });
      await grantStarted.promise;
      grantResult.resolve({ id: 'grant-1', revokedAt: null });

      const entered = await Promise.race([
        serviceEntered.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      expect(entered).toBe(true);
      const settled = await Promise.race([
        serviceSettled.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      expect(settled).toBe(true);
      expect(capturedRequest?.aborted || capturedRequest?.destroyed).toBe(true);
      expect(capturedRequest?.listenerCount('data')).toBe(0);
      expect(capturedRequest?.listenerCount('end')).toBe(0);
      expect(capturedRequest?.listenerCount('aborted')).toBe(0);
      expect(connectSpy).not.toHaveBeenCalled();
      expect(learning.context).not.toHaveBeenCalled();
    } finally {
      outgoing.destroy();
      handleSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });

  it('returns a safe tool error for a foreign or missing topic', async () => {
    learning.context.mockRejectedValueOnce(new NotFoundException('Topic not found'));

    const response = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_learning_context',
        arguments: { topic: 'foreign-topic' },
      },
    }).then((result) => {
      expect(result.status).toBe(200);
      return result;
    });

    expect(response.body.result).toEqual({
      content: [{ type: 'text', text: 'Topic not found' }],
      isError: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|exception|prisma|sql/i);
  });

  it.each([
    ['an unsafe HTTP exception', new HttpException('database password leaked', 500)],
    ['an unexpected exception', new Error('SELECT password_hash FROM User')],
  ])('returns a generic tool error for %s', async (_name, error) => {
    learning.context.mockRejectedValueOnce(error);

    const response = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_learning_context',
        arguments: {},
      },
    }).then((result) => {
      expect(result.status).toBe(200);
      return result;
    });

    expect(response.body.result).toEqual({
      content: [{ type: 'text', text: 'Unable to load learning context.' }],
      isError: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/database|password|select|stack|sql/i);
  });

  it.each(['get', 'delete'] as const)(
    'returns a guarded protocol-safe 405 for authenticated %s',
    async (method) => {
      const response = await request(app.getHttpServer())
        [method]('/mcp')
        .set('Host', 'terrain.example.com')
        .set('Authorization', `Bearer ${await accessToken()}`)
        .expect(405);

      expect(response.body).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(learning.context).not.toHaveBeenCalled();
    },
  );

  it('returns a cache-safe 404 while MCP is disabled', async () => {
    const disabledApp = await createApp(null);
    try {
      const response = await request(disabledApp.getHttpServer())
        .post('/mcp')
        .set('Host', 'terrain.example.com')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        })
        .expect(404);

      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(learning.context).not.toHaveBeenCalled();
    } finally {
      await disabledApp.close();
    }
  });
});

describe('McpService response-close lifecycle', () => {
  let connect: jest.SpyInstance;
  let serverClose: jest.SpyInstance;
  let handleRequest: jest.SpyInstance;
  let transportClose: jest.SpyInstance;

  function rawRequest(): Request {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    return Object.assign(Readable.from([Buffer.from(body)]), {
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }) as unknown as Request;
  }

  function fakeResponse(): Response & EventEmitter {
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      destroyed: false,
      status: jest.fn(),
      json: jest.fn(),
    }) as unknown as Response & EventEmitter;
    (response.status as jest.Mock).mockReturnValue(response);
    return response;
  }

  function service(): McpService {
    return new McpService({
      context: jest.fn().mockResolvedValue(learningContext),
    } as unknown as LearningContextService);
  }

  beforeEach(() => {
    connect = jest.spyOn(McpServer.prototype, 'connect').mockResolvedValue();
    serverClose = jest.spyOn(McpServer.prototype, 'close').mockResolvedValue();
    handleRequest = jest
      .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockResolvedValue();
    transportClose = jest
      .spyOn(StreamableHTTPServerTransport.prototype, 'close')
      .mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('settles an already-aborted raw request without touching its destroyed response', async () => {
    const request = rawRequest();
    Object.defineProperty(request, 'aborted', { value: true });
    request.destroy();
    const response = fakeResponse();
    Object.assign(response, { destroyed: true });

    const settled = await Promise.race([
      service()
        .handle(request, response, 'user-1')
        .then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(settled).toBe(true);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(request.listenerCount('data')).toBe(0);
    expect(request.listenerCount('end')).toBe(0);
    expect(request.listenerCount('aborted')).toBe(0);
    expect(connect).not.toHaveBeenCalled();
  });

  it('waits for an in-flight handler after response close before cleaning up once', async () => {
    let settleHandler!: () => void;
    handleRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        settleHandler = resolve;
      }),
    );
    const response = fakeResponse();
    const work = service().handle(rawRequest(), response, 'user-1');
    await Promise.resolve();
    await Promise.resolve();

    response.emit('close');
    await Promise.resolve();

    expect(serverClose).not.toHaveBeenCalled();
    expect(transportClose).not.toHaveBeenCalled();
    settleHandler();
    await work;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(transportClose).toHaveBeenCalledTimes(1);
  });

  it('settles and cleans up once when an aborted handler does not finish in time', async () => {
    jest.useFakeTimers();
    handleRequest.mockReturnValue(new Promise<void>(() => undefined));
    const response = fakeResponse();
    let settled = false;
    const work = service()
      .handle(rawRequest(), response, 'user-1')
      .then(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(0);
    expect(handleRequest).toHaveBeenCalledTimes(1);

    response.emit('close');
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(transportClose).toHaveBeenCalledTimes(1);
    await work;
  });

  it('does not impose the abort grace timeout on a healthy slow handler', async () => {
    jest.useFakeTimers();
    let settleHandler!: () => void;
    handleRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        settleHandler = resolve;
      }),
    );
    const response = fakeResponse();
    let settled = false;
    const work = service()
      .handle(rawRequest(), response, 'user-1')
      .then(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(0);
    expect(handleRequest).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    expect(serverClose).not.toHaveBeenCalled();
    expect(transportClose).not.toHaveBeenCalled();

    settleHandler();
    await work;
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(transportClose).toHaveBeenCalledTimes(1);
  });

  it('logs a transport failure while returning only a generic protocol error', async () => {
    handleRequest.mockRejectedValue(new Error('transport exploded'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const response = fakeResponse();

    await service().handle(rawRequest(), response, 'user-1');

    expect(error).toHaveBeenCalledWith(
      'MCP request failed',
      expect.stringContaining('transport exploded'),
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  });
});
