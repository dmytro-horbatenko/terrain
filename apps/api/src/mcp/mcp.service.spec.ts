import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LearningContext } from '@terrain/types';
import type { LearningContextService } from '../learning/learning-context.service';
import { McpService } from './mcp.service';

describe('McpService', () => {
  async function connect(service: McpService) {
    const server = (service as unknown as { createServer(userId: string): McpServer }).createServer(
      'user-1',
    );
    const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  it('discovers and calls the context tool through the SDK with supplemental instructions', async () => {
    const context: LearningContext = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      learner: { role: null, learningStyle: null, codeStyle: null, noteSystem: null },
      target: null,
      selection: { source: 'none', importedFocus: null, learnableAlternatives: [] },
      prerequisites: [],
      mayRelyOn: [],
      doNotAssume: [],
      blockers: [],
    };
    const learning = { context: jest.fn().mockResolvedValue(context) };
    const service = new McpService(learning as unknown as LearningContextService);
    const { client, server } = await connect(service);

    try {
      expect(client.getInstructions()).toContain(
        'Use get_learning_context to supplement a copied Terrain learning-session export',
      );
      expect(client.getInstructions()).toContain('The copied export remains authoritative');
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        'get_learning_context',
        'get_topic_note_review_context',
      ]);
      const result = await client.callTool({
        name: 'get_learning_context',
        arguments: { topic: 'RLP encoding' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(context);
      expect(learning.context).toHaveBeenCalledWith('user-1', { topic: 'RLP encoding' });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('exposes note review as a read-only user-scoped tool', async () => {
    const value = {
      purpose: 'single topic',
      note: { body: 'Owned text', revision: 3 },
      pendingIndependentCheck: true,
    };
    const learning = {
      noteReviewContext: jest.fn().mockResolvedValue(value),
    } as unknown as LearningContextService;
    const { client, server } = await connect(new McpService(learning));
    try {
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === 'get_topic_note_review_context',
      );
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const result = await client.callTool({
        name: 'get_topic_note_review_context',
        arguments: { topicId: '051ac96c-5139-41c8-9b05-c74a0447e335' },
      });
      expect(result.structuredContent).toEqual(value);
      expect(learning.noteReviewContext).toHaveBeenCalledWith(
        'user-1',
        '051ac96c-5139-41c8-9b05-c74a0447e335',
      );
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('logs unexpected context failures while returning a safe tool error', async () => {
    const learning = {
      context: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as LearningContextService;
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { client, server } = await connect(new McpService(learning));

    try {
      const result = await client.callTool({
        name: 'get_learning_context',
        arguments: {},
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Unable to load learning context.' }],
        isError: true,
      });
      expect(error).toHaveBeenCalledWith(
        'get_learning_context failed',
        expect.stringContaining('database unavailable'),
      );
    } finally {
      error.mockRestore();
      await Promise.all([client.close(), server.close()]);
    }
  });
});
