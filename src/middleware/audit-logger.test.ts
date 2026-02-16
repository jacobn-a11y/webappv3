/**
 * Audit Logger Tests
 *
 * Validates that security audit events are properly structured
 * and logged for compliance and forensic analysis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logAuditEvent,
  auditPermissionChange,
  auditAccessChange,
  auditPublishEvent,
  auditAuthFailure,
  auditWebhookFailure,
  type AuditEvent,
} from "./audit-logger.js";

describe("Audit Logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("logAuditEvent", () => {
    it("should log structured JSON to console", () => {
      const event: AuditEvent = {
        timestamp: "2024-01-01T00:00:00.000Z",
        category: "AUTH",
        action: "LOGIN",
        actorId: "user-1",
        organizationId: "org-1",
        targetId: null,
        metadata: {},
        severity: "INFO",
      };

      logAuditEvent(event);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("AUTH");
      expect(logged.action).toBe("LOGIN");
      expect(logged._type).toBe("SECURITY_AUDIT");
    });

    it("should include all event fields", () => {
      logAuditEvent({
        timestamp: "2024-01-01T00:00:00.000Z",
        category: "PERMISSION",
        action: "PERMISSION_GRANT",
        actorId: "admin-1",
        organizationId: "org-1",
        targetId: "user-2",
        metadata: { permission: "PUBLISH_LANDING_PAGE" },
        severity: "WARN",
      });

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.actorId).toBe("admin-1");
      expect(logged.organizationId).toBe("org-1");
      expect(logged.targetId).toBe("user-2");
      expect(logged.metadata.permission).toBe("PUBLISH_LANDING_PAGE");
      expect(logged.severity).toBe("WARN");
    });
  });

  describe("auditPermissionChange", () => {
    it("should log GRANT events with correct structure", () => {
      auditPermissionChange("GRANT", "admin-1", "user-2", "PUBLISH_LANDING_PAGE", "org-1");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("PERMISSION");
      expect(logged.action).toBe("PERMISSION_GRANT");
      expect(logged.actorId).toBe("admin-1");
      expect(logged.targetId).toBe("user-2");
      expect(logged.metadata.permission).toBe("PUBLISH_LANDING_PAGE");
      expect(logged.severity).toBe("WARN");
    });

    it("should log REVOKE events", () => {
      auditPermissionChange("REVOKE", "admin-1", "user-2", "DELETE_ANY_LANDING_PAGE", "org-1");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.action).toBe("PERMISSION_REVOKE");
    });
  });

  describe("auditAccessChange", () => {
    it("should log account access grants", () => {
      auditAccessChange("GRANT", "admin-1", "user-2", "CRM_REPORT", "org-1", "grant-123");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("ACCESS_CONTROL");
      expect(logged.action).toBe("ACCESS_GRANT");
      expect(logged.metadata.scopeType).toBe("CRM_REPORT");
      expect(logged.metadata.grantId).toBe("grant-123");
    });

    it("should log account access revocations", () => {
      auditAccessChange("REVOKE", "admin-1", "N/A", "N/A", "org-1", "grant-456");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.action).toBe("ACCESS_REVOKE");
    });
  });

  describe("auditPublishEvent", () => {
    it("should log publish events", () => {
      auditPublishEvent("PUBLISH", "user-1", "page-1", "org-1", { visibility: "SHARED_WITH_LINK" });

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("PUBLISH");
      expect(logged.action).toBe("PAGE_PUBLISH");
      expect(logged.metadata.visibility).toBe("SHARED_WITH_LINK");
    });
  });

  describe("auditAuthFailure", () => {
    it("should log auth failures with IP", () => {
      auditAuthFailure("Invalid token", "192.168.1.100");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("AUTH");
      expect(logged.action).toBe("AUTH_FAILURE");
      expect(logged.metadata.reason).toBe("Invalid token");
      expect(logged.metadata.ip).toBe("192.168.1.100");
      expect(logged.severity).toBe("WARN");
    });
  });

  describe("auditWebhookFailure", () => {
    it("should log webhook signature failures as CRITICAL", () => {
      auditWebhookFailure("merge", "Invalid signature", "10.0.0.1");

      const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(logged.category).toBe("WEBHOOK");
      expect(logged.action).toBe("WEBHOOK_SIGNATURE_FAILURE");
      expect(logged.severity).toBe("CRITICAL");
      expect(logged.metadata.source).toBe("merge");
    });
  });
});
