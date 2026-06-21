import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { GRADES, type Grade, type ReviewMode } from '@terrain/types';

const REVIEW_MODES: ReviewMode[] = ['telegram_quick', 'app_log', 'claude_session'];

export class LogReviewDto {
  @IsString() topicId!: string;
  @IsOptional() @IsString() promptId?: string;
  @IsIn(GRADES) grade!: Grade;
  @IsIn(REVIEW_MODES) mode!: ReviewMode;
  @IsOptional() @IsInt() @Min(0) durationMin?: number;
  @IsOptional() @IsString() note?: string;
}
