import { useEffect, useMemo, useState } from "react";
import {
  createSettingsIntegrationLinkToken,
  completeSettingsIntegrationLink,
  disconnectSettingsIntegration,
  getSettingsIntegrations,
  setSettingsIntegrationPolling,
  syncSettingsIntegration,
  type IntegrationSettingsRow,
} from "../lib/api";
import { useToast } from "../components/Toast";
import { AdminErrorState } from "../components/admin/AdminErrorState";
import { MergeLinkModal } from "../components/MergeLinkModal";

type MergeLinkCategory = "crm" | "filestorage";

interface PendingLinkState {
  category: MergeLinkCategory;
  linkToken: string;
}

function formatIntegrationLabel(slug: string): string {
  return slug
    .split(/[_-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

interface IntegrationSectionProps {
  title: string;
  description: string;
  connectLabel: string;
  category: "CRM" | "RECORDING";
  rows: IntegrationSettingsRow[];
  busyIds: Set<string>;
  onConnect: (category: MergeLinkCategory) => Promise<void>;
  onSync: (row: IntegrationSettingsRow) => Promise<void>;
  onTogglePolling: (row: IntegrationSettingsRow) => Promise<void>;
  onDisconnect: (row: IntegrationSettingsRow) => Promise<void>;
}

function IntegrationSection({
  title,
  description,
  connectLabel,
  category,
  rows,
  busyIds,
  onConnect,
  onSync,
  onTogglePolling,
  onDisconnect,
}: IntegrationSectionProps) {
  return (
    <section className="card card--elevated">
      <div className="card__header">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__subtitle">{description}</div>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => void onConnect(category === "CRM" ? "crm" : "filestorage")}
        >
          {connectLabel}
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
          No {category === "CRM" ? "CRM" : "recording"} integrations connected yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((row) => {
            const isBusy = busyIds.has(row.id);
            const isActive = row.status === "ACTIVE";
            return (
              <div
                key={row.id}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  padding: "0.85rem 0.9rem",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ fontWeight: 600 }}>{formatIntegrationLabel(row.integration)}</div>
                  <span
                    className={`badge ${
                      row.status === "ACTIVE"
                        ? "badge--success"
                        : row.status === "PAUSED"
                          ? "badge--draft"
                          : "badge--error"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  Last synced: {formatTimestamp(row.last_synced_at)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={isBusy}
                    onClick={() => void onSync(row)}
                  >
                    {isBusy ? "Working..." : "Sync"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={isBusy}
                    onClick={() => void onTogglePolling(row)}
                  >
                    {isActive ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={isBusy}
                    onClick={() => void onDisconnect(row)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeConfigured, setMergeConfigured] = useState(true);
  const [integrations, setIntegrations] = useState<IntegrationSettingsRow[]>([]);
  const [pendingLink, setPendingLink] = useState<PendingLinkState | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  const crmRows = useMemo(
    () => integrations.filter((row) => row.category === "CRM"),
    [integrations]
  );
  const recordingRows = useMemo(
    () => integrations.filter((row) => row.category === "RECORDING"),
    [integrations]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getSettingsIntegrations();
      setIntegrations(response.integrations);
      setMergeConfigured(response.merge_configured);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const withBusyIntegration = async (integrationId: string, fn: () => Promise<void>) => {
    setBusyIds((current) => new Set(current).add(integrationId));
    try {
      await fn();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(integrationId);
        return next;
      });
    }
  };

  const handleConnect = async (category: MergeLinkCategory) => {
    setError(null);
    try {
      const result = await createSettingsIntegrationLinkToken({ category });
      setPendingLink({
        category,
        linkToken: result.link_token,
      });
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Failed to initialize Merge Link.");
    }
  };

  const handleComplete = async (publicToken: string) => {
    if (!pendingLink) return;
    const result = await completeSettingsIntegrationLink({
      public_token: publicToken,
      category: pendingLink.category,
    });
    const providerLabel = formatIntegrationLabel(result.integration.integration);
    showToast(`${providerLabel} connected successfully`, "success");
    await load();
  };

  const handleSync = async (row: IntegrationSettingsRow) => {
    await withBusyIntegration(row.id, async () => {
      await syncSettingsIntegration(row.id);
      showToast(`Sync started for ${formatIntegrationLabel(row.integration)}`, "success");
      await load();
    });
  };

  const handleTogglePolling = async (row: IntegrationSettingsRow) => {
    await withBusyIntegration(row.id, async () => {
      const enablePolling = row.status !== "ACTIVE";
      await setSettingsIntegrationPolling(row.id, enablePolling);
      showToast(enablePolling ? "Integration resumed" : "Integration paused", "success");
      await load();
    });
  };

  const handleDisconnect = async (row: IntegrationSettingsRow) => {
    const approved = window.confirm(
      `Disconnect ${formatIntegrationLabel(row.integration)}? This will stop future syncs.`
    );
    if (!approved) return;

    await withBusyIntegration(row.id, async () => {
      await disconnectSettingsIntegration(row.id);
      showToast("Integration disconnected", "success");
      await load();
    });
  };

  if (loading) {
    return (
      <div className="page">
        <div className="card card--elevated">Loading integrations...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Integrations</h1>
          <p className="page__subtitle">
            Connect your CRM and call recording providers through Merge.dev.
          </p>
        </div>
      </div>

      {error && (
        <AdminErrorState
          title="Integrations Error"
          message={error}
          onRetry={() => void load()}
        />
      )}

      {!mergeConfigured && (
        <div className="card card--elevated" style={{ borderColor: "var(--color-warning)" }}>
          Merge.dev is not configured for this environment. Set `MERGE_API_KEY` before connecting providers.
        </div>
      )}

      <IntegrationSection
        title="CRM Connections"
        description="Connect Salesforce or HubSpot to power account resolution and CRM-linked insights."
        connectLabel="+ Connect CRM"
        category="CRM"
        rows={crmRows}
        busyIds={busyIds}
        onConnect={handleConnect}
        onSync={handleSync}
        onTogglePolling={handleTogglePolling}
        onDisconnect={handleDisconnect}
      />

      <IntegrationSection
        title="Call Recording Connections"
        description="Connect recording providers such as Gong, Chorus, or Zoom through Merge.dev."
        connectLabel="+ Connect Recording Provider"
        category="RECORDING"
        rows={recordingRows}
        busyIds={busyIds}
        onConnect={handleConnect}
        onSync={handleSync}
        onTogglePolling={handleTogglePolling}
        onDisconnect={handleDisconnect}
      />

      <MergeLinkModal
        open={Boolean(pendingLink)}
        title={
          pendingLink?.category === "crm"
            ? "Connect CRM via Merge Link"
            : "Connect Recording Provider via Merge Link"
        }
        linkToken={pendingLink?.linkToken ?? null}
        onClose={() => setPendingLink(null)}
        onComplete={handleComplete}
      />
    </div>
  );
}
