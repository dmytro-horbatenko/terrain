import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { LogReviewDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { MetricsService } from '../metrics/metrics.service';
import { parseReviewOptions } from '../metrics/review-queue';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private service: ReviewsService,
    private metrics: MetricsService,
  ) {}
  @Post() log(@CurrentUser() userId: string, @Body() dto: LogReviewDto) {
    return this.service.logReview(userId, dto);
  }
  @Get() byTopic(@CurrentUser() userId: string, @Query('topicId') topicId?: string) {
    if (!topicId) throw new BadRequestException('topicId query param is required');
    return this.service.findByTopic(userId, topicId);
  }
  @Get('session-queue') sessionQueue(
    @CurrentUser() userId: string,
    @Query('domain') domain?: string,
    @Query('reviewMinutes') reviewMinutes?: string | string[],
    @Query('reviewPromptId') reviewPromptId?: string | string[],
  ) {
    return this.metrics.sessionQueue(
      userId,
      new Date(),
      domain,
      parseReviewOptions(reviewMinutes, reviewPromptId),
    );
  }
}
