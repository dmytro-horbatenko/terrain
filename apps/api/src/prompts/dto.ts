import { IsBoolean } from 'class-validator';

export class SetGraduatedDto {
  @IsBoolean() graduated!: boolean;
}
