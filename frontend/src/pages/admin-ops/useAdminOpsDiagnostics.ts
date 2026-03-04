import { useEffect, useState } from "react";
import {
  addIncidentUpdate,
  createIncident,
  getDrReadiness,
  getIncidents,
  getIntegrationHealth,
  getIntegrationBackfills,
  getIntegrationDeadLetterRuns,
  getOpsDiagnostics,
  getPipelineStatus,
  getQueueSloMetrics,
  getReplayObservability,
  getSellerAdoptionMetrics,
  getSyntheticHealth,
  getSupportImpersonationSessions,
  runBackupVerification,
  runRestoreValidation,
  replayDeadLetterRun,
  revokeSupportImpersonationSession,
  setSupportImpersonationToken,
  readSupportImpersonationToken,
  startSupportImpersonation,
  triggerIntegrationBackfill,
  type BackfillRun,
  type DeadLetterRun,
  type DrReadiness,
  type IntegrationHealthRow,
  type IncidentRow,
  type OpsDiagnostics,
  type PipelineStatus,
  type QueueSloMetrics,
  type ReplayObservability,
  type SellerAdoptionMetrics,
  type SupportImpersonationSession,
  type SyntheticHealth,
} from "../../lib/api";

export function useAdminOpsDiagnostics() {
  const [data, setData] = useState<OpsDiagnostics | null>(null);
  const [deadLetterRuns, setDeadLetterRuns] = useState<DeadLetterRun[]>([]);
  const [backfills, setBackfills] = useState<BackfillRun[]>([]);
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealthRow[]>([]);
  const [queueSlo, setQueueSlo] = useState<QueueSloMetrics | null>(null);
  const [replayObservability, setReplayObservability] = useState<ReplayObservability | null>(null);
  const [sellerAdoption, setSellerAdoption] = useState<SellerAdoptionMetrics | null>(null);
  const [syntheticHealth, setSyntheticHealth] = useState<SyntheticHealth | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [drReadiness, setDrReadiness] = useState<DrReadiness | null>(null);
  const [supportSessions, setSupportSessions] = useState<SupportImpersonationSession[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [backfillProvider, setBackfillProvider] = useState("GONG");
  const [backfillStartDate, setBackfillStartDate] = useState("");
  const [backfillCursor, setBackfillCursor] = useState("");
  const [supportTargetUserId, setSupportTargetUserId] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [supportTtlMinutes, setSupportTtlMinutes] = useState(30);
  const [supportWriteScope, setSupportWriteScope] = useState(false);
  const [startingSupportSession, setStartingSupportSession] = useState(false);
  const [revokingSupportSessionId, setRevokingSupportSessionId] = useState<string | null>(null);
  const [activeSupportToken, setActiveSupportToken] = useState<string | null>(readSupportImpersonationToken());
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [creatingIncident, setCreatingIncident] = useState(false);
  const [incidentUpdateText, setIncidentUpdateText] = useState<Record<string, string>>({});
  const [incidentUpdateStatus, setIncidentUpdateStatus] = useState<Record<string, "OPEN" | "MONITORING" | "RESOLVED" | "">>({});
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(null);
  const [replayWindowHours, setReplayWindowHours] = useState(24);
  const [replayProviderFilter, setReplayProviderFilter] = useState("");
  const [replayOutcomeFilter, setReplayOutcomeFilter] = useState("");
  const [replayRunTypeFilter, setReplayRunTypeFilter] = useState("");
  const [replayOperatorFilter, setReplayOperatorFilter] = useState("");
  const [replayingRunId, setReplayingRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const replayOutcome =
        replayOutcomeFilter === "" ? undefined : (
          replayOutcomeFilter as "COMPLETED" | "FAILED" | "RUNNING" | "PENDING"
        );
      const replayRunType =
        replayRunTypeFilter === "" ? undefined : (
          replayRunTypeFilter as "SYNC" | "BACKFILL" | "MANUAL" | "REPLAY"
        );

      const [
        res,
        dlq,
        backfillRes,
        healthRes,
        queueSloRes,
        replayRes,
        sellerAdoptionRes,
        syntheticHealthRes,
        pipelineRes,
        drRes,
        supportRes,
        incidentRes,
      ] = await Promise.all([
        getOpsDiagnostics(),
        getIntegrationDeadLetterRuns({ limit: 100 }),
        getIntegrationBackfills({ limit: 100 }),
        getIntegrationHealth(),
        getQueueSloMetrics(),
        getReplayObservability({
          window_hours: replayWindowHours,
          provider: replayProviderFilter || undefined,
          outcome: replayOutcome,
          run_type: replayRunType,
          operator_user_id: replayOperatorFilter || undefined,
          limit: 50,
        }),
        getSellerAdoptionMetrics(30),
        getSyntheticHealth(),
        getPipelineStatus(),
        getDrReadiness(),
        getSupportImpersonationSessions(),
        getIncidents(),
      ]);
      setData(res);
      setDeadLetterRuns(dlq.failed_runs);
      setBackfills(backfillRes.backfills);
      setIntegrationHealth(healthRes.integrations);
      setQueueSlo(queueSloRes);
      setReplayObservability(replayRes);
      setSellerAdoption(sellerAdoptionRes);
      setSyntheticHealth(syntheticHealthRes);
      setPipelineStatus(pipelineRes);
      setDrReadiness(drRes);
      setSupportSessions(supportRes.sessions);
      setIncidents(incidentRes.incidents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  };

  const triggerBackfill = async () => {
    setError(null);
    try {
      await triggerIntegrationBackfill({
        provider: backfillProvider as "GRAIN" | "GONG" | "SALESFORCE" | "MERGE_DEV",
        start_date: backfillStartDate
          ? new Date(backfillStartDate).toISOString()
          : undefined,
        cursor: backfillCursor || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger backfill");
    }
  };

  const replayRun = async (runId: string) => {
    setReplayingRunId(runId);
    setError(null);
    try {
      await replayDeadLetterRun(runId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replay run");
    } finally {
      setReplayingRunId(null);
    }
  };

  const triggerBackupVerify = async () => {
    setError(null);
    try {
      await runBackupVerification();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify backup");
    }
  };

  const triggerRestoreValidation = async () => {
    setError(null);
    try {
      await runRestoreValidation();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate restore");
    }
  };

  const startSupportSession = async () => {
    if (!supportTargetUserId.trim()) {
      setError("Target user ID is required to start support impersonation.");
      return;
    }
    if (!supportReason.trim()) {
      setError("A reason is required for support impersonation.");
      return;
    }
    setStartingSupportSession(true);
    setError(null);
    try {
      const created = await startSupportImpersonation({
        target_user_id: supportTargetUserId.trim(),
        reason: supportReason.trim(),
        ttl_minutes: supportTtlMinutes,
        scope: supportWriteScope ? ["READ_ONLY", "WRITE"] : ["READ_ONLY"],
      });
      setSupportImpersonationToken(created.support_impersonation_token);
      setActiveSupportToken(created.support_impersonation_token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start support impersonation");
    } finally {
      setStartingSupportSession(false);
    }
  };

  const clearSupportSession = async () => {
    setSupportImpersonationToken(null);
    setActiveSupportToken(null);
    await load();
  };

  const revokeSupportSession = async (sessionId: string) => {
    setRevokingSupportSessionId(sessionId);
    setError(null);
    try {
      await revokeSupportImpersonationSession(sessionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke support impersonation session");
    } finally {
      setRevokingSupportSessionId(null);
    }
  };

  const submitIncident = async () => {
    if (!incidentTitle.trim() || !incidentSummary.trim()) {
      setError("Incident title and summary are required.");
      return;
    }
    setCreatingIncident(true);
    setError(null);
    try {
      await createIncident({
        title: incidentTitle.trim(),
        summary: incidentSummary.trim(),
        severity: incidentSeverity,
      });
      setIncidentTitle("");
      setIncidentSummary("");
      setIncidentSeverity("MEDIUM");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incident");
    } finally {
      setCreatingIncident(false);
    }
  };

  const submitIncidentUpdate = async (incidentId: string) => {
    const message = incidentUpdateText[incidentId]?.trim() ?? "";
    if (!message) {
      setError("Incident update message is required.");
      return;
    }
    setUpdatingIncidentId(incidentId);
    setError(null);
    try {
      await addIncidentUpdate(incidentId, {
        message,
        status: incidentUpdateStatus[incidentId] || undefined,
      });
      setIncidentUpdateText((prev) => ({ ...prev, [incidentId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add incident update");
    } finally {
      setUpdatingIncidentId(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return {
    // Core data
    data,
    loading,
    error,
    load,

    // Pipeline & observability
    pipelineStatus,
    drReadiness,
    syntheticHealth,
    queueSlo,
    sellerAdoption,
    replayObservability,
    backfills,
    deadLetterRuns,

    // Replay filters
    replayWindowHours,
    setReplayWindowHours,
    replayProviderFilter,
    setReplayProviderFilter,
    replayOutcomeFilter,
    setReplayOutcomeFilter,
    replayRunTypeFilter,
    setReplayRunTypeFilter,
    replayOperatorFilter,
    setReplayOperatorFilter,
    replayingRunId,

    // Backfill controls
    backfillProvider,
    setBackfillProvider,
    backfillStartDate,
    setBackfillStartDate,
    backfillCursor,
    setBackfillCursor,
    triggerBackfill,
    triggerBackupVerify,
    triggerRestoreValidation,
    replayRun,

    // Integration health
    integrationHealth,

    // Support impersonation
    supportSessions,
    activeSupportToken,
    supportTargetUserId,
    setSupportTargetUserId,
    supportReason,
    setSupportReason,
    supportTtlMinutes,
    setSupportTtlMinutes,
    supportWriteScope,
    setSupportWriteScope,
    startingSupportSession,
    revokingSupportSessionId,
    startSupportSession,
    clearSupportSession,
    revokeSupportSession,

    // Incident response
    incidents,
    incidentTitle,
    setIncidentTitle,
    incidentSummary,
    setIncidentSummary,
    incidentSeverity,
    setIncidentSeverity,
    creatingIncident,
    incidentUpdateText,
    setIncidentUpdateText,
    incidentUpdateStatus,
    setIncidentUpdateStatus,
    updatingIncidentId,
    submitIncident,
    submitIncidentUpdate,
  };
}
