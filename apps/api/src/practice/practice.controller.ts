import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { PracticeService } from './practice.service';

@Controller('practice')
export class PracticeController {
  constructor(private readonly service: PracticeService) {}
  @Get() overview(@CurrentUser() userId: string) {
    return this.service.overview(userId);
  }
  @Get(':topicId/history') history(
    @CurrentUser() userId: string,
    @Param('topicId') topicId: string,
  ) {
    return this.service.history(userId, topicId);
  }
  @Post('checkpoints') save(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.service.save(userId, body);
  }
}
