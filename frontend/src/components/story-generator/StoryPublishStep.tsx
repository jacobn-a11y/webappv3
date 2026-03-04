/**
 * StoryPublishStep -- publish-to-landing-page flow and packaging actions.
 *
 * Owns:
 *   - packaging templates (executive recap, champion forward, ROI proof)
 *   - copy-packaging-template handler (with clipboard fallback)
 *   - delegates core publish actions to usePublishFlow
 *   - fires onShareAction so the parent can update onboarding state
 */

import { useCallback, useMemo } from "react";
import { usePublishFlow } from "./usePublishFlow";
import type { BuildStoryResponse, StoryQuote } from "../../lib/api";
import type { StoryVisibilityMode } from "./StoryFormStep";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PackagingTemplate {
  id: "executive_recap" | "champion_forward" | "roi_proof";
  label: string;
  description: string;
  body: string;
}

export interface UseStoryPublishFlowOptions {
  accountName: string;
  flowOpenedAt: number;
  namedPermissionConfirmed: boolean;
  onError: (message: string) => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
  onShareAction?: () => void;
  previewMarkdown: string;
  result: BuildStoryResponse;
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
  visibilityMode: StoryVisibilityMode;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useStoryPublishFlow(options: UseStoryPublishFlowOptions) {
  const {
    accountName,
    flowOpenedAt,
    namedPermissionConfirmed,
    onError,
    onLandingPageCreated,
    onShareAction,
    previewMarkdown,
    result,
    stageLabel,
    trackSellerEvent,
    visibilityMode,
  } = options;

  // ── Packaging templates ─────────────────────────────────────────────────

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

  // ── Core publish flow ───────────────────────────────────────────────────

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
    onError,
    onPackagingAction: (actionName, metadata) => {
      trackSellerEvent("share_action", {
        action_name: actionName,
        step: "preview_package",
        story_id: result.story_id ?? undefined,
        duration_ms: Date.now() - flowOpenedAt,
        metadata,
      });
      onShareAction?.();
    },
    onLandingPageCreated,
    previewMarkdown,
    result,
  });

  // ── Copy packaging template ─────────────────────────────────────────────

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
      onShareAction?.();
    },
    [flowOpenedAt, onShareAction, packagingTemplates, result.story_id, trackSellerEvent],
  );

  return {
    copyFeedback,
    creatingPage,
    exportingFormat,
    handleCopyPackagingTemplate,
    handleCopyToClipboard,
    handleCreateLandingPage,
    handleDownloadExport,
    handleDownloadMarkdown,
    packagingTemplates,
  };
}
