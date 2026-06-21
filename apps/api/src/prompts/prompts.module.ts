import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PromptsController, PromptController } from './prompts.controller';

@Module({
  providers: [PromptsService],
  controllers: [PromptsController, PromptController],
  exports: [PromptsService],
})
export class PromptsModule {}
