import type { Request } from "express";

export interface TenantRequest extends Request {
  organizationId?: string;
  userId?: string;
}

export class TenantGuardError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "TenantGuardError";
    this.statusCode = statusCode;
  }
}

export function getOrganizationIdOrThrow(req: Request): string {
  const organizationId = (req as TenantRequest).organizationId;
  if (!organizationId) {
    throw new TenantGuardError("Authentication required", 401);
  }
  return organizationId;
}

export function assertSameOrganization(
  requestOrganizationId: string,
  resourceOrganizationId: string
): void {
  if (requestOrganizationId !== resourceOrganizationId) {
    throw new TenantGuardError("Cross-tenant access denied", 403);
  }
}

