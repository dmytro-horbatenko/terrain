import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { StreakService } from '../streak/streak.service';
import { TelegramCron } from './telegram.cron';
import { TelegramService } from './telegram.service';

// 06:00 UTC = 09:00 in Kyiv (UTC+3, July) — matches digestHour 9 below.
const NOW = new Date('2026-07-02T06:00:00Z');

const settingsRow = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  telegramChatId: '42',
  timezone: 'Europe/Kyiv',
  digestHour: 9,
  nudgeHour: 20,
  ...over,
});

const card = (kind: string, minutes: number | null = null) => ({
  promptKind: kind,
  estimatedMinutes: minutes,
});

describe('TelegramCron', () => {
  let cron: TelegramCron;
  const prisma = {
    settings: { findMany: jest.fn() },
    review: { count: jest.fn() },
  };
  const telegram = { isConfigured: jest.fn().mockReturnValue(true), sendTo: jest.fn() };
  const metrics = { dueCards: jest.fn(), dueTopics: jest.fn(), nextUp: jest.fn() };
  const streak = { getState: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    telegram.isConfigured.mockReturnValue(true);
    process.env.WEB_BASE_URL = 'https://terrain.example';
    metrics.dueCards.mockResolvedValue([card('concept'), card('code'), card('problem', 45)]);
    metrics.dueTopics.mockResolvedValue({ overdue: [{}, {}], dueToday: [{}] });
    metrics.nextUp.mockResolvedValue({ topic: { title: 'Interval DP' } });
    streak.getState.mockResolvedValue({ currentStreak: 12 });
    prisma.review.count.mockResolvedValue(0);
    const mod = await Test.createTestingModule({
      providers: [
        TelegramCron,
        { provide: PrismaService, useValue: prisma },
        { provide: TelegramService, useValue: telegram },
        { provide: MetricsService, useValue: metrics },
        { provide: StreakService, useValue: streak },
      ],
    }).compile();
    cron = mod.get(TelegramCron);
  });

  it('sends the digest when the local hour matches digestHour', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(NOW);
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    const [userId, chatId, html, button] = telegram.sendTo.mock.calls[0];
    expect(userId).toBe('u1');
    expect(chatId).toBe('42');
    expect(html).toContain('Due: 3 cards');
    expect(html).toContain(`~${2 + 10 + 45} min`);
    expect(html).toContain('Streak: 12');
    expect(html).toContain('Next up: Interval DP');
    expect(button).toEqual({ text: 'Start review', url: 'https://terrain.example/?session=1' });
  });

  it('sends nothing when the hour matches neither setting', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow({ digestHour: 8, nudgeHour: 21 })]);
    await cron.tick(NOW);
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('skips the digest when digestHour is null (off)', async () => {
    prisma.settings.findMany.mockResolvedValue([settingsRow({ digestHour: null })]);
    await cron.tick(NOW);
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('sends the nudge at nudgeHour when nothing was logged today and cards are due', async () => {
    // 17:00 UTC = 20:00 Kyiv
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    const html = telegram.sendTo.mock.calls[0][2];
    expect(html).toContain('Streak (12) at risk');
    // reviews counted from the user-local day start (21:00 UTC previous day)
    expect(prisma.review.count).toHaveBeenCalledWith({
      where: { userId: 'u1', reviewedAt: { gte: new Date('2026-07-01T21:00:00.000Z') } },
    });
  });

  it('suppresses the nudge when a review was already logged today', async () => {
    prisma.review.count.mockResolvedValue(3);
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('suppresses the nudge when nothing is due', async () => {
    metrics.dueCards.mockResolvedValue([]);
    prisma.settings.findMany.mockResolvedValue([settingsRow()]);
    await cron.tick(new Date('2026-07-02T17:00:00Z'));
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('one user failing does not block the others', async () => {
    prisma.settings.findMany.mockResolvedValue([
      settingsRow({ userId: 'bad' }),
      settingsRow({ userId: 'good', telegramChatId: '43' }),
    ]);
    metrics.dueCards.mockImplementation((userId: string) =>
      userId === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve([card('concept')]),
    );
    await cron.tick(NOW);
    expect(telegram.sendTo).toHaveBeenCalledTimes(1);
    expect(telegram.sendTo.mock.calls[0][0]).toBe('good');
  });

  it('does nothing when the bot is not configured', async () => {
    telegram.isConfigured.mockReturnValue(false);
    await cron.tick(NOW);
    expect(prisma.settings.findMany).not.toHaveBeenCalled();
  });
});
