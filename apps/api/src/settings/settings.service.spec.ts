import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  obsidianVault: null,
  telegramChatId: null,
  timezone: 'UTC',
  digestHour: 9,
  nudgeHour: 20,
  preferredSourceFormats: [],
  sourceTimeBudgetMinutes: null,
  sourceLanguage: null,
  allowPaidSources: false,
  telegramLinkToken: null,
  telegramLinkTokenExpiresAt: null,
  ...over,
});

describe('SettingsService', () => {
  let service: SettingsService;
  const prisma = {
    settings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(SettingsService);
  });

  it('get returns defaults when no row exists, without creating one', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    const view = await service.get('u1');
    expect(view).toEqual({
      userId: 'u1',
      obsidianVault: null,
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      preferredSourceFormats: [],
      sourceTimeBudgetMinutes: null,
      sourceLanguage: null,
      allowPaidSources: false,
      telegramLinked: false,
    });
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });

  it('get maps a linked row to telegramLinked=true without exposing the chat id', async () => {
    prisma.settings.findUnique.mockResolvedValue(row({ telegramChatId: '12345' }));
    const view = await service.get('u1');
    expect(view.telegramLinked).toBe(true);
    expect(view).not.toHaveProperty('telegramChatId');
    expect(view).not.toHaveProperty('telegramLinkToken');
  });

  it('update upserts provided fields and returns the view', async () => {
    prisma.settings.upsert.mockResolvedValue(
      row({ timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null }),
    );
    const view = await service.update('u1', {
      timezone: 'Europe/Kyiv',
      digestHour: 8,
      nudgeHour: null,
    });
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null },
      update: { timezone: 'Europe/Kyiv', digestHour: 8, nudgeHour: null },
    });
    expect(view.digestHour).toBe(8);
    expect(view.nudgeHour).toBeNull();
  });

  it('update omits undefined fields (partial patch)', async () => {
    prisma.settings.upsert.mockResolvedValue(row({ digestHour: 7 }));
    await service.update('u1', { digestHour: 7 });
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', digestHour: 7 },
      update: { digestHour: 7 },
    });
  });

  it('update allowlists learning source preferences', async () => {
    prisma.settings.upsert.mockResolvedValue(
      row({
        preferredSourceFormats: ['documentation', 'video'],
        sourceTimeBudgetMinutes: 45,
        sourceLanguage: 'en',
      }),
    );
    await service.update('u1', {
      preferredSourceFormats: ['documentation', 'video'],
      sourceTimeBudgetMinutes: 45,
      sourceLanguage: 'en',
      allowPaidSources: false,
    });
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: {
        userId: 'u1',
        preferredSourceFormats: ['documentation', 'video'],
        sourceTimeBudgetMinutes: 45,
        sourceLanguage: 'en',
        allowPaidSources: false,
      },
      update: {
        preferredSourceFormats: ['documentation', 'video'],
        sourceTimeBudgetMinutes: 45,
        sourceLanguage: 'en',
        allowPaidSources: false,
      },
    });
  });

  it('update rejects an invalid IANA timezone', async () => {
    await expect(service.update('u1', { timezone: 'Mars/Olympus' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });

  it('update never writes telegramChatId even if smuggled past the DTO', async () => {
    prisma.settings.upsert.mockResolvedValue(row());
    await service.update('u1', { telegramChatId: '666' } as never);
    const args = prisma.settings.upsert.mock.calls[0][0];
    expect(args.create).not.toHaveProperty('telegramChatId');
    expect(args.update).not.toHaveProperty('telegramChatId');
  });

  describe('createLinkToken', () => {
    const env = process.env;
    afterEach(() => {
      process.env = env;
    });

    it('503s when the bot is not configured', async () => {
      process.env = { ...env };
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_USERNAME;
      await expect(service.createLinkToken('u1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('stores a 32-hex token with ~15min expiry and returns the deep link', async () => {
      process.env = { ...env, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_USERNAME: 'terrain_bot' };
      prisma.settings.upsert.mockResolvedValue(row());
      const before = Date.now();
      const { url } = await service.createLinkToken('u1');
      const args = prisma.settings.upsert.mock.calls[0][0];
      const token = args.update.telegramLinkToken as string;
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      expect(args.create.telegramLinkToken).toBe(token);
      const expiry = (args.update.telegramLinkTokenExpiresAt as Date).getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 14 * 60_000);
      expect(expiry).toBeLessThanOrEqual(before + 16 * 60_000);
      expect(url).toBe(`https://t.me/terrain_bot?start=${token}`);
    });
  });

  it('unlinkTelegram clears the chat id', async () => {
    prisma.settings.upsert.mockResolvedValue(row({ telegramChatId: null }));
    const view = await service.unlinkTelegram('u1');
    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1' },
      update: { telegramChatId: null },
    });
    expect(view.telegramLinked).toBe(false);
  });
});
