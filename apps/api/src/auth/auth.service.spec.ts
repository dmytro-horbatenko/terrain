import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { AuthService } from './auth.service';

const jwt = { signAsync: jest.fn().mockResolvedValue('tok') } as any;
function makePrisma(user: any = null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'u1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'u1', ...data })),
    },
    streakState: { create: jest.fn() },
    settings: { create: jest.fn() },
  } as any;
}

it('register hashes the password, creates streak+settings, returns a token', async () => {
  const prisma = makePrisma(null);
  const svc = new AuthService(prisma, jwt);
  const res = await svc.register({ email: 'a@b.co', password: 'password1', name: 'A' });
  expect(res.token).toBe('tok');
  expect((res.user as any).passwordHash).toBeUndefined();
  expect(prisma.user.create).toHaveBeenCalled();
  expect(prisma.streakState.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
  expect(prisma.settings.create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
});

it('register rejects a duplicate email with 409', async () => {
  const prisma = makePrisma({ id: 'x', email: 'a@b.co' });
  const svc = new AuthService(prisma, jwt);
  await expect(
    svc.register({ email: 'a@b.co', password: 'password1', name: 'A' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('register converts a P2002 unique-violation on create into a 409', async () => {
  const prisma = makePrisma(null);
  prisma.user.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
  );
  const svc = new AuthService(prisma, jwt);
  await expect(
    svc.register({ email: 'a@b.co', password: 'password1', name: 'A' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('login rejects a wrong password with 401', async () => {
  const prisma = makePrisma({ id: 'u1', email: 'a@b.co', passwordHash: 'not-a-real-hash' });
  const svc = new AuthService(prisma, jwt);
  await expect(svc.login({ email: 'a@b.co', password: 'wrong' })).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
});

it('login on an unregistered email still runs an argon2 verify, so response timing does not reveal whether the account exists', async () => {
  const verifySpy = jest.spyOn(argon2, 'verify');
  const prisma = makePrisma(null);
  const svc = new AuthService(prisma, jwt);
  await expect(svc.login({ email: 'nobody@b.co', password: 'whatever1' })).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  expect(verifySpy).toHaveBeenCalledWith(expect.any(String), 'whatever1');
  verifySpy.mockRestore();
});
