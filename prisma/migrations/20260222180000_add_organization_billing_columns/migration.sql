-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('METERED', 'PER_SEAT', 'METERED_PLUS_SEAT');

-- CreateEnum
CREATE TYPE "BillingChannel" AS ENUM ('SELF_SERVE', 'SALES_LED');

-- AlterTable
ALTER TABLE "organizations"
  ADD COLUMN "pricingModel" "PricingModel" NOT NULL DEFAULT 'METERED',
  ADD COLUMN "billingChannel" "BillingChannel" NOT NULL DEFAULT 'SELF_SERVE',
  ADD COLUMN "billingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seatLimit" INTEGER,
  ADD COLUMN "contractEndsAt" TIMESTAMP(3);
