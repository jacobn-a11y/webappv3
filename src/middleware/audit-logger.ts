/**
 * Security Audit Logger
 *
 * Logs security-relevant events for compliance and forensic analysis.
 * Critical for a platform handling customer call recordings — auditors
 * need to trace who accessed, modified, or published sensitive data.
 *
 * Events logged:
 *  - Permission grants/revokes
 *  - Account access changes
 *  - Landing page publish/unpublish
 *  - Authentication failures
 *  - Rate limit hits
 *  - Webhook signature failures
 */

export interface AuditEvent {
  /** ISO timestamp */
  timestamp: string;
  /** Event category */
  category:
    | "AUTH"
    | "PERMISSION"
    | "ACCESS_CONTROL"
    | "PUBLISH"
    | "WEBHOOK"
    | "RATE_LIMIT"
    | "DATA_ACCESS";
  /** Specific action within the category */
  action: string;
  /** Who performed the action (user ID or "system") */
  actorId: string;
  /** Which organization */
  organizationId: string | null;
  /** Target resource ID (page, user, grant, etc.) */
  targetId: string | null;
  /** Additional context */
  metadata: Record<string, unknown>;
  /** Severity level */
  severity: "INFO" | "WARN" | "CRITICAL";
}

/**
 * Logs a security audit event.
 * In production, this should write to an append-only audit log
 * (e.g., CloudWatch, Datadog, or a dedicated audit table).
 *
 * For now, uses structured JSON logging to stdout.
 */
export function logAuditEvent(event: AuditEvent): void {
  const logEntry = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
    _type: "SECURITY_AUDIT",
  };

  // Use console.log for structured logging (captured by log aggregators)
  console.log(JSON.stringify(logEntry));
}

// ─── Convenience Functions ──────────────────────────────────────────────────

export function auditPermissionChange(
  action: "GRANT" | "REVOKE",
  actorId: string,
  targetUserId: string,
  permission: string,
  organizationId: string
): void {
  logAuditEvent({
    timestamp: new Date().toISOString(),
    category: "PERMISSION",
    action: `PERMISSION_${action}`,
    actorId,
    organizationId,
    targetId: targetUserId,
    metadata: { permission },
    severity: "WARN",
  });
}

export function auditAccessChange(
  action: "GRANT" | "REVOKE",
  actorId: string,
  targetUserId: string,
  scopeType: string,
  organizationId: string,
  grantId?: string
): void {
  logAuditEvent({
    timestamp: new Date().toISOString(),
    category: "ACCESS_CONTROL",
    action: `ACCESS_${action}`,
    actorId,
    organizationId,
    targetId: targetUserId,
    metadata: { scopeType, grantId },
    severity: "WARN",
  });
}

export function auditPublishEvent(
  action: "PUBLISH" | "UNPUBLISH" | "ARCHIVE",
  actorId: string,
  pageId: string,
  organizationId: string,
  metadata?: Record<string, unknown>
): void {
  logAuditEvent({
    timestamp: new Date().toISOString(),
    category: "PUBLISH",
    action: `PAGE_${action}`,
    actorId,
    organizationId,
    targetId: pageId,
    metadata: metadata ?? {},
    severity: "INFO",
  });
}

export function auditAuthFailure(
  reason: string,
  ip: string,
  metadata?: Record<string, unknown>
): void {
  logAuditEvent({
    timestamp: new Date().toISOString(),
    category: "AUTH",
    action: "AUTH_FAILURE",
    actorId: "anonymous",
    organizationId: null,
    targetId: null,
    metadata: { reason, ip, ...metadata },
    severity: "WARN",
  });
}

export function auditWebhookFailure(
  source: string,
  reason: string,
  ip: string
): void {
  logAuditEvent({
    timestamp: new Date().toISOString(),
    category: "WEBHOOK",
    action: "WEBHOOK_SIGNATURE_FAILURE",
    actorId: "system",
    organizationId: null,
    targetId: null,
    metadata: { source, reason, ip },
    severity: "CRITICAL",
  });
}
