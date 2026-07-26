import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('sessions')
export class SessionsController {
  constructor(private service: SessionsService) {}

  @Get('export')
  export(
    @CurrentUser() userId: string,
    @Query('mode') mode?: string | string[],
    @Query('focusTopicId') focusTopicId?: string | string[],
    @Query('approach') approach?: string | string[],
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
      mode: one(mode),
      focusTopicId: one(focusTopicId),
      approach: learningApproach,
    });
  }
}
