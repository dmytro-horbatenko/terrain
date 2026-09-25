import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AppEventKind, TopicStatus } from '@terrain/types';

const TOPIC_STATUSES: TopicStatus[] = ['planned', 'active', 'mastered', 'archived'];
const APP_EVENT_KINDS: AppEventKind[] = [
  'project_usage',
  'problem_solved',
  'audit_exercise',
  'real_debugging',
];

export class CreateTopicDto {
  @IsString() title!: string;
  @IsString() domain!: string;
  @IsString() topicType!: string;
  @IsOptional() @IsIn(TOPIC_STATUSES) status?: TopicStatus;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() noteRef?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() sourcePlan?: unknown | null;
}

export class UpdateTopicDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() topicType?: string;
  @IsOptional() @IsIn(TOPIC_STATUSES) status?: TopicStatus;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() noteRef?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() nextReviewAt?: string;
  @IsOptional() @IsBoolean() aiProposed?: boolean;
  @IsOptional() sourcePlan?: unknown | null;
}

export class CreateAppEventDto {
  @IsIn(APP_EVENT_KINDS) kind!: AppEventKind;
  @IsString() description!: string;
  @IsOptional() @IsString() url?: string;
}

export class AddPrerequisiteDto {
  @IsString() prerequisiteId!: string;
}

export class UpdateTopicNotesDto {
  @IsString() @MaxLength(100_000) body!: string;
  @IsInt() @Min(0) @Max(2_147_483_646) revision!: number;
}

export class SearchTopicsDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
