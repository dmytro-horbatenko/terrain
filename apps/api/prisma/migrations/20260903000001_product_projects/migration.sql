-- Additive: existing study, review and topic records are unchanged.
CREATE TABLE "ProjectProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "repositoryUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectProgress_userId_projectKey_key" ON "ProjectProgress"("userId", "projectKey");
ALTER TABLE "ProjectProgress" ADD CONSTRAINT "ProjectProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectCheckpoint" (
    "id" TEXT NOT NULL,
    "projectProgressId" TEXT NOT NULL,
    "milestoneKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectCheckpoint_projectProgressId_milestoneKey_createdAt_idx" ON "ProjectCheckpoint"("projectProgressId", "milestoneKey", "createdAt");
CREATE UNIQUE INDEX "ProjectCheckpoint_projectProgressId_revision_key" ON "ProjectCheckpoint"("projectProgressId", "revision");
ALTER TABLE "ProjectCheckpoint" ADD CONSTRAINT "ProjectCheckpoint_projectProgressId_fkey" FOREIGN KEY ("projectProgressId") REFERENCES "ProjectProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
