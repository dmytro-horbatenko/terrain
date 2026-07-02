import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { StreakModule } from '../streak/streak.module';
import { TelegramController } from './telegram.controller';
import { TelegramCron } from './telegram.cron';
import { TelegramService } from './telegram.service';

@Module({
  imports: [MetricsModule, StreakModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramCron],
  exports: [TelegramService],
})
export class TelegramModule {}
