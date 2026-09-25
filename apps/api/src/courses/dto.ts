import { IsBoolean, Matches } from 'class-validator';

export class ApplyCourseUpdateDto {
  @Matches(/^[a-f0-9]{64}$/) expectedFingerprint!: string;
}

export class SetCourseDisabledDto {
  @IsBoolean() disabled!: boolean;
}
