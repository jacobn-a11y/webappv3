-- Support-safe impersonation sessions for internal admin troubleshooting.
CREATE TABLE "support_impersonation_sessions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "target_user_id" TEXT NOT NULL,
  "revoked_by_user_id" TEXT,
  "session_token_hash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "scope" JSONB,
  "last_used_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_impersonation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_impersonation_sessions_session_token_hash_key"
  ON "support_impersonation_sessions"("session_token_hash");

CREATE INDEX "support_impersonation_sessions_organization_id_actor_user_id_revoked_at_idx"
  ON "support_impersonation_sessions"("organization_id", "actor_user_id", "revoked_at");

CREATE INDEX "support_impersonation_sessions_organization_id_target_user_id_revoked_at_idx"
  ON "support_impersonation_sessions"("organization_id", "target_user_id", "revoked_at");

CREATE INDEX "support_impersonation_sessions_organization_id_expires_at_idx"
  ON "support_impersonation_sessions"("organization_id", "expires_at");

ALTER TABLE "support_impersonation_sessions"
  ADD CONSTRAINT "support_impersonation_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_impersonation_sessions"
  ADD CONSTRAINT "support_impersonation_sessions_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_impersonation_sessions"
  ADD CONSTRAINT "support_impersonation_sessions_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_impersonation_sessions"
  ADD CONSTRAINT "support_impersonation_sessions_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
