import { BadRequestException, Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import { TopicWritingService } from './topic-writing.service';

@Controller('topic-writing')
export class TopicWritingController {
  constructor(private service: TopicWritingService) {}
  private kind(input: string) {
    const parsed = z.enum(['notes', 'reference']).safeParse(input);
    if (!parsed.success) throw new BadRequestException('Unknown writing kind.');
    return parsed.data;
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('reviews/preview')
  preview(@CurrentUser() userId: string, @Body() input: unknown) {
    return this.service.previewReview(userId, input);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('reviews/apply')
  apply(@CurrentUser() userId: string, @Body() input: unknown) {
    return this.service.applyReview(userId, input);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':topicId/context')
  context(@CurrentUser() userId: string, @Param('topicId') topicId: string) {
    return this.service.reviewContext(userId, topicId);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':topicId/:kind')
  get(
    @CurrentUser() userId: string,
    @Param('topicId') topicId: string,
    @Param('kind') kind: string,
  ) {
    return this.service.getWriting(userId, topicId, this.kind(kind));
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':topicId/:kind/history')
  history(
    @CurrentUser() userId: string,
    @Param('topicId') topicId: string,
    @Param('kind') kind: string,
  ) {
    return this.service.history(userId, topicId, this.kind(kind));
  }
}
