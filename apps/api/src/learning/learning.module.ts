import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LearningContextService } from './learning-context.service';
import { LearningController } from './learning.controller';
import { TopicWritingModule } from '../topic-writing/topic-writing.module';

@Module({
  imports: [PrismaModule, TopicWritingModule],
  controllers: [LearningController],
  providers: [LearningContextService],
  exports: [LearningContextService],
})
export class LearningModule {}
