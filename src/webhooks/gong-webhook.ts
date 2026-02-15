/**
 * Gong Webhook Handler
 *
 * Receives real-time notifications from Gong when calls are completed.
 * This supplements the polling-based sync with immediate processing of
 * new call recordings.
 *
 * Gong webhooks deliver events when:
 *   - A call recording is available
 *   - A call transcript is ready
 *
 * The handler validates the webhook, fetches full call data from the Gong
 * API, then feeds it into the standard call processing pipeline.
 */

import type { Request, Response } from "express";
import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  EntityResolver,
} from "../services/entity-resolution.js";
import { GongProvider } from "../integrations/gong-provider.js";
import type { GongCredentials } from "../integrations/types.js";

// ─── Gong Webhook Payload Types ─────────────────────────────────────────────

interface GongWebhookPayload {
  /** The event type, e.g., "CALL_RECORDING_READY", "CALL_TRANSCRIPT_READY" */
  event: string;
  /** The Gong call ID */
  callId?: string;
  /** Additional metadata */
  data?: Record<string, unknown>;
}

// ─── Webhook Signature Verification ─────────────────────────────────────────

function verifyGongSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ─── Handler Factory ────────────────────────────────────────────────────────

export function createGongWebhookHandler(deps: {
  prisma: PrismaClient;
  processingQueue: Queue;
}) {
  const { prisma, processingQueue } = deps;
  const gongProvider = new GongProvider();

  return async (req: Request, res: Response) => {
    // ── Find the integration config for this webhook ──────────────────
    // Gong webhooks include an X-Gong-Signature header for verification.
    const signature = req.headers["x-gong-signature"] as string | undefined;
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    // Look up all active Gong integrations to find the matching one
    const gongConfigs = await prisma.integrationConfig.findMany({
      where: { provider: "GONG", enabled: true, status: "ACTIVE" },
    });

    if (gongConfigs.length === 0) {
      res.status(404).json({ error: "No active Gong integration" });
      return;
    }

    // Try to match signature to a specific org's webhook secret
    type GongConfig = (typeof gongConfigs)[number];
    let matchedConfig: GongConfig = gongConfigs[0]; // default to first if no signature
    if (signature) {
      const matched = gongConfigs.find(
        (c: GongConfig) =>
          c.webhookSecret &&
          verifyGongSignature(rawBody, signature, c.webhookSecret)
      );
      if (matched) {
        matchedConfig = matched;
      } else if (gongConfigs.every((c: GongConfig) => c.webhookSecret)) {
        // All configs have secrets but none matched — reject
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
    }

    const payload = req.body as GongWebhookPayload;
    const credentials = matchedConfig.credentials as unknown as GongCredentials;
    const organizationId = matchedConfig.organizationId;

    try {
      if (
        payload.event === "CALL_RECORDING_READY" ||
        payload.event === "CALL_TRANSCRIPT_READY"
      ) {
        if (!payload.callId) {
          res.json({ received: true, processed: false, reason: "No callId" });
          return;
        }

        await handleCallReady(
          prisma,
          processingQueue,
          gongProvider,
          credentials,
          organizationId,
          payload.callId
        );
      }

      res.json({ received: true, processed: true });
    } catch (err) {
      console.error("Gong webhook processing error:", err);
      res.json({ received: true, processed: false, error: "Processing failed" });
    }
  };
}

// ─── Event Handler ──────────────────────────────────────────────────────────

async function handleCallReady(
  prisma: PrismaClient,
  processingQueue: Queue,
  provider: GongProvider,
  credentials: GongCredentials,
  organizationId: string,
  gongCallId: string
): Promise<void> {
  const resolver = new EntityResolver(prisma);

  // Fetch the transcript from Gong
  const transcript = await provider.fetchTranscript(credentials, gongCallId);

  // Check if call already exists
  const existing = await prisma.call.findFirst({
    where: {
      organizationId,
      provider: "GONG",
      externalId: gongCallId,
    },
  });

  // Create or update the call
  const call = existing
    ? await prisma.call.update({
        where: { id: existing.id },
        data: {},
      })
    : await prisma.call.create({
        data: {
          organizationId,
          provider: "GONG",
          externalId: gongCallId,
          occurredAt: new Date(),
        },
      });

  // Store transcript if we got one and it's new
  if (transcript && !existing) {
    await prisma.transcript.create({
      data: {
        callId: call.id,
        fullText: transcript,
        wordCount: transcript.split(/\s+/).length,
      },
    });
  }

  // Queue for async processing
  await processingQueue.add(
    "process-call",
    {
      callId: call.id,
      organizationId,
      accountId: call.accountId ?? null,
      hasTranscript: !!transcript,
    },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
}
