CREATE TABLE "TopicReference" (
  "topicId" TEXT PRIMARY KEY,
  "body" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "source" TEXT,
  "reviewedRevision" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "sourcesChecked" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopicReference_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "TopicWritingRevision" (
  "id" TEXT PRIMARY KEY,
  "topicId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('notes','reference')),
  "revision" INTEGER,
  "body" TEXT NOT NULL,
  "actor" TEXT NOT NULL CHECK ("actor" IN ('learner','ai','migration','unknown')),
  "reason" TEXT NOT NULL,
  "reviewId" TEXT,
  "payloadSha256" TEXT,
  "sourcesChecked" JSONB NOT NULL DEFAULT '[]',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TopicWritingRevision_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TopicWritingRevision_topicId_kind_revision_key" ON "TopicWritingRevision"("topicId","kind","revision");
CREATE UNIQUE INDEX "TopicWritingRevision_ownerId_reviewId_key" ON "TopicWritingRevision"("ownerId","reviewId");
CREATE INDEX "TopicWritingRevision_topicId_kind_createdAt_idx" ON "TopicWritingRevision"("topicId","kind","createdAt");
INSERT INTO "TopicWritingRevision" ("id","topicId","ownerId","kind","revision","body","actor","reason","createdAt")
SELECT 'baseline:' || n."topicId", n."topicId", t."userId", 'notes', n."revision", n."body", 'unknown', 'Existing note; origin was not recorded', n."updatedAt"
FROM "TopicNotes" n JOIN "Topic" t ON t."id"=n."topicId";
