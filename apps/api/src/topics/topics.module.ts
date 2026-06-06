import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { TopicsService } from './topics.service';
import { TopicsController } from './topics.controller';

@Module({
  imports: [MetricsModule],
  providers: [TopicsService],
  controllers: [TopicsController],
  exports: [TopicsService],
})
export class TopicsModule {}
