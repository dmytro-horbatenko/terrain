-- Explicit study order for prepared curricula; existing custom topics keep chronological order.
ALTER TABLE "Topic" ADD COLUMN "curriculumOrder" INTEGER;
