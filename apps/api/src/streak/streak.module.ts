import { Module } from '@nestjs/common';
import { StreakService } from './streak.service';
import { StreakCron } from './streak.cron';
import { StreakController } from './streak.controller';

@Module({
  providers: [StreakService, StreakCron],
  controllers: [StreakController],
  exports: [StreakService],
})
export class StreakModule {}
