/**
 * StoryPreviewStep -- full preview UI for a generated story.
 *
 * Owns:
 *   - story stats (word count / reading time)
 *   - safe-to-share indicator
 *   - regenerate-variant handler
 *   - delegates publish actions to useStoryPublishFlow (StoryPublishStep)
 *   - delegates rendering to StoryPreviewSection from StoryModalSections
 */

import { useCallback, useMemo } from "react";
import { StoryPreviewSection } from "./StoryModalSections";
import { useStoryPublishFlow } from "./StoryPublishStep";
import type { Dispatch, SetStateAction } from "react";
import type { BuildStoryResponse } from "../../lib/api";
import type { StoryVisibilityMode } from "./StoryFormStep";
import type {
  FunnelStage,
  TaxonomyTopic,
  StoryFormat,
  StoryLength,
  StoryOutline,
  StoryTypeInput,
} from "../../types/taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoryPreviewStepProps {
  accountName: string;
  editMode: boolean;
  flowOpenedAt: number;
  handleBackToForm: () => void;
  namedPermissionConfirmed: boolean;
  onClose: () => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
  onShareAction?: () => void;
  previewMarkdown: string;
  result: BuildStoryResponse;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  setError: (msg: string) => void;
  setPhase: (phase: "form" | "loading" | "preview" | "error") => void;
  setPreviewMarkdown: Dispatch<SetStateAction<string>>;
  stageLabel: string;
  trackSellerEvent: (
    eventType: string,
    metadata?: {
      step?: string;
      story_id?: string;
      action_name?: string;
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    },
  ) => void;
  triggerGeneration: (
    overrides?: Partial<{
      storyLength: StoryLength;
      storyOutline: StoryOutline;
      storyType: StoryTypeInput;
      selectedFormat: StoryFormat | "";
      selectedStages: FunnelStage[];
      selectedTopics: TaxonomyTopic[];
    }>,
  ) => void;
  visibilityMode: StoryVisibilityMode;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#[\]*_>|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

// ── Component ────────────────────────────────────────────────────────────────

export function StoryPreviewStep(props: StoryPreviewStepProps) {
  const {
    accountName,
    editMode,
    flowOpenedAt,
    handleBackToForm,
    namedPermissionConfirmed,
    onLandingPageCreated,
    onShareAction,
    previewMarkdown,
    result,
    setEditMode,
    setError,
    setPhase,
    setPreviewMarkdown,
    stageLabel,
    trackSellerEvent,
    triggerGeneration,
    visibilityMode,
  } = props;

  // ── Derived state ────────────────────────────────────────────────────────

  const activeMarkdown = previewMarkdown;

  const storyStats = useMemo(() => {
    if (!activeMarkdown) return null;
    const wordCount = countWords(activeMarkdown);
    const readingMinutes = Math.max(1, Math.round(wordCount / 220));
    return { wordCount, readingMinutes };
  }, [activeMarkdown]);

  const safeToShare = useMemo(() => {
    const quoteConfidences = result.quotes
      .map((quote) => quote.confidence_score)
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      );
    const avgConfidence =
      quoteConfidences.length > 0
        ? quoteConfidences.reduce((sum, value) => sum + value, 0) /
          quoteConfidences.length
        : 0;
    const confidenceOk = avgConfidence >= 0.72;
    if (
      confidenceOk &&
      (visibilityMode === "ANONYMOUS" || namedPermissionConfirmed)
    ) {
      return {
        status: "ready" as const,
        label: "Safe to Share",
        reason: `Average quote confidence is ${Math.round(avgConfidence * 100)}%.`,
        avgConfidence,
      };
    }
    if (visibilityMode === "NAMED" && !namedPermissionConfirmed) {
      return {
        status: "warning" as const,
        label: "Review Permission",
        reason:
          "Named mode requires customer permission confirmation before sharing.",
        avgConfidence,
      };
    }
    return {
      status: "warning" as const,
      label: "Review Needed",
      reason: `Average quote confidence is ${Math.round(avgConfidence * 100)}%.`,
      avgConfidence,
    };
  }, [namedPermissionConfirmed, result, visibilityMode]);

  // ── Publish flow ─────────────────────────────────────────────────────────

  const {
    copyFeedback,
    creatingPage,
    exportingFormat,
    handleCopyPackagingTemplate,
    handleCopyToClipboard,
    handleCreateLandingPage,
    handleDownloadExport,
    handleDownloadMarkdown,
    packagingTemplates,
  } = useStoryPublishFlow({
    accountName,
    flowOpenedAt,
    namedPermissionConfirmed,
    onError: (message) => {
      setError(message);
      setPhase("error");
    },
    onLandingPageCreated,
    onShareAction,
    previewMarkdown,
    result,
    stageLabel,
    trackSellerEvent,
    visibilityMode,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const runGeneration = useCallback(() => {
    triggerGeneration();
  }, [triggerGeneration]);

  const handleRegenerateVariant = useCallback(
    (variant: "same" | "shorter" | "executive" | "proof") => {
      trackSellerEvent("library_action", {
        action_name: `regenerate_${variant}`,
        step: "preview_toolbar",
      });
      if (variant === "same") {
        triggerGeneration();
        return;
      }
      if (variant === "shorter") {
        triggerGeneration({ storyLength: "SHORT" });
        return;
      }
      if (variant === "executive") {
        triggerGeneration({
          storyLength: "EXECUTIVE",
          storyOutline: "EXECUTIVE_BRIEF",
          storyType: "executive_strategic_impact",
        });
        return;
      }
      triggerGeneration({
        storyOutline: "BY_THE_NUMBERS",
        storyType: "quantified_operational_metrics",
        selectedFormat: "by_the_numbers_snapshot",
      });
    },
    [trackSellerEvent, triggerGeneration],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <StoryPreviewSection
      activeMarkdown={activeMarkdown}
      copyFeedback={copyFeedback}
      creatingPage={creatingPage}
      editMode={editMode}
      exportingFormat={exportingFormat}
      handleBackToForm={handleBackToForm}
      handleCopyToClipboard={() => void handleCopyToClipboard()}
      handleCreateLandingPage={() => void handleCreateLandingPage()}
      handleDownloadExport={handleDownloadExport}
      handleDownloadMarkdown={handleDownloadMarkdown}
      handleRegenerateVariant={handleRegenerateVariant}
      handleCopyPackagingTemplate={(templateId) =>
        void handleCopyPackagingTemplate(templateId)
      }
      packagingTemplates={packagingTemplates}
      result={result}
      runGeneration={runGeneration}
      safeToShare={safeToShare}
      setEditMode={setEditMode}
      setPreviewMarkdown={setPreviewMarkdown}
      storyStats={storyStats}
    />
  );
}
