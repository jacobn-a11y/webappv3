/**
 * Transcript Viewer
 *
 * Renders a full transcript page for a given callId with:
 *   - Speaker-attributed segments with timestamp markers
 *   - Inline taxonomy tag highlights (hover for topic + confidence)
 *   - Client-side search bar that highlights matching text
 *   - Sidebar with call metadata, participants, and entity resolution result
 *
 * Served at /api/calls/:callId/transcript (behind auth + trial gate).
 */

import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import type { PrismaClient } from "@prisma/client";
import {
  renderTranscriptPage,
  type CallMetadata,
  type TranscriptSegment,
  type ParticipantInfo,
  type EntityResolutionInfo,
  type SegmentTag,
} from "./templates/transcript-viewer-template.js";
import { sendUnauthorized, sendNotFound, sendSuccess } from "./_shared/responses.js";

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createTranscriptViewerRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /api/calls/:callId/transcript
   *
   * Renders the Transcript Viewer page for the given call.
   * Requires authentication (organizationId on request).
   */
  router.get("/:callId/transcript", async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const callId = req.params.callId as string;

    const call = await prisma.call.findFirst({
      where: {
        id: callId,
        organizationId,
      },
      include: {
        account: true,
        transcript: {
          include: {
            chunks: {
              include: {
                tags: true,
              },
              orderBy: { chunkIndex: "asc" },
            },
          },
        },
        participants: {
          include: {
            contact: true,
          },
        },
        tags: {
          orderBy: { confidence: "desc" },
        },
      },
    });

    if (!call) {
      sendNotFound(res, "Call not found");
      return;
    }

    const meta: CallMetadata = {
      id: call.id,
      title: call.title,
      provider: call.provider,
      duration: call.duration,
      occurredAt: call.occurredAt.toISOString(),
      recordingUrl: call.recordingUrl,
      language: call.transcript?.language ?? "en",
      wordCount: call.transcript?.wordCount ?? 0,
    };

    const segments: TranscriptSegment[] = (call.transcript?.chunks ?? []).map(
      (chunk: { id: string; chunkIndex: number; speaker: string | null; text: string; startMs: number | null; endMs: number | null; tags: Array<{ funnelStage: string; topic: string; confidence: number }> }) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        speaker: chunk.speaker,
        text: chunk.text,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        tags: chunk.tags.map((t: { funnelStage: string; topic: string; confidence: number }) => ({
          funnelStage: t.funnelStage,
          topic: t.topic,
          confidence: t.confidence,
        })),
      })
    );

    const participants: ParticipantInfo[] = call.participants.map((p: { name: string | null; email: string | null; isHost: boolean; contact: { name: string | null; title: string | null } | null }) => ({
      name: p.name,
      email: p.email,
      isHost: p.isHost,
      contactName: p.contact?.name ?? null,
      contactTitle: p.contact?.title ?? null,
    }));

    const entity: EntityResolutionInfo = {
      accountId: call.account?.id ?? null,
      accountName: call.account?.name ?? null,
      accountDomain: call.account?.domain ?? null,
      accountIndustry: call.account?.industry ?? null,
    };

    const callTags: SegmentTag[] = call.tags.map((t: { funnelStage: string; topic: string; confidence: number }) => ({
      funnelStage: t.funnelStage,
      topic: t.topic,
      confidence: t.confidence,
    }));

    const acceptHeader = req.get("Accept") || "";
    if (acceptHeader.includes("application/json")) {
      sendSuccess(res, { meta, segments, participants, entity, callTags });
      return;
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.send(renderTranscriptPage(meta, segments, participants, entity, callTags));
  });

  return router;
}
