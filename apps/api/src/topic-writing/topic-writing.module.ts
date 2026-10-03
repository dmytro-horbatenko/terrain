import { Module } from '@nestjs/common';
import { TopicWritingService } from './topic-writing.service';
import { TopicWritingController } from './topic-writing.controller';
@Module({
  providers: [TopicWritingService],
  controllers: [TopicWritingController],
  exports: [TopicWritingService],
})
export class TopicWritingModule {}
