-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "disabledDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
