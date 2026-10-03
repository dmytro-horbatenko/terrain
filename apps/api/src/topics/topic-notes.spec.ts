import { TopicWritingService } from '../topic-writing/topic-writing.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { writingTestDb } from '../../test/writing-test-db';

describe('learner-owned topic notes', () => {
  let db: any;
  let service: TopicsService;
  beforeAll(async () => {
    const test = await writingTestDb();
    db = test.db;
    service = new TopicsService(test.bridge, {} as any, new TopicWritingService(test.bridge));
    await db.exec(`INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('user-a','a@example.test','synthetic','Test learner',now());
      INSERT INTO "Topic" (id,"userId",title,domain,"topicType",status,"updatedAt") VALUES ('topic-a','user-a','Example','Web3','concept','active',now());`);
  }, 30000);
  beforeEach(async () => {
    await db.exec('DELETE FROM "TopicWritingRevision"; DELETE FROM "TopicNotes";');
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  it('starts empty and preserves exact learner text independently of the AI summary', async () => {
    expect(await service.getNotes('user-a', 'topic-a')).toEqual({
      body: '',
      revision: 0,
      updatedAt: null,
    });
    const saved = await service.saveNotes('user-a', 'topic-a', {
      body: '# My explanation\n\n  code\n',
      revision: 0,
    });
    expect(saved.body).toBe('# My explanation\n\n  code\n');
    expect(saved.revision).toBe(1);
    expect(await service.getNotes('user-a', 'topic-a')).toEqual(saved);
  });
  it('rejects stale first saves and stale edits without overwriting either device', async () => {
    await service.saveNotes('user-a', 'topic-a', { body: 'Device A', revision: 0 });
    await expect(
      service.saveNotes('user-a', 'topic-a', { body: 'Device B stale', revision: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.saveNotes('user-a', 'topic-a', { body: 'Device A updated', revision: 1 });
    await expect(
      service.saveNotes('user-a', 'topic-a', { body: 'Device B stale', revision: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.getNotes('user-a', 'topic-a')).body).toBe('Device A updated');
  });
  it('does not create a note for an unknown nonzero revision', async () => {
    await expect(
      service.saveNotes('user-a', 'topic-a', { body: 'Stale deleted note', revision: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await db.query('SELECT * FROM "TopicNotes"')).rows).toEqual([]);
  });
  it('hides another learner’s notes and rejects writes', async () => {
    await expect(service.getNotes('user-b', 'topic-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.saveNotes('user-b', 'topic-a', { body: 'Intrusion', revision: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await db.query('SELECT * FROM "TopicNotes"')).rows).toEqual([]);
  });
});
