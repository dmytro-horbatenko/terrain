import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { TopicsService } from './topics.service';
import { TopicsController } from './topics.controller';
import { TopicWritingModule } from '../topic-writing/topic-writing.module';

@Module({
  imports: [MetricsModule, TopicWritingModule],
  providers: [TopicsService],
  controllers: [TopicsController],
  exports: [TopicsService],
})
export class TopicsModule {}
