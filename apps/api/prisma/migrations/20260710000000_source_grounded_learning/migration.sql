-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "allowPaidSources" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredSourceFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceLanguage" TEXT,
ADD COLUMN     "sourceTimeBudgetMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "sourcePlan" JSONB;

-- CreateTable
CREATE TABLE "SourceEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sessionExportId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "mainClaim" TEXT NOT NULL,
    "supportingMechanism" TEXT NOT NULL,
    "openQuestion" TEXT,
    "substitutionReason" TEXT,
    "verifiedLiveAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceEvidence_topicId_createdAt_idx" ON "SourceEvidence"("topicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvidence_sessionExportId_topicId_requirementId_key" ON "SourceEvidence"("sessionExportId", "topicId", "requirementId");

-- AddForeignKey
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_sessionExportId_fkey" FOREIGN KEY ("sessionExportId") REFERENCES "SessionExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
