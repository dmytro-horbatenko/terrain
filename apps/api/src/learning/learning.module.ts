import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LearningContextService } from './learning-context.service';
import { LearningController } from './learning.controller';

@Module({
  imports: [PrismaModule],
  controllers: [LearningController],
  providers: [LearningContextService],
  exports: [LearningContextService],
})
export class LearningModule {}
