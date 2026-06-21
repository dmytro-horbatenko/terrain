import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(1) name!: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
export class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() learningStyle?: string;
  @IsOptional() @IsString() codeStyle?: string;
  @IsOptional() @IsString() noteSystem?: string;
  @IsOptional() @IsString() obsidianVault?: string;
}
