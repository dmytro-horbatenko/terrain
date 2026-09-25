import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { RequestHandler } from 'express';
import { registerNonMcpBodyParsers } from './mcp.module';

async function parse(path: string, method = 'PATCH') {
  const body = { body: '界'.repeat(100_000), revision: 0 };
  const encoded = Buffer.from(JSON.stringify(body));
  const request = Object.assign(new IncomingMessage(new Socket()), {
    path,
    method,
    headers: { 'content-type': 'application/json', 'content-length': encoded.length.toString() },
    complete: false,
  }) as any;
  request.push(encoded);
  request.push(null);
  const handlers: RequestHandler[] = [];
  registerNonMcpBodyParsers({ use: (handler: RequestHandler) => handlers.push(handler) } as any);
  let error: any;
  for (const handler of handlers) {
    error = await new Promise((resolve) => handler(request, {} as any, (err) => resolve(err)));
    if (error) break;
  }
  return { parsed: request.body, error, flowing: request.readableFlowing };
}

describe('note body parser boundary', () => {
  it('accepts the full Unicode notes limit only on the notes PATCH route', async () => {
    const result = await parse('/topics/topic-a/notes');
    expect(result.error).toBeUndefined();
    expect(result.parsed.body).toHaveLength(100_000);
  });

  it.each([
    ['/sessions/import', 'POST'],
    ['/topics/topic-a', 'PATCH'],
    ['/topics/topic-a/notes', 'POST'],
  ])('keeps the default size limit on %s %s', async (path, method) => {
    expect((await parse(path, method)).error?.status).toBe(413);
  });

  it('leaves MCP JSON unread for its own transport', async () => {
    const result = await parse('/mcp', 'POST');
    expect(result.error).toBeUndefined();
    expect(result.parsed).toBeUndefined();
    expect(result.flowing).toBeNull();
  });
});
