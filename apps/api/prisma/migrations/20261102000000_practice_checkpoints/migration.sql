CREATE TABLE "PracticeProgress" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "topicId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PracticeProgress_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PracticeCheckpoint" (
  "id" TEXT NOT NULL, "progressId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeCheckpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeCheckpoint_status_check" CHECK ("status" IN ('active', 'reference'))
);
CREATE UNIQUE INDEX "PracticeProgress_userId_topicId_key" ON "PracticeProgress"("userId", "topicId");
CREATE INDEX "PracticeProgress_topicId_idx" ON "PracticeProgress"("topicId");
CREATE UNIQUE INDEX "PracticeCheckpoint_progressId_revision_key" ON "PracticeCheckpoint"("progressId", "revision");
CREATE INDEX "PracticeCheckpoint_progressId_status_idx" ON "PracticeCheckpoint"("progressId", "status");
ALTER TABLE "PracticeProgress" ADD CONSTRAINT "PracticeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeProgress" ADD CONSTRAINT "PracticeProgress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeCheckpoint" ADD CONSTRAINT "PracticeCheckpoint_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "PracticeProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
