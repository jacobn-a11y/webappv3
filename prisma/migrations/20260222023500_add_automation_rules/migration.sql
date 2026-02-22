-- Self-serve workflow automation rules

DO $$ BEGIN
  CREATE TYPE "AutomationTriggerType" AS ENUM ('THRESHOLD', 'SCHEDULE', 'EVENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AutomationDeliveryType" AS ENUM ('SLACK', 'EMAIL', 'WEBHOOK');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "triggerType" "AutomationTriggerType" NOT NULL,
  "metric" TEXT,
  "operator" TEXT,
  "threshold" DOUBLE PRECISION,
  "scheduleCron" TEXT,
  "eventType" TEXT,
  "deliveryType" "AutomationDeliveryType" NOT NULL,
  "deliveryTarget" TEXT NOT NULL,
  "payloadTemplate" JSONB,
  "lastRunAt" TIMESTAMP(3),
  "lastRunStatus" TEXT,
  "lastRunError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "automation_rules_organizationId_enabled_triggerType_idx"
  ON "automation_rules"("organizationId", "enabled", "triggerType");
