import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { LearningContext } from '@terrain/types';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { LearningContextService } from './learning-context.service';

@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningContextService) {}

  @Get('context')
  async context(
    @CurrentUser() userId: string,
    @Query('topic') topic: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LearningContext> {
    response.setHeader('Cache-Control', 'private, no-store');
    if (topic !== undefined && typeof topic !== 'string') {
      throw new BadRequestException('topic must contain 1 to 300 characters');
    }
    const normalized = topic?.trim();
    if (topic !== undefined && (!normalized || normalized.length > 300)) {
      throw new BadRequestException('topic must contain 1 to 300 characters');
    }
    return this.learning.context(userId, { topic: normalized });
  }
}
