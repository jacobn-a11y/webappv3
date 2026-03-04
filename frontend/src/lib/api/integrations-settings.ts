import { request } from "./http";
import type {
  IntegrationCompleteLinkResponse,
  IntegrationLinkTokenResponse,
  IntegrationSettingsListResponse,
} from "./types";

export async function getSettingsIntegrations(): Promise<IntegrationSettingsListResponse> {
  return request<IntegrationSettingsListResponse>("/settings/integrations");
}

export async function createSettingsIntegrationLinkToken(body: {
  category: "crm" | "filestorage";
}): Promise<IntegrationLinkTokenResponse> {
  return request<IntegrationLinkTokenResponse>("/settings/integrations/link-token", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function completeSettingsIntegrationLink(body: {
  public_token: string;
  category?: "crm" | "filestorage";
}): Promise<IntegrationCompleteLinkResponse> {
  return request<IntegrationCompleteLinkResponse>("/settings/integrations/complete-link", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function syncSettingsIntegration(integrationId: string): Promise<{
  syncing: boolean;
  integration_id: string;
}> {
  return request<{ syncing: boolean; integration_id: string }>(
    `/settings/integrations/${integrationId}/sync`,
    { method: "POST" }
  );
}

export async function setSettingsIntegrationPolling(
  integrationId: string,
  enabled: boolean
): Promise<{ updated: boolean; polling_enabled: boolean }> {
  return request<{ updated: boolean; polling_enabled: boolean }>(
    `/settings/integrations/${integrationId}/polling`,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }
  );
}

export async function disconnectSettingsIntegration(
  integrationId: string
): Promise<{ disconnected: boolean }> {
  return request<{ disconnected: boolean }>(`/settings/integrations/${integrationId}`, {
    method: "DELETE",
  });
}
