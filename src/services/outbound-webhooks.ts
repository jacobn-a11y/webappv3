import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { decodeSecurityPolicy, encodeJsonValue } from "../types/json-boundaries.js";

export const OUTBOUND_WEBHOOK_EVENTS = [
  "landing_page_published",
  "story_generated",
  "story_generation_failed",
  "scheduled_report_generated",
  "webhook.test",
  "ALL_EVENTS",
] as const;

export type OutboundWebhookEventType = (typeof OUTBOUND_WEBHOOK_EVENTS)[number];

export interface OutboundWebhookSubscription {
  id: string;
  url: string;
  secret: string;
  event_types: OutboundWebhookEventType[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface OutboundEventEnvelope {
  event_id: string;
  event_type: OutboundWebhookEventType;
  occurred_at: string;
  payload: Record<string, unknown>;
}

function decodeSubscriptions(value: unknown): OutboundWebhookSubscription[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const eventSet = new Set<string>(OUTBOUND_WEBHOOK_EVENTS);
  return value
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => {
      const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
      const url = typeof item.url === "string" ? item.url : "";
      const secret = typeof item.secret === "string" ? item.secret : "";
      const enabled = typeof item.enabled === "boolean" ? item.enabled : true;
      const eventTypes = Array.isArray(item.event_types)
        ? item.event_types.filter(
            (event): event is OutboundWebhookEventType =>
              typeof event === "string" && eventSet.has(event)
          )
        : [];
      const createdAt =
        typeof item.created_at === "string"
          ? item.created_at
          : new Date().toISOString();
      const updatedAt =
        typeof item.updated_at === "string"
          ? item.updated_at
          : new Date().toISOString();
      return {
        id,
        url,
        secret,
        event_types: eventTypes,
        enabled,
        created_at: createdAt,
        updated_at: updatedAt,
      };
    })
    .filter((item) => item.url.length > 0 && item.secret.length > 0 && item.event_types.length > 0);
}

export async function listOutboundWebhookSubscriptions(
  prisma: PrismaClient,
  organizationId: string
): Promise<OutboundWebhookSubscription[]> {
  if (
    !("orgSettings" in prisma) ||
    !prisma.orgSettings ||
    typeof prisma.orgSettings.findUnique !== "function"
  ) {
    return [];
  }
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { securityPolicy: true },
  });
  const policy = decodeSecurityPolicy(settings?.securityPolicy);
  const raw = (policy as Record<string, unknown>).outbound_webhooks;
  return decodeSubscriptions(raw);
}

export async function saveOutboundWebhookSubscriptions(
  prisma: PrismaClient,
  organizationId: string,
  subscriptions: OutboundWebhookSubscription[]
): Promise<void> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { securityPolicy: true },
  });
  const existing = decodeSecurityPolicy(settings?.securityPolicy);
  const nextPolicy = {
    ...existing,
    outbound_webhooks: subscriptions,
  };
  await prisma.orgSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      securityPolicy: encodeJsonValue(nextPolicy),
    },
    update: {
      securityPolicy: encodeJsonValue(nextPolicy),
    },
  });
}

export async function deliverWebhookToSubscription(
  subscription: OutboundWebhookSubscription,
  envelope: OutboundEventEnvelope
): Promise<{ status: number; ok: boolean; error?: string }> {
  const payload = JSON.stringify(envelope);
  const signature = crypto
    .createHmac("sha256", subscription.secret)
    .update(payload)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-StoryEngine-Event": envelope.event_type,
        "X-StoryEngine-Signature": `sha256=${signature}`,
      },
      body: payload,
      signal: controller.signal,
    });
    return { status: response.status, ok: response.ok };
  } catch (err) {
    const error = err instanceof Error ? err.message : "request_failed";
    return { status: 0, ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchOutboundWebhookEvent(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    eventType: OutboundWebhookEventType;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const subscriptions = await listOutboundWebhookSubscriptions(
    prisma,
    input.organizationId
  );
  const targets = subscriptions.filter(
    (subscription) =>
      subscription.enabled &&
      (subscription.event_types.includes(input.eventType) ||
        subscription.event_types.includes("ALL_EVENTS"))
  );
  if (targets.length === 0) {
    return;
  }
  const envelope: OutboundEventEnvelope = {
    event_id: crypto.randomUUID(),
    event_type: input.eventType,
    occurred_at: new Date().toISOString(),
    payload: input.payload,
  };

  await Promise.all(
    targets.map(async (target) => {
      const delivery = await deliverWebhookToSubscription(target, envelope);
      if (!delivery.ok) {
        logger.warn("Outbound webhook delivery failed", {
          organizationId: input.organizationId,
          subscriptionId: target.id,
          eventType: input.eventType,
          status: delivery.status,
          error: delivery.error ?? null,
        });
      }
    })
  );
}
