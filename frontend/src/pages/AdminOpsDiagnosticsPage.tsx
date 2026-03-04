/**
 * AdminOpsDiagnosticsPage — Layout shell, data fetching, and state management.
 * Sub-components decomposed into ./admin-ops/
 */

import { AdminErrorState } from "../components/admin/AdminErrorState";
import { PipelineStatusSection } from "./admin-ops/PipelineStatus";
import { IntegrationHealthSection } from "./admin-ops/IntegrationHealth";
import { SupportImpersonation } from "./admin-ops/SupportImpersonation";
import { IncidentResponse } from "./admin-ops/IncidentResponse";
import { useAdminOpsDiagnostics } from "./admin-ops/useAdminOpsDiagnostics";

// Re-export sub-components for backward compatibility
export { PipelineStatusSection, formatDurationMs } from "./admin-ops/PipelineStatus";
export type { PipelineStatusProps } from "./admin-ops/PipelineStatus";
export { IntegrationHealthSection } from "./admin-ops/IntegrationHealth";
export type { IntegrationHealthProps } from "./admin-ops/IntegrationHealth";
export { SupportImpersonation } from "./admin-ops/SupportImpersonation";
export type { SupportImpersonationProps } from "./admin-ops/SupportImpersonation";
export { IncidentResponse } from "./admin-ops/IncidentResponse";
export type { IncidentResponseProps } from "./admin-ops/IncidentResponse";
export { useAdminOpsDiagnostics } from "./admin-ops/useAdminOpsDiagnostics";

export function AdminOpsDiagnosticsPage() {
  const ops = useAdminOpsDiagnostics();

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Ops Diagnostics</h1>
        <button className="btn btn--secondary" onClick={ops.load}>
          Refresh
        </button>
      </header>

      {ops.loading && <div role="status" aria-live="polite">Loading diagnostics...</div>}
      {ops.error && (
        <AdminErrorState
          title="Diagnostics Request Failed"
          message={ops.error}
          onRetry={() => void ops.load()}
        />
      )}

      {!ops.loading && ops.data && (
        <>
          <PipelineStatusSection
            data={ops.data}
            pipelineStatus={ops.pipelineStatus}
            drReadiness={ops.drReadiness}
            syntheticHealth={ops.syntheticHealth}
            queueSlo={ops.queueSlo}
            sellerAdoption={ops.sellerAdoption}
            replayObservability={ops.replayObservability}
            backfills={ops.backfills}
            deadLetterRuns={ops.deadLetterRuns}
            replayWindowHours={ops.replayWindowHours}
            setReplayWindowHours={ops.setReplayWindowHours}
            replayProviderFilter={ops.replayProviderFilter}
            setReplayProviderFilter={ops.setReplayProviderFilter}
            replayOutcomeFilter={ops.replayOutcomeFilter}
            setReplayOutcomeFilter={ops.setReplayOutcomeFilter}
            replayRunTypeFilter={ops.replayRunTypeFilter}
            setReplayRunTypeFilter={ops.setReplayRunTypeFilter}
            replayOperatorFilter={ops.replayOperatorFilter}
            setReplayOperatorFilter={ops.setReplayOperatorFilter}
            replayingRunId={ops.replayingRunId}
            backfillProvider={ops.backfillProvider}
            setBackfillProvider={ops.setBackfillProvider}
            backfillStartDate={ops.backfillStartDate}
            setBackfillStartDate={ops.setBackfillStartDate}
            backfillCursor={ops.backfillCursor}
            setBackfillCursor={ops.setBackfillCursor}
            onLoad={ops.load}
            onTriggerBackfill={ops.triggerBackfill}
            onTriggerBackupVerify={ops.triggerBackupVerify}
            onTriggerRestoreValidation={ops.triggerRestoreValidation}
            onReplayRun={ops.replayRun}
          />

          <SupportImpersonation
            supportSessions={ops.supportSessions}
            activeSupportToken={ops.activeSupportToken}
            supportTargetUserId={ops.supportTargetUserId}
            setSupportTargetUserId={ops.setSupportTargetUserId}
            supportReason={ops.supportReason}
            setSupportReason={ops.setSupportReason}
            supportTtlMinutes={ops.supportTtlMinutes}
            setSupportTtlMinutes={ops.setSupportTtlMinutes}
            supportWriteScope={ops.supportWriteScope}
            setSupportWriteScope={ops.setSupportWriteScope}
            startingSupportSession={ops.startingSupportSession}
            revokingSupportSessionId={ops.revokingSupportSessionId}
            onStartSession={ops.startSupportSession}
            onClearSession={ops.clearSupportSession}
            onRevokeSession={ops.revokeSupportSession}
          />

          <IncidentResponse
            incidents={ops.incidents}
            incidentTitle={ops.incidentTitle}
            setIncidentTitle={ops.setIncidentTitle}
            incidentSummary={ops.incidentSummary}
            setIncidentSummary={ops.setIncidentSummary}
            incidentSeverity={ops.incidentSeverity}
            setIncidentSeverity={ops.setIncidentSeverity}
            creatingIncident={ops.creatingIncident}
            incidentUpdateText={ops.incidentUpdateText}
            setIncidentUpdateText={ops.setIncidentUpdateText}
            incidentUpdateStatus={ops.incidentUpdateStatus}
            setIncidentUpdateStatus={ops.setIncidentUpdateStatus}
            updatingIncidentId={ops.updatingIncidentId}
            onSubmitIncident={ops.submitIncident}
            onSubmitIncidentUpdate={ops.submitIncidentUpdate}
          />

          <IntegrationHealthSection
            integrationHealth={ops.integrationHealth}
            data={ops.data}
          />
        </>
      )}
    </div>
  );
}
