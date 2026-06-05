import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
// Tighter-than-default limit on credential endpoints: brute force / credential
// stuffing / signup abuse are the realistic threats here, not legitimate
// retry volume. OWASP Authentication + Credential Stuffing Prevention
// Cheat Sheets.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
function setCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS,
  });
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.register(dto);
    setCookie(res, token);
    return user;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.login(dto);
    setCookie(res, token);
    return user;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token');
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @Patch('me')
  updateProfile(@CurrentUser() userId: string, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(userId, dto);
  }
}
