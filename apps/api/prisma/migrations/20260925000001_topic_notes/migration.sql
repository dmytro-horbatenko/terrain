CREATE TABLE "TopicNotes" (
    "topicId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicNotes_pkey" PRIMARY KEY ("topicId"),
    CONSTRAINT "TopicNotes_revision_positive" CHECK ("revision" > 0)
);

ALTER TABLE "TopicNotes" ADD CONSTRAINT "TopicNotes_topicId_fkey"
    FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
