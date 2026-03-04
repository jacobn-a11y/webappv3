/**
 * StoryPreviewStep -- full preview UI for a generated story.
 *
 * Owns:
 *   - story stats (word count / reading time)
 *   - safe-to-share indicator
 *   - packaging templates (executive recap, champion forward, ROI proof)
 *   - regenerate-variant handler
 *   - copy-packaging-template handler
 *   - delegates rendering to StoryPreviewSection from StoryModalSections
 */

import { useCallback, useMemo } from "react";
import { StoryPreviewSection } from "./StoryModalSections";
import { usePublishFlow } from "./usePublishFlow";
import type { Dispatch, SetStateAction } from "react";
import type { BuildStoryResponse, StoryQuote } from "../../lib/api";
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

export interface PackagingTemplate {
  id: "executive_recap" | "champion_forward" | "roi_proof";
  label: string;
  description: string;
  body: string;
}

export interface StoryPreviewStepProps {
  accountName: string;
  editMode: boolean;
  flowOpenedAt: number;
  handleBackToForm: () => void;
  namedPermissionConfirmed: boolean;
  onClose: () => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
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

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[>#*_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSummarySentences(markdown: string, max = 4): string[] {
  const plain = stripMarkdown(markdown);
  return plain
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 18)
    .slice(0, max);
}

function buildPackagingTemplates(input: {
  accountName: string;
  markdown: string;
  quotes: StoryQuote[];
  stageLabel: string;
  visibilityMode: StoryVisibilityMode;
}): PackagingTemplate[] {
  const subject =
    input.visibilityMode === "NAMED" ? input.accountName : "the customer";
  const summary = extractSummarySentences(input.markdown, 5);
  const topQuote = input.quotes[0]?.quote_text ?? "No quote available.";
  const metricQuote = input.quotes.find((quote) => !!quote.metric_value);
  const metricLine = metricQuote?.metric_value
    ? `${metricQuote.metric_value}${metricQuote.metric_type ? ` (${metricQuote.metric_type})` : ""}`
    : "No quantified metric captured.";

  return [
    {
      id: "executive_recap",
      label: "Executive Recap",
      description: "Tight readout for leadership and deal sponsors.",
      body: [
        `Executive Recap (${input.stageLabel})`,
        `Account: ${subject}`,
        "",
        ...summary.slice(0, 3).map((line) => `- ${line}`),
      ].join("\n"),
    },
    {
      id: "champion_forward",
      label: "Champion Forward",
      description: "Forwardable package for your internal champion.",
      body: [
        `Champion Forward (${input.stageLabel})`,
        `Account: ${subject}`,
        "",
        "Proof quote:",
        `"${topQuote}"`,
        "",
        "Recommended next step:",
        summary[3] ?? summary[0] ?? "Align this evidence to current stakeholder objections.",
      ].join("\n"),
    },
    {
      id: "roi_proof",
      label: "ROI Proof",
      description: "Metric-first package for procurement and finance.",
      body: [
        `ROI Proof (${input.stageLabel})`,
        `Account: ${subject}`,
        "",
        `Primary KPI: ${metricLine}`,
        "",
        ...summary.slice(0, 2).map((line) => `- ${line}`),
      ].join("\n"),
    },
  ];
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

  const packagingTemplates = useMemo(
    () =>
      buildPackagingTemplates({
        accountName,
        markdown: previewMarkdown,
        quotes: result.quotes,
        stageLabel,
        visibilityMode,
      }),
    [accountName, previewMarkdown, result, stageLabel, visibilityMode],
  );

  // ── Publish flow ─────────────────────────────────────────────────────────

  const {
    copyFeedback,
    creatingPage,
    exportingFormat,
    handleCopyToClipboard,
    handleCreateLandingPage,
    handleDownloadExport,
    handleDownloadMarkdown,
  } = usePublishFlow({
    accountName,
    includeCompanyName: visibilityMode === "NAMED",
    namedModeConfirmed: namedPermissionConfirmed,
    onError: (message) => {
      setError(message);
      setPhase("error");
    },
    onPackagingAction: (actionName, metadata) => {
      trackSellerEvent("share_action", {
        action_name: actionName,
        step: "preview_package",
        story_id: result.story_id ?? undefined,
        duration_ms: Date.now() - flowOpenedAt,
        metadata,
      });
    },
    onLandingPageCreated,
    previewMarkdown,
    result,
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

  const handleCopyPackagingTemplate = useCallback(
    async (templateId: PackagingTemplate["id"]) => {
      const template = packagingTemplates.find(
        (entry) => entry.id === templateId,
      );
      if (!template) {
        return;
      }
      try {
        await navigator.clipboard.writeText(template.body);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = template.body;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      trackSellerEvent("share_action", {
        action_name: `copy_package_${templateId}`,
        step: "preview_package_templates",
        story_id: result.story_id ?? undefined,
        duration_ms: Date.now() - flowOpenedAt,
      });
    },
    [flowOpenedAt, packagingTemplates, result.story_id, trackSellerEvent],
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
