import { HttpException, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { learningContextSchema } from '@terrain/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { LearningContextService } from '../learning/learning-context.service';

const MAX_MCP_BODY_BYTES = 1024 * 1024;
const ABORT_GRACE_MS = 100;

class McpBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function readMcpBody(request: Request): Promise<Record<string, unknown>> {
  if (request.aborted || request.destroyed) {
    return Promise.reject(new Error('Request aborted'));
  }

  const declaredLength = request.headers['content-length'];
  if (
    typeof declaredLength === 'string' &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_MCP_BODY_BYTES
  ) {
    request.pause();
    return Promise.reject(new McpBodyError(413, -32000, 'Request body too large.'));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (body: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_MCP_BODY_BYTES) {
        request.pause();
        fail(new McpBodyError(413, -32000, 'Request body too large.'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
      } catch {
        fail(new McpBodyError(400, -32700, 'Parse error: Invalid JSON'));
        return;
      }
      if (Array.isArray(body)) {
        fail(new McpBodyError(400, -32600, 'JSON-RPC batches are not supported.'));
        return;
      }
      if (!body || typeof body !== 'object') {
        fail(new McpBodyError(400, -32600, 'Invalid Request'));
        return;
      }
      succeed(body as Record<string, unknown>);
    };
    const onAborted = () => fail(new Error('Request aborted'));
    const onError = (error: Error) => fail(error);

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
    if (request.aborted || request.destroyed) onAborted();
  });
}

function sendProtocolError(
  request: Request,
  response: Response,
  status: number,
  code: number,
  message: string,
): void {
  if (response.headersSent || response.destroyed) return;
  if (status === 413) {
    request.pause();
    response.setHeader('Connection', 'close');
    const destroy = () => {
      response.off('finish', onFinish);
      response.off('close', onClose);
      if (!request.destroyed) request.destroy();
    };
    const onFinish = () => destroy();
    const onClose = () => destroy();
    response.once('finish', onFinish);
    response.once('close', onClose);
  }
  response.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

type HandleOutcome =
  | { kind: 'handled' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'closed' }
  | { kind: 'timeout' };
type SettledHandleOutcome = Extract<HandleOutcome, { kind: 'handled' | 'failed' }>;

function waitAfterClose(handling: Promise<SettledHandleOutcome>): Promise<HandleOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), ABORT_GRACE_MS);
    void handling.then((outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    });
  });
}

@Injectable()
export class McpService {
  constructor(private learning: LearningContextService) {}

  private createServer(userId: string): McpServer {
    const server = new McpServer({ name: 'terrain', version: '1.0.0' });
    server.registerTool(
      'get_learning_context',
      {
        title: 'Get learning context',
        description:
          'Read Terrain’s current topic, roadmap selection, blockers, prerequisites, and learning evidence.',
        inputSchema: {
          topic: z.string().trim().min(1).max(300).optional(),
        },
        outputSchema: learningContextSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ topic }) => {
        try {
          const context = await this.learning.context(userId, { topic });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(context) }],
            structuredContent: context,
          };
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() < 500) {
            return {
              content: [{ type: 'text' as const, text: error.message }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Unable to load learning context.',
              },
            ],
            isError: true,
          };
        }
      },
    );
    server.server.registerCapabilities({ tools: { listChanged: false } });
    return server;
  }

  async handle(request: Request, response: Response, userId: string): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readMcpBody(request);
    } catch (error) {
      if (error instanceof McpBodyError) {
        sendProtocolError(request, response, error.status, error.code, error.message);
      } else if (!request.aborted && !request.destroyed) {
        sendProtocolError(request, response, 500, -32603, 'Internal server error');
      }
      return;
    }

    const server = this.createServer(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    let onClose!: () => void;
    const closed = new Promise<Extract<HandleOutcome, { kind: 'closed' }>>((resolve) => {
      onClose = () => resolve({ kind: 'closed' });
      response.once('close', onClose);
      if (response.destroyed) onClose();
    });

    try {
      await server.connect(transport);
      const handling: Promise<SettledHandleOutcome> = transport
        .handleRequest(request, response, body)
        .then(
          (): SettledHandleOutcome => ({ kind: 'handled' }),
          (error: unknown): SettledHandleOutcome => ({ kind: 'failed', error }),
        );
      let outcome: HandleOutcome = await Promise.race([handling, closed]);
      if (outcome.kind === 'closed') {
        outcome = await waitAfterClose(handling);
      }
      if (outcome.kind === 'failed') throw outcome.error;
    } catch {
      sendProtocolError(request, response, 500, -32603, 'Internal server error');
    } finally {
      response.off('close', onClose);
      await Promise.allSettled([transport.close(), server.close()]);
    }
  }
}
