import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdateSettingsDto } from './dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get() get(@CurrentUser() userId: string) {
    return this.settings.get(userId);
  }

  @Patch() update(@CurrentUser() userId: string, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(userId, dto);
  }

  @Post('telegram/link-token') createLinkToken(@CurrentUser() userId: string) {
    return this.settings.createLinkToken(userId);
  }

  @Post('telegram/unlink') unlink(@CurrentUser() userId: string) {
    return this.settings.unlinkTelegram(userId);
  }
}
