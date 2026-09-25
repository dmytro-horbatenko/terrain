import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { ImportController } from '../src/import/import.controller';
import { ImportService } from '../src/import/import.service';
import { LearningController } from '../src/learning/learning.controller';
import { LearningContextService } from '../src/learning/learning-context.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExportGeneratorService } from '../src/sessions/export-generator.service';
import { SessionsController } from '../src/sessions/sessions.controller';
import { SessionsService } from '../src/sessions/sessions.service';
import { learningFixture, TOPIC_ID } from './learning-fixture';

const PASSWORD = 'local-integration-test-password';
const NEXT_STEP = 'Encode a nested list, then explain each payload length without hints.';

describe('authenticated learning round trip (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-only-signing-secret-not-for-production' })],
      controllers: [AuthController, SessionsController, ImportController, LearningController],
      providers: [
        AuthService,
        SessionsService,
        ExportGeneratorService,
        ImportService,
        LearningContextService,
        MetricsService,
        { provide: PrismaService, useValue: learningFixture(await argon2.hash(PASSWORD)) },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects anonymous and invalid credentials before returning learning context', async () => {
    await request(app.getHttpServer()).get('/learning/context').expect(401);
    await request(app.getHttpServer()).get('/sessions/export?mode=learn').expect(401);
    await request(app.getHttpServer()).post('/sessions/import').send({ raw: '{}' }).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'learner0@example.test', password: 'wrong' })
      .expect(401);
  });

  it('exports owned context, imports once, and resumes the persisted objective and next step', async () => {
    const learner = request.agent(app.getHttpServer());
    const other = request.agent(app.getHttpServer());
    const login = await learner
      .post('/auth/login')
      .send({ email: 'learner0@example.test', password: PASSWORD })
      .expect(201);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.body).not.toHaveProperty('passwordHash');
    await other
      .post('/auth/login')
      .send({ email: 'learner1@example.test', password: PASSWORD })
      .expect(201);
    await other.get(`/learning/context?topic=${TOPIC_ID}`).expect(404);

    const exported = await learner
      .get(`/sessions/export?mode=learn&focusTopicId=${TOPIC_ID}&approach=guided`)
      .expect(200);
    expect(exported.body.exportMd).toContain(`Session: ${exported.body.id}`);
    expect(exported.body.exportMd).toContain('Topic: RLP encoding');
    expect(exported.body.exportMd).toContain('Trace inner and outer length prefixes.');
    await other.get(`/sessions/${exported.body.id}/export`).expect(404);

    const raw =
      '```learning-os\n' +
      JSON.stringify({
        version: 2,
        sessionId: exported.body.id,
        reviews: [
          {
            topicTitle: 'RLP encoding',
            grade: 'hard',
            note: 'Confused inner payload bytes with the outer prefix.',
          },
        ],
        noteSummaries: [
          {
            topicTitle: 'RLP encoding',
            keyInsight: 'A list prefix describes encoded payload bytes.',
          },
        ],
        applicationEvents: [
          {
            topicTitle: 'RLP encoding',
            kind: 'problem_solved',
            description: 'Traced a failing nested-list fixture.',
          },
        ],
        nextSession: { focusTitle: 'RLP encoding', coldChallenge: NEXT_STEP },
      }) +
      '\n```';
    await other.post('/sessions/import/preview').send({ raw }).expect(404);
    await other.post('/sessions/import').send({ raw }).expect(404);
    const preview = await learner.post('/sessions/import/preview').send({ raw }).expect(200);
    expect(preview.body).toMatchObject({
      applicable: true,
      alreadyImported: false,
      unresolved: [],
    });
    const imported = await learner.post('/sessions/import').send({ raw }).expect(200);
    expect(imported.body).toMatchObject({
      reviewsApplied: 1,
      noteSummariesApplied: 1,
      appEventsApplied: 1,
      nextSessionStored: true,
    });
    await learner.post('/sessions/import').send({ raw }).expect(409);

    const context = await learner.get('/learning/context').expect(200);
    expect(context.headers['cache-control']).toBe('private, no-store');
    expect(context.body.target).toMatchObject({
      id: TOPIC_ID,
      status: 'active',
      summary: '**Key insight:** A list prefix describes encoded payload bytes.',
      continuation: { sessionId: exported.body.id, coldChallenge: NEXT_STEP, resuming: true },
      applications: [{ description: 'Traced a failing nested-list fixture.' }],
    });
    expect(context.body.selection).toMatchObject({
      source: 'imported-focus',
      importedFocus: { accepted: true },
    });
    const resumed = await learner.get('/sessions/export?mode=learn').expect(200);
    expect(resumed.body.id).not.toBe(exported.body.id);
    expect(resumed.body.exportMd).toContain('SAVED NEXT STEP');
    expect(resumed.body.exportMd).toContain(NEXT_STEP);
    expect(resumed.body.exportMd).toContain('Traced a failing nested-list fixture.');
    expect((await other.get('/learning/context').expect(200)).body.target).toBeNull();
  });
});
