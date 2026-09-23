CREATE TABLE "SkillCheck" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "topicId" TEXT,
  "projectKey" TEXT,
  "milestoneKey" TEXT,
  "targetTitle" TEXT NOT NULL,
  "dueOn" DATE NOT NULL,
  "plan" JSONB NOT NULL,
  "attempt" JSONB,
  "attemptedAt" TIMESTAMP(3),
  "result" JSONB,
  "assessedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillCheck_target_check" CHECK (
    ("topicId" IS NOT NULL AND "projectKey" IS NULL AND "milestoneKey" IS NULL) OR
    ("topicId" IS NULL AND "projectKey" IS NOT NULL AND "milestoneKey" IS NOT NULL)
  ),
  CONSTRAINT "SkillCheck_attempt_check" CHECK (("attempt" IS NULL) = ("attemptedAt" IS NULL)),
  CONSTRAINT "SkillCheck_result_check" CHECK (
    ("result" IS NULL) = ("assessedAt" IS NULL) AND
    ("result" IS NULL OR "attemptedAt" IS NOT NULL)
  ),
  CONSTRAINT "SkillCheck_cancel_check" CHECK ("cancelledAt" IS NULL OR "attemptedAt" IS NULL),
  CONSTRAINT "SkillCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillCheck_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SkillCheck_userId_dueOn_idx" ON "SkillCheck"("userId", "dueOn");
CREATE INDEX "SkillCheck_topicId_idx" ON "SkillCheck"("topicId");
