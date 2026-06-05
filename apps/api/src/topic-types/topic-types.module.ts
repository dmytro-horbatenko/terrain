import { Module } from '@nestjs/common';
import { TopicTypesController } from './topic-types.controller';

@Module({
  controllers: [TopicTypesController],
})
export class TopicTypesModule {}
