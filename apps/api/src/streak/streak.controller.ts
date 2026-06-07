import { Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { StreakService } from './streak.service';

@Controller('streak')
export class StreakController {
  constructor(private streak: StreakService) {}
  @Get() get(@CurrentUser() userId: string) {
    return this.streak.getState(userId);
  }
  @Post('skip') skip(@CurrentUser() userId: string) {
    return this.streak.skipToday(userId, new Date());
  }
}
