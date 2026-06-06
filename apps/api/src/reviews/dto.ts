import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReviewMode } from '@terrain/types';

const REVIEW_MODES: ReviewMode[] = ['telegram_quick', 'app_log', 'claude_session'];

export class LogReviewDto {
  @IsString() topicId!: string;
  @IsOptional() @IsString() promptId?: string;
  @IsInt() @Min(0) @Max(5) quality!: number;
  @IsIn(REVIEW_MODES) mode!: ReviewMode;
  @IsOptional() @IsInt() durationMin?: number;
  @IsOptional() @IsString() note?: string;
}
