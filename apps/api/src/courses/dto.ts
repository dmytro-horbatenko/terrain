import { IsBoolean } from 'class-validator';

export class SetCourseDisabledDto {
  @IsBoolean() disabled!: boolean;
}
