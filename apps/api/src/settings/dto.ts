import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SOURCE_FORMATS = ['article', 'book', 'video', 'course', 'documentation', 'exercise'];

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(500) obsidianVault?: string | null;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(23) nudgeHour?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(SOURCE_FORMATS, { each: true })
  preferredSourceFormats?: string[];
  @IsOptional() @IsInt() @Min(5) @Max(600) sourceTimeBudgetMinutes?: number | null;
  @IsOptional() @IsString() @MaxLength(50) sourceLanguage?: string | null;
  @IsOptional() @IsBoolean() allowPaidSources?: boolean;
}
