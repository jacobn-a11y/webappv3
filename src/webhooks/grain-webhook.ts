/**
 * Grain Webhook Handler
 *
 * Receives real-time notifications from Grain when meetings are recorded.
 * This supplements the polling-based sync with immediate processing of
 * new recordings.
 *
 * Grain webhooks deliver events when:
 *   - A new recording is completed
 *   - A transcript is ready
 *   - Highlights/notes are generated
 *
 * The handler validates the webhook, fetches full recording data from
 * the Grain API, then feeds it into the standard call processing pipeline.
 */

import type { Request, Response } from "express";
import crypto from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { GrainProvider } from "../integrations/grain-provider.js";
import type { GrainCredentials } from "../integrations/types.js";
import logger from "../lib/logger.js";
import { enqueueProcessCallJob } from "../lib/queue-policy.js";
import { markWebhookEventIfNew } from "../lib/webhook-idempotency.js";
import { pickFirstHeaderValue, validateWebhookTimestamp } from "../lib/webhook-security.js";

// ─── Grain Webhook Payload Types ────────────────────────────────────────────

interface GrainWebhookPayload {
  /** Event type, e.g., "recording.completed", "transcript.ready" */
  event: string;
  /** The recording ID */
  recording_id?: string;
  /** Timestamp of the event */
  timestamp?: string;
  /** Additional event data */
  data?: Record<string, unknown>;
}

// ─── Webhook Signature Verification ─────────────────────────────────────────

function verifyGrainSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const sigBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

// ─── Handler Factory ────────────────────────────────────────────────────────

export function createGrainWebhookHandler(deps: { prisma: PrismaClient; processingQueue: Queue }) {
  const { prisma, processingQueue } = deps;
  const grainProvider = new GrainProvider();

  return async (req: Request, res: Response) => {
    // ── Find the integration config for this webhook ──────────────────
    const signatureHeader = req.headers["x-grain-signature"];
    const signature = typeof signatureHeader === "string" ? signatureHeader : "";
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});

    const grainConfigs = await prisma.integrationConfig.findMany({
      where: { provider: "GRAIN", enabled: true, status: "ACTIVE" },
    });

    if (grainConfigs.length === 0) {
      res.status(404).json({ error: "No active Grain integration" });
      return;
    }

    const validConfigs = grainConfigs.filter(
      (c: { webhookSecret: string | null }) => c.webhookSecret
    );
    if (validConfigs.length === 0) {
      res.status(500).json({
        error: "All active Grain integrations must configure webhookSecret",
      });
      return;
    }
    if (!signature) {
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }

    // Try to match signature to a specific org's webhook secret
    type GrainConfig = (typeof validConfigs)[number];
    const matchedConfig =
      validConfigs.find(
        (c: GrainConfig) =>
          c.webhookSecret && verifyGrainSignature(rawBody, signature, c.webhookSecret)
      ) ?? null;
    if (!matchedConfig) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    let payload: GrainWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as GrainWebhookPayload;
    } catch {
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }

    const rawCredentials: unknown = matchedConfig.credentials;
    const credentials = rawCredentials as GrainCredentials;
    const organizationId = matchedConfig.organizationId;
    const timestampCandidate =
      payload.timestamp ??
      pickFirstHeaderValue(req.headers, [
        "x-grain-timestamp",
        "x-webhook-timestamp",
        "x-request-timestamp",
      ]);
    const timestampValidation = validateWebhookTimestamp({
      provider: "grain",
      timestamp: timestampCandidate,
      required: true,
    });
    if (!timestampValidation.ok) {
      res.status(401).json({
        error:
          timestampValidation.reason === "timestamp_missing"
            ? "missing_webhook_timestamp"
            : "stale_webhook",
      });
      return;
    }

    try {
      if (payload.event === "recording.completed" || payload.event === "transcript.ready") {
        if (!payload.recording_id) {
          res.json({
            received: true,
            processed: false,
            reason: "No recording_id",
          });
          return;
        }

        const eventKey = `grain:${organizationId}:${payload.event}:${payload.recording_id}`;
        if (!(await markWebhookEventIfNew(eventKey))) {
          res.json({
            received: true,
            processed: true,
            duplicate_ignored: true,
          });
          return;
        }

        await handleRecordingReady(
          prisma,
          processingQueue,
          grainProvider,
          credentials,
          organizationId,
          payload.recording_id
        );
      }

      res.json({ received: true, processed: true });
    } catch (err) {
      logger.error("Grain webhook processing error", { error: err });
      res.json({
        received: true,
        processed: false,
        error: "Processing failed",
      });
    }
  };
}

// ─── Event Handler ──────────────────────────────────────────────────────────

async function handleRecordingReady(
  prisma: PrismaClient,
  processingQueue: Queue,
  provider: GrainProvider,
  credentials: GrainCredentials,
  organizationId: string,
  recordingId: string
): Promise<void> {
  // Fetch full recording details including transcript
  const transcript = await provider.fetchTranscript(credentials, recordingId);

  // Upsert to avoid race conditions between concurrent webhook deliveries
  let call: Awaited<ReturnType<typeof prisma.call.findFirst>>;
  const existing = await prisma.call.findFirst({
    where: {
      organizationId,
      provider: "GRAIN",
      externalId: recordingId,
    },
  });

  if (existing) {
    call = existing;
  } else {
    try {
      call = await prisma.call.create({
        data: {
          organizationId,
          provider: "GRAIN",
          externalId: recordingId,
          occurredAt: new Date(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        call = await prisma.call.findFirstOrThrow({
          where: { organizationId, provider: "GRAIN", externalId: recordingId },
        });
      } else {
        throw err;
      }
    }
  }

  // Store transcript
  if (transcript) {
    await prisma.transcript.upsert({
      where: { callId: call.id },
      create: {
        callId: call.id,
        fullText: transcript,
        wordCount: transcript.split(/\s+/).length,
      },
      update: {
        fullText: transcript,
        wordCount: transcript.split(/\s+/).length,
      },
    });
  }

  // Queue for async processing
  await enqueueProcessCallJob({
    queue: processingQueue,
    source: "grain-webhook",
    payload: {
      callId: call.id,
      organizationId,
      accountId: call.accountId ?? null,
      hasTranscript: !!transcript,
    },
    options: { jobId: `process-call:${call.id}` },
  });
}
