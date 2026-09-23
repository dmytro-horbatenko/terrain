import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { parseReviewOptions } from '../metrics/review-queue';

@Controller('sessions')
export class SessionsController {
  constructor(private service: SessionsService) {}

  @Get(':id/export')
  savedExport(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getExport(userId, id);
  }

  @Get('export')
  export(
    @CurrentUser() userId: string,
    @Query('mode') mode?: string | string[],
    @Query('focusTopicId') focusTopicId?: string | string[],
    @Query('approach') approach?: string | string[],
    @Query('reviewMinutes') reviewMinutes?: string | string[],
    @Query('reviewPromptId') reviewPromptId?: string | string[],
  ) {
    const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
    const learningApproach = one(approach);
    if (
      learningApproach !== undefined &&
      learningApproach !== 'guided' &&
      learningApproach !== 'source-first'
    ) {
      throw new BadRequestException('approach must be guided or source-first');
    }
    return this.service.createExport(userId, {
      ...parseReviewOptions(reviewMinutes, reviewPromptId),
      mode: one(mode),
      focusTopicId: one(focusTopicId),
      approach: learningApproach,
    });
  }
}
