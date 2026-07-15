import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Settings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto';

export interface SettingsView {
  userId: string;
  obsidianVault: string | null;
  timezone: string;
  digestHour: number | null;
  nudgeHour: number | null;
  preferredSourceFormats: string[];
  sourceTimeBudgetMinutes: number | null;
  sourceLanguage: string | null;
  allowPaidSources: boolean;
  telegramLinked: boolean;
}

const DEFAULTS = {
  obsidianVault: null,
  timezone: 'UTC',
  digestHour: 9,
  nudgeHour: 20,
  preferredSourceFormats: [],
  sourceTimeBudgetMinutes: null,
  sourceLanguage: null,
  allowPaidSources: false,
};

function toView(userId: string, row: Settings | null): SettingsView {
  return {
    userId,
    obsidianVault: row?.obsidianVault ?? DEFAULTS.obsidianVault,
    timezone: row?.timezone ?? DEFAULTS.timezone,
    digestHour: row ? row.digestHour : DEFAULTS.digestHour,
    nudgeHour: row ? row.nudgeHour : DEFAULTS.nudgeHour,
    preferredSourceFormats: row?.preferredSourceFormats ?? DEFAULTS.preferredSourceFormats,
    sourceTimeBudgetMinutes: row?.sourceTimeBudgetMinutes ?? DEFAULTS.sourceTimeBudgetMinutes,
    sourceLanguage: row?.sourceLanguage ?? DEFAULTS.sourceLanguage,
    allowPaidSources: row?.allowPaidSources ?? DEFAULTS.allowPaidSources,
    telegramLinked: row?.telegramChatId != null,
  };
}

function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException(`Unknown IANA timezone: ${tz}`);
  }
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string): Promise<SettingsView> {
    const row = await this.prisma.settings.findUnique({ where: { userId } });
    return toView(userId, row);
  }

  async update(userId: string, dto: UpdateSettingsDto): Promise<SettingsView> {
    if (dto.timezone !== undefined) assertValidTimezone(dto.timezone);
    // Allowlist, not spread: telegramChatId and the link-token fields must be
    // unreachable from this endpoint regardless of what survives the DTO.
    const data: Record<string, unknown> = {};
    if (dto.obsidianVault !== undefined) data.obsidianVault = dto.obsidianVault;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.digestHour !== undefined) data.digestHour = dto.digestHour;
    if (dto.nudgeHour !== undefined) data.nudgeHour = dto.nudgeHour;
    if (dto.preferredSourceFormats !== undefined)
      data.preferredSourceFormats = dto.preferredSourceFormats;
    if (dto.sourceTimeBudgetMinutes !== undefined)
      data.sourceTimeBudgetMinutes = dto.sourceTimeBudgetMinutes;
    if (dto.sourceLanguage !== undefined) data.sourceLanguage = dto.sourceLanguage;
    if (dto.allowPaidSources !== undefined) data.allowPaidSources = dto.allowPaidSources;
    const row = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toView(userId, row);
  }

  async createLinkToken(userId: string): Promise<{ url: string }> {
    const username = process.env.TELEGRAM_BOT_USERNAME;
    if (!process.env.TELEGRAM_BOT_TOKEN || !username) {
      throw new ServiceUnavailableException('Telegram bot is not configured on this server.');
    }
    const token = randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 15 * 60_000);
    await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, telegramLinkToken: token, telegramLinkTokenExpiresAt: expires },
      update: { telegramLinkToken: token, telegramLinkTokenExpiresAt: expires },
    });
    return { url: `https://t.me/${username}?start=${token}` };
  }

  async unlinkTelegram(userId: string): Promise<SettingsView> {
    const row = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: { telegramChatId: null },
    });
    return toView(userId, row);
  }
}
