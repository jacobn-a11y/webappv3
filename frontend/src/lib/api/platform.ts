import type { PlatformSettings, SupportAccountInfo, TenantOverview } from "../api";
import { request } from "./http";

export async function getPlatformSettings(): Promise<PlatformSettings> {
  return request<PlatformSettings>("/platform/settings");
}

export async function updatePlatformSettings(
  data: Partial<PlatformSettings>
): Promise<PlatformSettings> {
  return request<PlatformSettings>("/platform/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getPlatformTenants(): Promise<{ tenants: TenantOverview[] }> {
  return request<{ tenants: TenantOverview[] }>("/platform/tenants");
}

export async function approveTenantDeletion(orgId: string): Promise<void> {
  await request<void>(`/platform/tenants/${orgId}/deletion/approve`, { method: "POST" });
}

export async function rejectTenantDeletion(orgId: string): Promise<void> {
  await request<void>(`/platform/tenants/${orgId}/deletion/reject`, { method: "POST" });
}

export async function getSupportAccountInfo(): Promise<SupportAccountInfo> {
  return request<SupportAccountInfo>("/dashboard/support-account");
}

export async function optOutSupportAccount(): Promise<void> {
  await request<void>("/dashboard/support-account/opt-out", { method: "POST" });
}

export async function optInSupportAccount(): Promise<void> {
  await request<void>("/dashboard/support-account/opt-in", { method: "POST" });
}

export async function requestAccountDeletion(reason?: string): Promise<void> {
  await request<void>("/dashboard/account/request-deletion", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function cancelAccountDeletion(): Promise<void> {
  await request<void>("/dashboard/account/cancel-deletion", { method: "POST" });
}

export async function getAccountDeletionStatus(): Promise<{
  has_request: boolean;
  status: string | null;
  scheduled_delete_at: string | null;
  created_at: string | null;
}> {
  return request<{
    has_request: boolean;
    status: string | null;
    scheduled_delete_at: string | null;
    created_at: string | null;
  }>("/dashboard/account/deletion-status");
}
