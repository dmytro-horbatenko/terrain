import { Controller, Get, Query } from '@nestjs/common';
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
  ) {
    const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
    return this.service.createExport(userId, { mode: one(mode), focusTopicId: one(focusTopicId) });
  }
}
