import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Bot, webhookCallback } from 'grammy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Owns the grammY Bot. Inert (all methods no-op) unless TELEGRAM_BOT_TOKEN is
 * set. Transport is env-driven: TELEGRAM_WEBHOOK_URL set -> webhook (prod,
 * secret_token auth); unset -> long polling (dev). Same handlers either way.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;

  constructor(private prisma: PrismaService) {}

  isConfigured(): boolean {
    return this.bot !== null;
  }

  getBot(): Bot | null {
    return this.bot;
  }

  async onModuleInit(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.log('TELEGRAM_BOT_TOKEN not set — Telegram integration disabled.');
      return;
    }
    this.bot = new Bot(token);
    this.registerHandlers(this.bot);

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (webhookUrl) {
      await this.bot.init();
      await this.bot.api.setWebhook(webhookUrl, {
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      });
      this.logger.log(`Telegram webhook registered: ${webhookUrl}`);
    } else {
      // Long polling (dev). bot.start() resolves only when the bot stops —
      // fire and forget, surface startup errors in the log.
      void this.bot.start({
        onStart: () => this.logger.log('Telegram long polling started (dev mode).'),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) await this.bot.stop();
  }

  private registerHandlers(bot: Bot): void {
    bot.command('start', async (ctx) => {
      const token = ctx.match.trim();
      const outcome = await this.linkAccount(token, String(ctx.chat.id));
      await ctx.reply(
        outcome === 'linked'
          ? 'Linked ✅ — you will get your Terrain digest here.'
          : 'This link is invalid or expired. Open Terrain → Settings → Connect Telegram to get a fresh one.',
      );
    });
    bot.on('message', async (ctx) => {
      await ctx.reply('I only deliver digests for now. Manage everything in Terrain → Settings.');
    });
  }

  /** Resolve a one-time link token to its user and bind this chat. */
  async linkAccount(token: string, chatId: string): Promise<'linked' | 'invalid'> {
    if (!token) return 'invalid';
    const row = await this.prisma.settings.findUnique({
      where: { telegramLinkToken: token },
    });
    if (!row) return 'invalid';
    if (!row.telegramLinkTokenExpiresAt || row.telegramLinkTokenExpiresAt < new Date()) {
      return 'invalid';
    }
    await this.prisma.settings.update({
      where: { userId: row.userId },
      data: { telegramChatId: chatId, telegramLinkToken: null, telegramLinkTokenExpiresAt: null },
    });
    this.logger.log(`Telegram linked for user ${row.userId}`);
    return 'linked';
  }

  /**
   * Send an HTML message; optional single inline URL button. A 403 means the
   * user blocked the bot — unlink them so the cron stops trying. Never throws:
   * one user's failure must not break a cron sweep.
   */
  async sendTo(
    userId: string,
    chatId: string,
    html: string,
    button?: { text: string; url: string },
  ): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        ...(button
          ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } }
          : {}),
      });
    } catch (e) {
      const err = e as { error_code?: number; description?: string };
      if (err.error_code === 403) {
        this.logger.warn(`User ${userId} blocked the bot — unlinking.`);
        await this.prisma.settings.updateMany({
          where: { userId },
          data: { telegramChatId: null },
        });
      } else {
        this.logger.error(`sendMessage failed for user ${userId}: ${err.description ?? e}`);
      }
    }
  }

  private webhookCb: ((req: Request, res: Response) => Promise<void>) | null = null;

  /** Lazy grammY express adapter; 503 when the bot is not configured. */
  async webhookHandler(req: Request, res: Response): Promise<void> {
    if (!this.bot) {
      res.status(503).json({ message: 'Telegram bot is not configured.' });
      return;
    }
    this.webhookCb ??= webhookCallback(this.bot, 'express', {
      secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
    });
    await this.webhookCb(req, res);
  }
}
