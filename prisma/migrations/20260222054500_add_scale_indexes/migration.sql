-- Scale-path indexing for transcript/story/analytics heavy routes

CREATE INDEX IF NOT EXISTS "stories_organizationId_generatedAt_idx"
  ON "stories"("organizationId", "generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "high_value_quotes_storyId_metricType_idx"
  ON "high_value_quotes"("storyId", "metricType");

CREATE INDEX IF NOT EXISTS "transcript_chunks_transcriptId_startMs_idx"
  ON "transcript_chunks"("transcriptId", "startMs");

CREATE INDEX IF NOT EXISTS "landing_pages_organizationId_updatedAt_idx"
  ON "landing_pages"("organizationId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "integration_runs_organizationId_runType_startedAt_idx"
  ON "integration_runs"("organizationId", "runType", "startedAt" DESC);
