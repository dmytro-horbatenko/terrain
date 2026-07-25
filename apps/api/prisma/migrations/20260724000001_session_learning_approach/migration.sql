CREATE TYPE "LearningApproach" AS ENUM ('guided', 'source_first');
ALTER TABLE "SessionExport" ADD COLUMN "approach" "LearningApproach";
