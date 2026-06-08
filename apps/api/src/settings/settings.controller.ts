import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private prisma: PrismaService) {}

  @Get() async get(@CurrentUser() userId: string) {
    const settings = await this.prisma.settings.findUnique({ where: { userId } });
    return settings ?? { userId, obsidianVault: null, telegramChatId: null };
  }
}
