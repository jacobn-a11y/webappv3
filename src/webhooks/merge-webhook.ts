/**
 * Merge.dev Webhook Receiver
 *
 * Handles incoming webhooks from Merge.dev's unified API when:
 *  - A new recording is created (from Gong, Chorus, Zoom, etc.)
 *  - A CRM record is updated (Salesforce/HubSpot contact, opportunity, etc.)
 *
 * GATED: This handler checks for an active MERGE_DEV IntegrationConfig
 * for the target organization. When Merge.dev is not enabled (no config
 * or config.enabled=false), webhooks are acknowledged but not processed.
 * This allows operators to use direct integrations (Grain, Gong, SFDC)
 * for the pilot and re-enable Merge.dev later for multi-provider SaaS use.
 *
 * Flow:
 *   1. Verify webhook signature
 *   2. Check if Merge.dev is enabled for this org (IntegrationConfig gate)
 *   3. Parse the event type and payload
 *   4. Dispatch to the appropriate handler
 *   5. Queue async processing (transcription, entity resolution, tagging)
 */

import type { Request, Response } from "express";
import crypto from "crypto";
import type { PrismaClient, CallProvider } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  EntityResolver,
  normalizeCompanyName,
  extractEmailDomain,
} from "../services/entity-resolution.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MergeWebhookPayload {
  hook: {
    event: string;
  };
  linked_account: {
    id: string;
    integration: string;
    organization: string;
  };
  data: Record<string, unknown>;
}

interface MergeRecording {
  id: string;
  remote_id: string;
  name?: string;
  recording_url?: string;
  duration?: number; // seconds
  start_time?: string;
  participants?: Array<{
    email?: string;
    name?: string;
    is_organizer?: boolean;
  }>;
  transcript?: string;
}

interface MergeCRMContact {
  id: string;
  remote_id: string;
  first_name?: string;
  last_name?: string;
  email_addresses?: Array<{ email_address: string; email_address_type: string }>;
  company?: string;
  account?: { id: string; name: string };
}

interface MergeCRMOpportunity {
  id: string;
  remote_id: string;
  name?: string;
  amount?: number;
  stage?: string;
  close_date?: string;
  status?: string;
  account?: { id: string; name: string };
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

function verifyMergeSignature(
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

// ─── Provider Mapping ────────────────────────────────────────────────────────

function mapIntegrationToProvider(integration: string): CallProvider {
  const map: Record<string, CallProvider> = {
    gong: "GONG",
    grain: "GRAIN",
    chorus: "CHORUS",
    zoom: "ZOOM",
    "google-meet": "GOOGLE_MEET",
    "google_meet": "GOOGLE_MEET",
    teams: "TEAMS",
    "microsoft-teams": "TEAMS",
    fireflies: "FIREFLIES",
    dialpad: "DIALPAD",
    aircall: "AIRCALL",
    ringcentral: "RINGCENTRAL",
    salesloft: "SALESLOFT",
    outreach: "OUTREACH",
  };
  return map[integration.toLowerCase()] ?? "OTHER";
}

// ─── Webhook Handler Factory ─────────────────────────────────────────────────

export function createMergeWebhookHandler(deps: {
  prisma: PrismaClient;
  processingQueue: Queue;
}) {
  const { prisma, processingQueue } = deps;
  const resolver = new EntityResolver(prisma);

  return async (req: Request, res: Response) => {
    // ── Verify signature ──────────────────────────────────────────────
    const signature = req.headers["x-merge-webhook-signature"] as string;
    const webhookSecret = process.env.MERGE_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const rawBody =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!verifyMergeSignature(rawBody, signature, webhookSecret)) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
    }

    const payload = req.body as MergeWebhookPayload;
    const eventType = payload.hook.event;

    // ── Resolve which organization this webhook belongs to ────────────
    // In production, map linked_account.organization to our org ID
    // For now, use the linked_account metadata
    const org = await prisma.organization.findFirst({
      where: { id: payload.linked_account.organization },
    });

    if (!org) {
      // Acknowledge but skip — no matching org
      res.json({ received: true, processed: false });
      return;
    }

    // ── Check if Merge.dev is enabled for this org ────────────────────
    const mergeConfig = await prisma.integrationConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId: org.id,
          provider: "MERGE_DEV",
        },
      },
    });

    if (!mergeConfig || !mergeConfig.enabled) {
      // Merge.dev is not enabled for this org — acknowledge but skip.
      // The org is using direct integrations (Grain, Gong, SFDC) instead.
      res.json({
        received: true,
        processed: false,
        reason: "Merge.dev integration is not enabled for this organization",
      });
      return;
    }

    // ── Route by event type ───────────────────────────────────────────
    try {
      switch (eventType) {
        case "recording.created":
        case "recording.updated":
          await handleRecordingEvent(
            prisma,
            resolver,
            processingQueue,
            org.id,
            payload
          );
          break;

        case "contact.created":
        case "contact.updated":
          await handleCRMContactEvent(prisma, org.id, payload);
          break;

        case "opportunity.created":
        case "opportunity.updated":
          await handleCRMOpportunityEvent(prisma, org.id, payload);
          break;

        default:
          // Unknown event type — acknowledge but don't process
          break;
      }

      res.json({ received: true, processed: true });
    } catch (err) {
      console.error(`Webhook processing error for ${eventType}:`, err);
      // Return 200 to prevent Merge.dev retries for processing errors
      // (only return 4xx/5xx for signature failures)
      res.json({ received: true, processed: false, error: "Processing failed" });
    }
  };
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

