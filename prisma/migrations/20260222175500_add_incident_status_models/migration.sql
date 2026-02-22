CREATE TABLE "incidents" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "incident_updates" (
  "id" TEXT NOT NULL,
  "incident_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT,
  "metadata" JSONB,
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incidents_organization_id_status_started_at_idx"
  ON "incidents"("organization_id", "status", "started_at");
CREATE INDEX "incidents_organization_id_severity_started_at_idx"
  ON "incidents"("organization_id", "severity", "started_at");
CREATE INDEX "incident_updates_organization_id_created_at_idx"
  ON "incident_updates"("organization_id", "created_at");
CREATE INDEX "incident_updates_incident_id_created_at_idx"
  ON "incident_updates"("incident_id", "created_at");

ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incident_updates"
  ADD CONSTRAINT "incident_updates_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "incident_updates"
  ADD CONSTRAINT "incident_updates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
