import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(500) obsidianVault?: string | null;
  @IsOptional() @IsString() @MaxLength(100) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(23) nudgeHour?: number | null;
}
