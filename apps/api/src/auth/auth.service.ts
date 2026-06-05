import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '@prisma/client';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto, UpdateProfileDto } from './dto';

export type SafeUser = Omit<User, 'passwordHash'>;
const strip = (u: User): SafeUser => {
  const { passwordHash: _drop, ...rest } = u;
  return rest;
};

// Verified against on every login attempt where the email doesn't match a
// user, so a missing account takes the same argon2id-verify time as a wrong
// password — otherwise the two cases are distinguishable by response
// latency alone (OWASP Authentication Cheat Sheet: user enumeration via
// timing). Never a real password; only its hash shape matters.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$A3TZHIQo+UiFnkk2h7cVSw$/0jS7aCk8xHzBhF0FBgPiPMTBJiJFhy0L012QJjHV0A';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async sign(user: User): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email });
  }

  async register(dto: RegisterDto): Promise<{ user: SafeUser; token: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered.');
    const passwordHash = await argon2.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already registered.');
      }
      throw e;
    }
    await this.prisma.streakState.create({ data: { userId: user.id } });
    await this.prisma.settings.create({ data: { userId: user.id } });
    return { user: strip(user), token: await this.sign(user) };
  }

  async login(dto: LoginDto): Promise<{ user: SafeUser; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = await argon2
      .verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, dto.password)
      .catch(() => false);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return { user: strip(user), token: await this.sign(user) };
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return strip(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SafeUser> {
    const { obsidianVault, ...profile } = dto;
    const user = await this.prisma.user.update({ where: { id: userId }, data: profile });
    if (obsidianVault !== undefined) {
      await this.prisma.settings.update({ where: { userId }, data: { obsidianVault } });
    }
    return strip(user);
  }
}
