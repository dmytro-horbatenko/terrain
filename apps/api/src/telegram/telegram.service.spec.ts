import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

const future = () => new Date(Date.now() + 10 * 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('TelegramService', () => {
  let service: TelegramService;
  const prisma = {
    settings: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.TELEGRAM_BOT_TOKEN; // service stays inert; no real Bot
    const mod = await Test.createTestingModule({
      providers: [TelegramService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TelegramService);
  });

  describe('linkAccount', () => {
    it('links a valid unexpired token: writes chat id, clears token fields', async () => {
      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: future(),
      });
      prisma.settings.update.mockResolvedValue({});
      await expect(service.linkAccount('tok', '12345')).resolves.toBe('linked');
      expect(prisma.settings.findUnique).toHaveBeenCalledWith({
        where: { telegramLinkToken: 'tok' },
      });
      expect(prisma.settings.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: {
          telegramChatId: '12345',
          telegramLinkToken: null,
          telegramLinkTokenExpiresAt: null,
        },
      });
    });

    it('rejects an unknown token', async () => {
      prisma.settings.findUnique.mockResolvedValue(null);
      await expect(service.linkAccount('nope', '1')).resolves.toBe('invalid');
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token without state change', async () => {
      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: past(),
      });
      await expect(service.linkAccount('tok', '1')).resolves.toBe('invalid');
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rejects an empty token', async () => {
      await expect(service.linkAccount('', '1')).resolves.toBe('invalid');
      expect(prisma.settings.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('sendTo', () => {
    it('no-ops when the bot is not configured', async () => {
      await expect(service.sendTo('u1', '1', 'hi')).resolves.toBeUndefined();
    });

    it('sends HTML with an inline URL button', async () => {
      const sendMessage = jest.fn().mockResolvedValue({});
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      await service.sendTo('u1', '42', '<b>hi</b>', { text: 'Open', url: 'https://x' });
      expect(sendMessage).toHaveBeenCalledWith('42', '<b>hi</b>', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://x' }]] },
      });
    });

    it('clears telegramChatId when Telegram returns 403 (blocked), without throwing', async () => {
      const sendMessage = jest
        .fn()
        .mockRejectedValue({ error_code: 403, description: 'Forbidden: bot was blocked' });
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      prisma.settings.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.sendTo('u1', '42', 'hi')).resolves.toBeUndefined();
      expect(prisma.settings.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { telegramChatId: null },
      });
    });

    it('swallows and logs other send errors', async () => {
      const sendMessage = jest.fn().mockRejectedValue({ error_code: 400, description: 'bad' });
      (service as never as { bot: unknown }).bot = { api: { sendMessage } };
      await expect(service.sendTo('u1', '42', 'hi')).resolves.toBeUndefined();
      expect(prisma.settings.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('/start handler wiring', () => {
    it('replies "Linked" for a valid token via a real grammY Bot (offline)', async () => {
      const { Bot } = await import('grammy');
      const bot = new Bot('dummy-token', {
        botInfo: {
          id: 1,
          is_bot: true,
          first_name: 'T',
          username: 'terrain_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
          can_connect_to_business: false,
          has_main_web_app: false,
          has_topics_enabled: false,
          allows_users_to_create_topics: false,
          can_manage_bots: false,
          supports_join_request_queries: false,
        },
      });
      const sent: { method: string; payload: Record<string, unknown> }[] = [];
      // Intercept ALL outbound API calls — nothing touches the network.
      bot.api.config.use((_prev, method, payload) => {
        sent.push({ method, payload: payload as Record<string, unknown> });
        return Promise.resolve({ ok: true as const, result: true as never });
      });
      (service as never as { registerHandlers: (b: unknown) => void }).registerHandlers(bot);

      prisma.settings.findUnique.mockResolvedValue({
        userId: 'u1',
        telegramLinkTokenExpiresAt: future(),
      });
      prisma.settings.update.mockResolvedValue({});

      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private', first_name: 'D' },
          from: { id: 42, is_bot: false, first_name: 'D' },
          text: '/start tok123',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
      });

      expect(prisma.settings.update).toHaveBeenCalled();
      expect(sent[0].method).toBe('sendMessage');
      expect(String(sent[0].payload.text)).toContain('Linked');
    });
  });
});
