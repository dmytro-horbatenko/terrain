import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PromptsController, PromptGraduationController } from './prompts.controller';

@Module({
  providers: [PromptsService],
  controllers: [PromptsController, PromptGraduationController],
  exports: [PromptsService],
})
export class PromptsModule {}