async function handleRecordingEvent(
  prisma: PrismaClient,
  resolver: EntityResolver,
  processingQueue: Queue,
  organizationId: string,
  payload: MergeWebhookPayload
): Promise<void> {
  const recording = payload.data as unknown as MergeRecording;
  const provider = mapIntegrationToProvider(
    payload.linked_account.integration
  );

  // ── Upsert the call record ──────────────────────────────────────────
  const call = await prisma.call.upsert({
    where: { mergeRecordingId: recording.id },
    create: {
      organizationId,
      title: recording.name ?? null,
      provider,
      mergeRecordingId: recording.id,
      externalId: recording.remote_id,
      recordingUrl: recording.recording_url ?? null,
      duration: recording.duration ?? null,
      occurredAt: recording.start_time
        ? new Date(recording.start_time)
        : new Date(),
    },
    update: {
      title: recording.name ?? undefined,
      recordingUrl: recording.recording_url ?? undefined,
      duration: recording.duration ?? undefined,
    },
  });

  // ── Store participants ──────────────────────────────────────────────
  const participants = recording.participants ?? [];
  for (const p of participants) {
    await prisma.callParticipant.create({
      data: {
        callId: call.id,
        email: p.email?.toLowerCase() ?? null,
        name: p.name ?? null,
        isHost: p.is_organizer ?? false,
      },
    });
  }

  // ── Entity Resolution — match to CRM Account ──────────────────────
  const participantInputs = participants.map((p) => ({
    email: p.email,
    name: p.name,
  }));

  const resolution = await resolver.resolveAndLinkContacts(
    organizationId,
    call.id,
    participantInputs
  );

  // ── Store transcript if included ────────────────────────────────────
  if (recording.transcript) {
    await prisma.transcript.create({
      data: {
        callId: call.id,
        fullText: recording.transcript,
        wordCount: recording.transcript.split(/\s+/).length,
      },
    });
  }

  // ── Queue async processing (chunking → tagging → embedding) ────────
  await processingQueue.add(
    "process-call",
    {
      callId: call.id,
      organizationId,
      accountId: resolution.accountId || null,
      hasTranscript: !!recording.transcript,
    },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );
}

async function handleCRMContactEvent(
  prisma: PrismaClient,
  organizationId: string,
  payload: MergeWebhookPayload
): Promise<void> {
  const contact = payload.data as unknown as MergeCRMContact;
  const primaryEmail = contact.email_addresses?.[0]?.email_address;
  if (!primaryEmail) return;

  const domain = extractEmailDomain(primaryEmail);
  if (!domain) return;

  // Try to find the associated account
  const account = await prisma.account.findFirst({
    where: { organizationId, domain },
  });

  if (!account) {
    // If the contact has a company/account from CRM, create the account
    if (contact.account?.name) {
      const newAccount = await prisma.account.create({
        data: {
          organizationId,
          name: contact.account.name,
          normalizedName: normalizeCompanyName(contact.account.name),
          domain,
          salesforceId: contact.account.id,
        },
      });

      await prisma.contact.create({
        data: {
          accountId: newAccount.id,
          email: primaryEmail.toLowerCase(),
          emailDomain: domain,
          name:
            [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
            null,
          mergeContactId: contact.id,
        },
      });
    }
    return;
  }

  // Upsert the contact under the matched account
  const fullName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;

  await prisma.contact.upsert({
    where: { accountId_email: { accountId: account.id, email: primaryEmail.toLowerCase() } },
    create: {
      accountId: account.id,
      email: primaryEmail.toLowerCase(),
      emailDomain: domain,
      name: fullName,
      mergeContactId: contact.id,
    },
    update: {
      name: fullName ?? undefined,
      mergeContactId: contact.id,
    },
  });
}

async function handleCRMOpportunityEvent(
  prisma: PrismaClient,
  organizationId: string,
  payload: MergeWebhookPayload
): Promise<void> {
  const opp = payload.data as unknown as MergeCRMOpportunity;

  if (!opp.account?.name) return;

  // Find the account
  const normalizedName = normalizeCompanyName(opp.account.name);
  const account = await prisma.account.findFirst({
    where: { organizationId, normalizedName },
  });

  if (!account) return;

  // Map opportunity status to event type
  let eventType: "CLOSED_WON" | "CLOSED_LOST" | "OPPORTUNITY_STAGE_CHANGE" | "OPPORTUNITY_CREATED";
  if (opp.status === "WON" || opp.stage?.toLowerCase().includes("closed won")) {
    eventType = "CLOSED_WON";
  } else if (opp.status === "LOST" || opp.stage?.toLowerCase().includes("closed lost")) {
    eventType = "CLOSED_LOST";
  } else if (payload.hook.event === "opportunity.created") {
    eventType = "OPPORTUNITY_CREATED";
  } else {
    eventType = "OPPORTUNITY_STAGE_CHANGE";
  }

  await prisma.salesforceEvent.create({
    data: {
      accountId: account.id,
      eventType,
      stageName: opp.stage ?? null,
      opportunityId: opp.remote_id,
      amount: opp.amount ?? null,
      closeDate: opp.close_date ? new Date(opp.close_date) : null,
      description: opp.name ?? null,
      rawPayload: payload.data as object,
    },
  });
}
