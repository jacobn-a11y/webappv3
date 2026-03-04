import type {
  BackfillRun,
  DeadLetterRun,
  IntegrationHealthRow,
} from "./types";
import { request } from "./http";

export async function getIntegrationHealth(): Promise<{
  integrations: IntegrationHealthRow[];
}> {
  return request<{ integrations: IntegrationHealthRow[] }>(
    "/dashboard/integrations/health"
  );
}

export async function getIntegrationDeadLetterRuns(params?: {
  limit?: number;
  provider?: string;
}): Promise<{ failed_runs: DeadLetterRun[]; total_failed: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.provider) qs.set("provider", params.provider);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ failed_runs: DeadLetterRun[]; total_failed: number }>(
    `/integrations/ops/dead-letter${suffix}`
  );
}

export async function replayDeadLetterRun(runId: string): Promise<void> {
  return request<void>(`/integrations/ops/dead-letter/${runId}/replay`, {
    method: "POST",
  });
}

export async function getIntegrationBackfills(params?: {
  limit?: number;
  provider?: string;
}): Promise<{ backfills: BackfillRun[] }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.provider) qs.set("provider", params.provider);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ backfills: BackfillRun[] }>(`/integrations/ops/backfills${suffix}`);
}

export async function triggerIntegrationBackfill(body: {
  provider: "GRAIN" | "GONG" | "SALESFORCE" | "MERGE_DEV";
  start_date?: string;
  end_date?: string;
  cursor?: string;
  idempotency_key?: string;
}): Promise<void> {
  return request<void>("/integrations/ops/backfills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
