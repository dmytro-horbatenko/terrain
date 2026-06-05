import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
const jwt = { verifyAsync: jest.fn() } as any;
function ctx(cookies: any) {
  const req: any = { cookies };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
    _req: req,
  } as any;
}

it('sets req.userId from a valid cookie token', async () => {
  jwt.verifyAsync.mockResolvedValue({ sub: 'u1', email: 'a@b.co' });
  const guard = new JwtAuthGuard(reflector, jwt);
  const c = ctx({ token: 'good' });
  await expect(guard.canActivate(c)).resolves.toBe(true);
  expect(c._req.userId).toBe('u1');
});

it('throws 401 when the cookie is missing', async () => {
  const guard = new JwtAuthGuard(reflector, jwt);
  await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
});

it('allows @Public() routes without a token', async () => {
  reflector.getAllAndOverride.mockReturnValueOnce(true);
  const guard = new JwtAuthGuard(reflector, jwt);
  await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
});
