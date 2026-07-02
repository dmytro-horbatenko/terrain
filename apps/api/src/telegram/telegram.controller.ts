import { Controller, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private telegram: TelegramService) {}

  /**
   * Telegram's webhook target. No JWT (Telegram can't log in) and no
   * throttling (bursty by design) — authentication is the
   * X-Telegram-Bot-Api-Secret-Token header, verified inside grammY's
   * webhookCallback (mismatch -> 401 before any handler runs).
   */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  webhook(@Req() req: Request, @Res() res: Response) {
    return this.telegram.webhookHandler(req, res);
  }
}
