import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

const isProd = process.env.NODE_ENV === 'production';
const KNOWN_DEV_SECRETS = new Set(['dev-only-change-in-prod', 'changeme', 'secret']);

/**
 * Fail fast rather than boot with a missing/weak JWT signing secret — a token
 * signed with a short or default secret is brute-forceable and lets an
 * attacker forge sessions for any user. See OWASP Secrets Management +
 * JWT Cheat Sheets.
 */
function assertJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or too short (need >= 32 chars). Generate one with ' +
        '`openssl rand -base64 48` and set it in your .env — see apps/api/.env.example.',
    );
  }
  if (isProd && KNOWN_DEV_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET is set to a known placeholder value — refusing to start in production.',
    );
  }
}

/**
 * CORS is opt-in and origin-restricted rather than the previous wide-open
 * `enableCors()` (which reflects any Origin). Cookies carry the auth token, so
 * a permissive CORS + credentials combination would let any site ride the
 * user's session. Configure allowed origins via CORS_ORIGIN (comma-separated);
 * defaults to the local Vite dev server only.
 */
function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:5180';
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap() {
  assertJwtSecret();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trusting X-Forwarded-* only makes sense when a stripping reverse proxy
  // (Caddy, per docker-compose.prod.yml) actually sits in front of this
  // process — req.ip / req.secure then reflect the client instead of the
  // proxy hop, which correct rate-limit keys and secure-cookie detection
  // depend on. Gated on its own env var rather than NODE_ENV alone: NODE_ENV
  // is baked into the image regardless of how/where it's run, so tying trust
  // to it would silently let an attacker spoof X-Forwarded-For and bypass
  // IP-based rate limiting the moment this image is ever run without that
  // proxy in front (e.g. `docker run -p 3000:3000`, or a future compose edit
  // that publishes the api port directly).
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet());
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  // Required for OnModuleDestroy to fire on SIGTERM/SIGINT — the Telegram
  // long-polling loop must be stopped or a zombie process keeps consuming
  // getUpdates (and holds :3000, per the known nest-start zombie failure mode).
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(
    `Terrain API listening on :${port} (${isProd ? 'production' : 'development'})`,
  );
}
bootstrap();
