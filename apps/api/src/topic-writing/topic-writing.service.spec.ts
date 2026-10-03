import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TopicWritingService } from './topic-writing.service';
import { writingTestDb } from '../../test/writing-test-db';
import type { NoteReviewDraft } from '@terrain/types';
import { Prisma } from '@prisma/client';

const topicId = '051ac96c-5139-41c8-9b05-c74a0447e335';
const plannedId = '8763a040-edea-4ba2-b9bd-79be7ef23e4e';
const sha = (body: string) => createHash('sha256').update(body).digest('hex');
const draft = (body = 'AI clarification'): NoteReviewDraft => ({
  version: 1,
  id: 'ba393504-46ed-4bb0-bbe4-e446cd2f6484',
  topicId,
  kind: 'notes',
  baseRevision: 1,
  baseSha256: sha('Original'),
  body,
  reason: 'Clarify data location',
  sourcesChecked: [],
});
describe('topic writing transactions (real migrated database)', () => {
  let db: any;
  let bridge: any;
  let service: TopicWritingService;
  beforeAll(async () => {
    const test = await writingTestDb();
    db = test.db;
    bridge = test.bridge;
    service = new TopicWritingService(bridge);
    await db.query(
      'INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ($1,$2,$3,$4,now())',
      ['owner', 'owner@example.test', 'synthetic', 'Test learner'],
    );
    await db.query(
      'INSERT INTO "Topic" (id,"userId",title,domain,"topicType",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now()),($7,$2,$8,$4,$5,$9,now())',
      [
        topicId,
        'owner',
        'Started lesson',
        'Web3',
        'concept',
        'active',
        plannedId,
        'Future lesson',
        'planned',
      ],
    );
    await db.query('INSERT INTO "Prompt" (id,"topicId","promptText") VALUES ($1,$2,$3)', [
      'card',
      topicId,
      'Explain it',
    ]);
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  beforeEach(async () => {
    await db.exec(
      'DELETE FROM "TopicWritingRevision"; DELETE FROM "TopicNotes"; DELETE FROM "TopicReference";',
    );
    await db.query('INSERT INTO "TopicNotes" ("topicId",body,"updatedAt") VALUES ($1,$2,now())', [
      topicId,
      'Original',
    ]);
  });
  it('saves the AI version with its receipt/history without changing study or FSRS', async () => {
    const before = await db.query('SELECT to_jsonb(t) AS row FROM "Topic" t ORDER BY id');
    const promptBefore = await db.query('SELECT to_jsonb(p) AS row FROM "Prompt" p');
    const saved = await service.applyReview('owner', draft());
    expect(saved).toMatchObject({ body: 'AI clarification', revision: 2, changed: true });
    const writing = await service.getWriting('owner', topicId, 'notes');
    expect(writing).toMatchObject({ body: 'AI clarification', origin: 'ai', revision: 2 });
    expect(writing.review).not.toBeNull();
    expect(
      (await db.query('SELECT body,actor FROM "TopicWritingRevision" WHERE revision=2')).rows,
    ).toEqual([{ body: 'AI clarification', actor: 'ai' }]);
    expect((await db.query('SELECT to_jsonb(t) AS row FROM "Topic" t ORDER BY id')).rows).toEqual(
      before.rows,
    );
    expect((await db.query('SELECT to_jsonb(p) AS row FROM "Prompt" p')).rows).toEqual(
      promptBefore.rows,
    );
  });
  it('rejects stale revisions and mismatched hashes without overwriting a newer edit', async () => {
    await service.saveNotes('owner', topicId, { body: 'Newer edit', revision: 1 });
    await expect(service.applyReview('owner', draft())).rejects.toBeInstanceOf(ConflictException);
    const bad = { ...draft(), baseRevision: 2 };
    await expect(service.applyReview('owner', bad)).rejects.toBeInstanceOf(ConflictException);
    expect((await service.getWriting('owner', topicId, 'notes')).body).toBe('Newer edit');
  });
  it('returns the original receipt on retry after a later manual edit', async () => {
    const first = await service.applyReview('owner', draft());
    await service.saveNotes('owner', topicId, { body: 'Later edit', revision: 2 });
    expect(await service.applyReview('owner', draft())).toEqual(first);
    expect((await service.getWriting('owner', topicId, 'notes')).body).toBe('Later edit');
    expect(await service.previewReview('owner', draft())).toMatchObject({
      applied: first,
      current: { body: 'Later edit', revision: 3 },
      stale: true,
    });
    await expect(service.applyReview('owner', draft('different payload'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('records a no-change review without incrementing content revision', async () => {
    const before = (await db.query('SELECT * FROM "TopicNotes"')).rows;
    const result = await service.applyReview('owner', draft('Original'));
    expect(result).toMatchObject({ revision: 1, changed: false });
    expect((await db.query('SELECT * FROM "TopicNotes"')).rows).toEqual(before);
    expect((await service.getWriting('owner', topicId, 'notes')).review).not.toBeNull();
  });
  it('hides foreign data and separates future references from personal notes', async () => {
    await expect(service.getWriting('foreign', topicId, 'notes')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.applyReview('foreign', draft())).rejects.toBeInstanceOf(NotFoundException);
    const future = { ...draft(), topicId: plannedId, baseRevision: 0, baseSha256: sha('') };
    await expect(service.applyReview('owner', future)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.applyReview('owner', { ...future, kind: 'reference' }),
    ).resolves.toMatchObject({ revision: 1 });
    expect((await db.query('SELECT count(*)::int AS n FROM "TopicNotes"')).rows[0].n).toBe(1);
  });
  it('rolls back the body when writing its history fails', async () => {
    await db.exec(`CREATE FUNCTION fail_writing_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced history failure'; END $$;
      CREATE TRIGGER fail_writing_history BEFORE INSERT ON "TopicWritingRevision" FOR EACH ROW EXECUTE FUNCTION fail_writing_history();`);
    try {
      await expect(service.applyReview('owner', draft())).rejects.toThrow('forced history failure');
      expect((await db.query('SELECT body FROM "TopicNotes"')).rows[0].body).toBe('Original');
    } finally {
      await db.exec(
        'DROP TRIGGER fail_writing_history ON "TopicWritingRevision"; DROP FUNCTION fail_writing_history();',
      );
    }
  });
  it('allows notes for a recorded partial session without activating the lesson', async () => {
    await db.query('UPDATE "Topic" SET summary=$1 WHERE id=$2', [
      'Partial session; objectives unfinished',
      plannedId,
    ]);
    try {
      const proposal = {
        ...draft(),
        topicId: plannedId,
        baseRevision: 0,
        baseSha256: sha(''),
        body: 'What we actually covered',
      };
      await expect(service.applyReview('owner', proposal)).resolves.toMatchObject({ revision: 1 });
      expect(
        (await db.query('SELECT status FROM "Topic" WHERE id=$1', [plannedId])).rows[0].status,
      ).toBe('planned');
    } finally {
      await db.query('UPDATE "Topic" SET summary=NULL WHERE id=$1', [plannedId]);
    }
  });
  it('exports only the owned note and excludes pending assessment payloads', async () => {
    await db.query(
      'INSERT INTO "SkillCheck" (id,"userId","topicId",plan,"targetTitle","dueOn") VALUES ($1,$2,$3,$4::jsonb,\'Synthetic lesson\',\'2026-10-04\')',
      [
        'pending',
        'owner',
        topicId,
        JSON.stringify({ task: 'HIDDEN-INDEPENDENT-TASK', successCriteria: 'HIDDEN-SOLUTION' }),
      ],
    );
    await db.query(
      'INSERT INTO "TopicNotes" ("topicId",body,"updatedAt") VALUES ($1,\'OTHER-TOPIC-NOTE\',now())',
      [plannedId],
    );
    try {
      const context = await service.reviewContext('owner', topicId);
      expect(context.note).toMatchObject({
        body: 'Original',
        revision: 1,
        sha256: sha('Original'),
      });
      expect(context.pendingIndependentCheck).toBe(true);
      expect(JSON.stringify(context)).not.toMatch(
        /HIDDEN-INDEPENDENT-TASK|HIDDEN-SOLUTION|OTHER-TOPIC-NOTE|passwordHash|synthetic/,
      );
      await expect(service.reviewContext('foreign', topicId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    } finally {
      await db.query('DELETE FROM "SkillCheck" WHERE id=$1', ['pending']);
    }
  });
  it('attributes exact backfill drafts without treating provenance as a review', async () => {
    await db.query(
      `INSERT INTO "TopicWritingRevision" (id,"topicId","ownerId",kind,body,actor,reason,result)
      VALUES ('attribution',$1,'owner','notes','Original','migration','Known AI draft',$2::jsonb)`,
      [topicId, JSON.stringify({ provenance: 'ai-draft', revision: 1, origin: 'ai' })],
    );
    expect(await service.getWriting('owner', topicId, 'notes')).toMatchObject({
      origin: 'ai',
      review: null,
    });
    await service.saveNotes('owner', topicId, { body: 'My edited text', revision: 1 });
    expect(await service.getWriting('owner', topicId, 'notes')).toMatchObject({
      origin: 'learner',
      review: null,
    });
  });
  it('creates a later revision after cleanup removed a personal AI draft but kept its history', async () => {
    await db.query(
      `INSERT INTO "TopicWritingRevision" (id,"topicId","ownerId",kind,revision,body,actor,reason)
      VALUES ('old-draft',$1,'owner','notes',1,'Removed AI future draft','unknown','Historical baseline')`,
      [plannedId],
    );
    await db.query('UPDATE "Topic" SET status=\'active\' WHERE id=$1', [plannedId]);
    try {
      const proposal = {
        ...draft(),
        topicId: plannedId,
        baseRevision: 0,
        baseSha256: sha(''),
        body: 'My actual new lesson notes',
      };
      await expect(service.applyReview('owner', proposal)).resolves.toMatchObject({
        revision: 2,
        body: proposal.body,
      });
      expect(
        (await db.query('SELECT body FROM "TopicWritingRevision" WHERE id=\'old-draft\'')).rows[0]
          .body,
      ).toBe('Removed AI future draft');
    } finally {
      await db.query('UPDATE "Topic" SET status=\'planned\' WHERE id=$1', [plannedId]);
    }
  });
  it('does not reuse a reference review badge for a later content version', async () => {
    const proposal = {
      ...draft(),
      kind: 'reference' as const,
      topicId: plannedId,
      baseRevision: 0,
      baseSha256: sha(''),
    };
    await service.applyReview('owner', proposal);
    expect((await service.getWriting('owner', plannedId, 'reference')).review).not.toBeNull();
    await db.query(
      'UPDATE "TopicReference" SET body=\'Later reference\',revision=2 WHERE "topicId"=$1',
      [plannedId],
    );
    expect((await service.getWriting('owner', plannedId, 'reference')).review).toBeNull();
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM "TopicNotes" WHERE "topicId"=$1', [
          plannedId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  it('resolves a concurrent unique receipt collision after the losing transaction rolled back', async () => {
    const first = await service.applyReview('owner', draft());
    const collisionBridge = {
      ...bridge,
      $transaction: async () => {
        throw new Prisma.PrismaClientKnownRequestError('duplicate receipt', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code: '23505' },
        });
      },
    };
    const collision = new TopicWritingService(collisionBridge);
    expect(await collision.applyReview('owner', draft())).toEqual(first);
    await expect(
      collision.applyReview('owner', draft('different competing proposal')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
