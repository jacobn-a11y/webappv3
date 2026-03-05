import type { PrismaClient } from "@prisma/client";
import type { Pinecone } from "@pinecone-database/pinecone";

interface RAGVectorRetentionDeps {
  prisma: PrismaClient;
  pinecone: Pinecone;
  indexName: string;
  vectorRetentionDeleteLimit: number;
  withRetry: <T>(fn: () => Promise<T>) => Promise<T>;
}

export async function pruneRagVectors(
  deps: RAGVectorRetentionDeps,
  input: {
    organizationId: string;
    olderThan: Date;
    limit?: number;
  }
): Promise<number> {
  const limit = Math.max(1, input.limit ?? deps.vectorRetentionDeleteLimit);
  const candidates = await deps.prisma.transcriptChunk.findMany({
    where: {
      embeddingId: { not: null },
      transcript: {
        call: {
          organizationId: input.organizationId,
          occurredAt: { lt: input.olderThan },
        },
      },
    },
    select: {
      id: true,
      embeddingId: true,
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  return deleteVectorsForCandidates(deps, candidates);
}

export async function pruneRagVectorsForCall(
  deps: RAGVectorRetentionDeps,
  input: {
    organizationId: string;
    callId: string;
  }
): Promise<number> {
  const candidates = await deps.prisma.transcriptChunk.findMany({
    where: {
      embeddingId: { not: null },
      transcript: {
        call: {
          id: input.callId,
          organizationId: input.organizationId,
        },
      },
    },
    select: { id: true, embeddingId: true },
    orderBy: { createdAt: "asc" },
  });

  return deleteVectorsForCandidates(deps, candidates);
}

export async function pruneRagVectorsForStory(
  deps: RAGVectorRetentionDeps,
  input: {
    organizationId: string;
    storyId: string;
  }
): Promise<number> {
  const lineageRows = await deps.prisma.storyClaimLineage.findMany({
    where: {
      organizationId: input.organizationId,
      storyId: input.storyId,
      sourceChunkId: { not: null },
    },
    select: { sourceChunkId: true },
  });
  const candidateChunkIds = Array.from(
    new Set(
      lineageRows
        .map((row) => row.sourceChunkId)
        .filter((value): value is string => !!value)
    )
  );
  if (candidateChunkIds.length === 0) {
    return 0;
  }

  const referencedElsewhere = await deps.prisma.storyClaimLineage.findMany({
    where: {
      organizationId: input.organizationId,
      storyId: { not: input.storyId },
      sourceChunkId: { in: candidateChunkIds },
    },
    select: { sourceChunkId: true },
  });
  const protectedChunkIds = new Set(
    referencedElsewhere
      .map((row) => row.sourceChunkId)
      .filter((value): value is string => !!value)
  );
  const prunableChunkIds = candidateChunkIds.filter((id) => !protectedChunkIds.has(id));
  if (prunableChunkIds.length === 0) {
    return 0;
  }

  const candidates = await deps.prisma.transcriptChunk.findMany({
    where: {
      id: { in: prunableChunkIds },
      embeddingId: { not: null },
      transcript: { call: { organizationId: input.organizationId } },
    },
    select: { id: true, embeddingId: true },
  });

  return deleteVectorsForCandidates(deps, candidates);
}

async function deleteVectorsForCandidates(
  deps: RAGVectorRetentionDeps,
  candidates: Array<{ id: string; embeddingId: string | null }>
): Promise<number> {
  const vectorIds = candidates
    .map((chunk) => chunk.embeddingId)
    .filter((value): value is string => !!value);
  if (vectorIds.length === 0) {
    return 0;
  }

  const index = deps.pinecone.Index(deps.indexName);
  for (let i = 0; i < vectorIds.length; i += 100) {
    const batch = vectorIds.slice(i, i + 100);
    if (batch.length === 0) continue;
    await deps.withRetry(() => index.deleteMany(batch));
  }

  await deps.prisma.transcriptChunk.updateMany({
    where: { id: { in: candidates.map((candidate) => candidate.id) } },
    data: { embeddingId: null },
  });

  return vectorIds.length;
}
