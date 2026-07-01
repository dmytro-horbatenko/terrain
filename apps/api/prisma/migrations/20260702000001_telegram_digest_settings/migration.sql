-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "digestHour" INTEGER DEFAULT 9,
ADD COLUMN "nudgeHour" INTEGER DEFAULT 20,
ADD COLUMN "telegramLinkToken" TEXT,
ADD COLUMN "telegramLinkTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_telegramLinkToken_key" ON "Settings"("telegramLinkToken");
