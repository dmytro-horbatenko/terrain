import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { LogReviewDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private service: ReviewsService) {}
  @Post() log(@CurrentUser() userId: string, @Body() dto: LogReviewDto) {
    return this.service.logReview(userId, dto);
  }
  @Get() byTopic(@CurrentUser() userId: string, @Query('topicId') topicId?: string) {
    if (!topicId) throw new BadRequestException('topicId query param is required');
    return this.service.findByTopic(userId, topicId);
  }
}
