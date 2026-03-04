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
import { RoleProfileService } from "../services/role-profiles.js";
import { CompanyScrubber } from "../services/company-scrubber.js";
import { maskPII } from "../middleware/pii-masker.js";
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
  const roleProfiles = new RoleProfileService(prisma);
  const scrubber = new CompanyScrubber(prisma);

  /**
   * GET /api/calls/:callId/transcript
   *
   * Renders the Transcript Viewer page for the given call.
   * Requires authentication (organizationId on request).
   */
  router.get("/:callId/transcript", async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    if (!organizationId || !authReq.userId!) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const callId = req.params.callId as string;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;

    const [rolePolicy, rawPermissionGrant, attributionDisplay] = await Promise.all([
      roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
      prisma.userPermission.findUnique({
        where: {
          userId_permission: {
            userId,
            permission: "VIEW_RAW_TRANSCRIPTS",
          },
        },
      }),
      prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { quoteAttributionDisplay: true },
      }),
    ]);
    const canViewRaw =
      userRole === "OWNER" ||
      userRole === "ADMIN" ||
      rolePolicy.permissions.includes("VIEW_RAW_TRANSCRIPTS") ||
      !!rawPermissionGrant;
    const forceScrub =
      String(req.query.mode ?? "").toLowerCase() === "scrubbed" || !canViewRaw;
    const obfuscated = attributionDisplay?.quoteAttributionDisplay === "OBFUSCATED";

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
      title: obfuscated ? null : call.title,
      provider: call.provider,
      duration: call.duration,
      occurredAt: call.occurredAt.toISOString(),
      recordingUrl: obfuscated ? null : call.recordingUrl,
      language: call.transcript?.language ?? "en",
      wordCount: call.transcript?.wordCount ?? 0,
      viewMode: forceScrub || obfuscated ? "SCRUBBED" : "RAW",
    };

    const segments: TranscriptSegment[] = await Promise.all(
      (call.transcript?.chunks ?? []).map(
        async (chunk: {
          id: string;
          chunkIndex: number;
          speaker: string | null;
          text: string;
          startMs: number | null;
          endMs: number | null;
          tags: Array<{ funnelStage: string; topic: string; confidence: number }>;
        }) => {
          let text = chunk.text;
          if (forceScrub || obfuscated) {
            const piiMasked = maskPII(chunk.text).maskedText;
            if (call.accountId) {
              const scrubbed = await scrubber.scrubForAccount(call.accountId, piiMasked);
              text = scrubbed.scrubbedText;
            } else {
              text = piiMasked;
            }
          }
          return {
            id: chunk.id,
            chunkIndex: chunk.chunkIndex,
            speaker: forceScrub || obfuscated ? null : chunk.speaker,
            text,
            startMs: forceScrub || obfuscated ? null : chunk.startMs,
            endMs: forceScrub || obfuscated ? null : chunk.endMs,
            tags: chunk.tags.map(
              (t: { funnelStage: string; topic: string; confidence: number }) => ({
                funnelStage: t.funnelStage,
                topic: t.topic,
                confidence: t.confidence,
              })
            ),
          };
        }
      )
    );

    const participants: ParticipantInfo[] = call.participants.map((p: { name: string | null; email: string | null; isHost: boolean; contact: { name: string | null; title: string | null } | null }) => ({
      name: forceScrub || obfuscated ? null : p.name,
      email: forceScrub || obfuscated ? null : p.email,
      isHost: p.isHost,
      contactName: forceScrub || obfuscated ? null : p.contact?.name ?? null,
      contactTitle: forceScrub || obfuscated ? null : p.contact?.title ?? null,
    }));

    const entity: EntityResolutionInfo = {
      accountId: forceScrub || obfuscated ? null : call.account?.id ?? null,
      accountName: forceScrub || obfuscated ? null : call.account?.name ?? null,
      accountDomain: forceScrub || obfuscated ? null : call.account?.domain ?? null,
      accountIndustry: forceScrub || obfuscated ? null : call.account?.industry ?? null,
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
