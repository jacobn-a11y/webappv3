import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MultiSelect } from "./MultiSelect";
import { FormatSelector } from "./FormatSelector";
import {
  StoryErrorSection,
  StoryLoadingSection,
  StoryPreviewSection,
} from "./story-generator/StoryModalSections";
import { usePublishFlow } from "./story-generator/usePublishFlow";
import { useQuoteSelection } from "./story-generator/useQuoteSelection";
import { useStoryGeneration } from "./story-generator/useStoryGeneration";
import {
  type FunnelStage,
  type TaxonomyTopic,
  type StoryFormat,
  type StoryLength,
  type StoryOutline,
  type StoryTypeInput,
  FUNNEL_STAGE_LABELS,
  TOPIC_LABELS,
  STORY_LENGTH_LABELS,
  STORY_OUTLINE_LABELS,
} from "../types/taxonomy";
import {
  createSharedAsset,
  deleteSharedAsset,
  getSharedAssets,
  getStoryContextSettings,
  trackSellerAdoptionEvent,
  type SharedAsset,
  type StoryQuote,
  type StoryContextSettings,
} from "../lib/api";
import { useToast } from "./Toast";

type StoryTypeMode = "FULL" | "TOPIC";
type StoryVisibilityMode = "ANONYMOUS" | "NAMED";
type StoryAudienceMode = "CHAMPION" | "EXEC" | "PROCUREMENT";

interface StoryGeneratorModalProps {
  accountId: string;
  accountName: string;
  onClose: () => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
}

interface PersistedStorySettings {
  selectedStages: FunnelStage[];
  selectedTopics: TaxonomyTopic[];
  customTitle: string;
  selectedFormat: StoryFormat | "";
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  isAdvanced: boolean;
}

const PERSIST_KEY = "story_generator_preferences_v1";
const ONBOARDING_KEY = "story_generator_onboarding_seen_v1";

const FUNNEL_STAGE_OPTIONS = (
  Object.entries(FUNNEL_STAGE_LABELS) as [FunnelStage, string][]
).map(([value, label]) => ({ value, label }));

const STORY_TYPE_TOPIC_OPTIONS = Object.entries(TOPIC_LABELS) as [
  TaxonomyTopic,
  string,
][];
const STORY_LENGTH_OPTIONS = Object.entries(
  STORY_LENGTH_LABELS
) as [StoryLength, string][];
const STORY_OUTLINE_OPTIONS = Object.entries(
  STORY_OUTLINE_LABELS
) as [StoryOutline, string][];

interface StoryTemplateValues {
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  storyFormat: StoryFormat | "";
  selectedStages?: FunnelStage[];
  selectedTopics?: TaxonomyTopic[];
}

interface StoryTemplateOption {
  id: string;
  label: string;
  description: string;
  values: StoryTemplateValues;
  source: "built_in" | "saved";
  assetId?: string;
}

interface DealStagePreset {
  id: string;
  label: string;
  description: string;
  values: StoryTemplateValues;
}

interface PackagingTemplate {
  id: "executive_recap" | "champion_forward" | "roi_proof";
  label: string;
  description: string;
  body: string;
}

const BUILT_IN_STORY_TEMPLATES: StoryTemplateOption[] = [
  {
    id: "roi_snapshot",
    label: "Quick ROI Snapshot",
    description: "Short, quantified outcome summary for late-stage deals.",
    values: {
      storyLength: "SHORT" as StoryLength,
      storyOutline: "BY_THE_NUMBERS" as StoryOutline,
      storyType: "roi_financial_outcomes" as StoryTypeInput,
      storyFormat: "by_the_numbers_snapshot" as StoryFormat,
    },
    source: "built_in",
  },
  {
    id: "full_journey",
    label: "Full Customer Journey",
    description: "End-to-end journey with context, actions, and outcomes.",
    values: {
      storyLength: "MEDIUM" as StoryLength,
      storyOutline: "CHRONOLOGICAL_JOURNEY" as StoryOutline,
      storyType: "FULL_ACCOUNT_JOURNEY" as StoryTypeInput,
      storyFormat: "before_after_transformation" as StoryFormat,
    },
    source: "built_in",
  },
  {
    id: "exec_brief",
    label: "Executive Brief",
    description: "Concise high-level readout for leadership updates.",
    values: {
      storyLength: "EXECUTIVE" as StoryLength,
      storyOutline: "EXECUTIVE_BRIEF" as StoryOutline,
      storyType: "executive_strategic_impact" as StoryTypeInput,
      storyFormat: "analyst_validated_study" as StoryFormat,
    },
    source: "built_in",
  },
];

const DEAL_STAGE_PRESETS: DealStagePreset[] = [
  {
    id: "discovery",
    label: "Discovery",
    description: "Pain points and baseline context for early validation.",
    values: {
      storyLength: "SHORT",
      storyOutline: "PROBLEM_SOLUTION_IMPACT",
      storyType: "problem_challenge_identification",
      storyFormat: "day_in_the_life",
      selectedStages: ["TOFU"],
    },
  },
  {
    id: "evaluation",
    label: "Evaluation",
    description: "Decision criteria and implementation confidence signals.",
    values: {
      storyLength: "MEDIUM",
      storyOutline: "CHRONOLOGICAL_JOURNEY",
      storyType: "implementation_onboarding",
      storyFormat: "before_after_transformation",
      selectedStages: ["MOFU", "BOFU"],
    },
  },
  {
    id: "business_case",
    label: "Business Case",
    description: "ROI framing for executive and finance stakeholders.",
    values: {
      storyLength: "EXECUTIVE",
      storyOutline: "BY_THE_NUMBERS",
      storyType: "roi_financial_outcomes",
      storyFormat: "by_the_numbers_snapshot",
      selectedStages: ["BOFU"],
    },
  },
  {
    id: "negotiation",
    label: "Negotiation",
    description: "Risk handling and proof for final-stage objections.",
    values: {
      storyLength: "SHORT",
      storyOutline: "DEAL_ANATOMY",
      storyType: "risk_mitigation_continuity",
      storyFormat: "analyst_validated_study",
      selectedStages: ["BOFU"],
    },
  },
  {
    id: "expansion",
    label: "Expansion",
    description: "Post-sale value proof and growth narrative.",
    values: {
      storyLength: "MEDIUM",
      storyOutline: "CHRONOLOGICAL_JOURNEY",
      storyType: "upsell_cross_sell_expansion",
      storyFormat: "joint_webinar_presentation",
      selectedStages: ["POST_SALE"],
    },
  },
];

const STORY_LENGTH_VALUES = Object.keys(STORY_LENGTH_LABELS) as StoryLength[];
const STORY_OUTLINE_VALUES = Object.keys(STORY_OUTLINE_LABELS) as StoryOutline[];
const STORY_FORMAT_LIST = [
  "before_after_transformation",
  "day_in_the_life",
  "by_the_numbers_snapshot",
  "video_testimonial_soundbite",
  "joint_webinar_presentation",
  "peer_reference_call_guide",
  "analyst_validated_study",
] as const satisfies readonly StoryFormat[];

function parseSavedTemplate(asset: SharedAsset): StoryTemplateOption | null {
  if (asset.asset_type !== "TEMPLATE") {
    return null;
  }
  const metadata =
    asset.metadata && typeof asset.metadata === "object"
      ? (asset.metadata as Record<string, unknown>)
      : null;
  const rawValues =
    metadata?.template_values && typeof metadata.template_values === "object"
      ? (metadata.template_values as Record<string, unknown>)
      : null;
  if (!rawValues) {
    return null;
  }

  const rawLength = rawValues.story_length;
  const rawOutline = rawValues.story_outline;
  const rawType = rawValues.story_type;
  const rawFormat = rawValues.story_format;
  if (
    typeof rawLength !== "string" ||
    !STORY_LENGTH_VALUES.includes(rawLength as StoryLength) ||
    typeof rawOutline !== "string" ||
    !STORY_OUTLINE_VALUES.includes(rawOutline as StoryOutline) ||
    typeof rawType !== "string" ||
    !(
      rawType === "FULL_ACCOUNT_JOURNEY" ||
      STORY_TYPE_TOPIC_OPTIONS.some(([topic]) => topic === rawType)
    )
  ) {
    return null;
  }

  const selectedStages = Array.isArray(rawValues.selected_stages)
    ? rawValues.selected_stages.filter(
        (stage): stage is FunnelStage =>
          typeof stage === "string" && stage in FUNNEL_STAGE_LABELS
      )
    : undefined;
  const selectedTopics = Array.isArray(rawValues.selected_topics)
    ? rawValues.selected_topics.filter(
        (topic): topic is TaxonomyTopic =>
          typeof topic === "string" && topic in TOPIC_LABELS
      )
    : undefined;

  const storyFormat =
    typeof rawFormat === "string" &&
    STORY_FORMAT_LIST.includes(rawFormat as StoryFormat)
      ? (rawFormat as StoryFormat)
      : "";

  return {
    id: `saved-${asset.id}`,
    label: asset.title,
    description: asset.description ?? "Reusable team preset",
    source: "saved",
    assetId: asset.id,
    values: {
      storyLength: rawLength as StoryLength,
      storyOutline: rawOutline as StoryOutline,
      storyType: rawType as StoryTypeInput,
      storyFormat,
      selectedStages,
      selectedTopics,
    },
  };
}

function loadPersistedSettings(): PersistedStorySettings | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedStorySettings;
  } catch {
    return null;
  }
}

function savePersistedSettings(settings: PersistedStorySettings): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

function loadDefaultStoryModePreference(): StoryVisibilityMode {
  try {
    const raw = localStorage.getItem("user_preferences_v1");
    if (!raw) return "ANONYMOUS";
    const parsed = JSON.parse(raw) as { default_story_mode?: string };
    return parsed.default_story_mode === "named" ? "NAMED" : "ANONYMOUS";
  } catch {
    return "ANONYMOUS";
  }
}

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#[\]*_>|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function createFlowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `story-flow-${crypto.randomUUID()}`;
  }
  return `story-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

export function StoryGeneratorModal({
  accountId,
  accountName,
  onClose,
  onLandingPageCreated,
}: StoryGeneratorModalProps) {
  const flowIdRef = useRef<string>(createFlowId());
  const flowOpenedAtRef = useRef<number>(Date.now());
  const generationStartedAtRef = useRef<number | null>(null);
  const completionTelemetryRef = useRef<{ success: boolean; failed: boolean }>({
    success: false,
    failed: false,
  });
  const persistedRef = useRef<PersistedStorySettings | null>(
    loadPersistedSettings()
  );

  const {
    selectedStages,
    selectedTopics,
    topicOptions,
    setSelectedTopics,
    handleStagesChange,
  } = useQuoteSelection({
    selectedStages: persistedRef.current?.selectedStages,
    selectedTopics: persistedRef.current?.selectedTopics,
  });
  const [customTitle, setCustomTitle] = useState(
    persistedRef.current?.customTitle ?? ""
  );
  const [selectedFormat, setSelectedFormat] = useState<StoryFormat | "">(
    persistedRef.current?.selectedFormat ?? ""
  );
  const [storyLength, setStoryLength] = useState<StoryLength>(
    persistedRef.current?.storyLength ?? "MEDIUM"
  );
  const [storyOutline, setStoryOutline] = useState<StoryOutline>(
    persistedRef.current?.storyOutline ?? "CHRONOLOGICAL_JOURNEY"
  );
  const [storyType, setStoryType] = useState<StoryTypeInput>(
    persistedRef.current?.storyType ?? "FULL_ACCOUNT_JOURNEY"
  );
  const [isAdvanced, setIsAdvanced] = useState<boolean>(
    persistedRef.current?.isAdvanced ?? false
  );

  const [storyTypeMode, setStoryTypeMode] = useState<StoryTypeMode>(
    (persistedRef.current?.storyType ?? "FULL_ACCOUNT_JOURNEY") ===
      "FULL_ACCOUNT_JOURNEY"
      ? "FULL"
      : "TOPIC"
  );
  const [storyTypeSearch, setStoryTypeSearch] = useState("");
  const [dealStagePresetId, setDealStagePresetId] = useState<string>("evaluation");
  const [audienceMode, setAudienceMode] = useState<StoryAudienceMode>("CHAMPION");
  const [visibilityMode, setVisibilityMode] = useState<StoryVisibilityMode>(
    loadDefaultStoryModePreference()
  );
  const [namedPermissionConfirmed, setNamedPermissionConfirmed] = useState(false);

  const {
    abortGeneration,
    editMode,
    error,
    handleBackToForm,
    handleCancelGeneration,
    loadingMessage,
    loadingProgress,
    phase,
    previewMarkdown,
    result,
    runGeneration: runStoryGeneration,
    setEditMode,
    setError,
    setPhase,
    setPreviewMarkdown,
    stream: streamedMarkdown,
  } = useStoryGeneration(onClose);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [firstStoryGenerated, setFirstStoryGenerated] = useState(false);
  const [firstStoryShared, setFirstStoryShared] = useState(false);
  const [onboardingElapsedSeconds, setOnboardingElapsedSeconds] = useState(0);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [orgDefaults, setOrgDefaults] = useState<StoryContextSettings | null>(
    null
  );
  const [savedTemplates, setSavedTemplates] = useState<StoryTemplateOption[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const { showToast } = useToast();

  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const filteredStoryTypeOptions = useMemo(() => {
    const needle = storyTypeSearch.trim().toLowerCase();
    if (!needle) return STORY_TYPE_TOPIC_OPTIONS;
    return STORY_TYPE_TOPIC_OPTIONS.filter(([, label]) =>
      label.toLowerCase().includes(needle)
    );
  }, [storyTypeSearch]);

  const allTemplates = useMemo(
    () => [...BUILT_IN_STORY_TEMPLATES, ...savedTemplates],
    [savedTemplates]
  );
  const stageLabel = useMemo(
    () =>
      DEAL_STAGE_PRESETS.find((preset) => preset.id === dealStagePresetId)?.label ??
      "Evaluation",
    [dealStagePresetId]
  );

  const trackSellerEvent = useCallback(
    (
      eventType:
        | "modal_open"
        | "preset_selected"
        | "visibility_mode_selected"
        | "generation_started"
        | "story_generated"
        | "generation_failed"
        | "share_action"
        | "library_action",
      metadata?: {
        step?: string;
        story_id?: string;
        action_name?: string;
        duration_ms?: number;
        metadata?: Record<string, unknown>;
      }
    ) => {
      void trackSellerAdoptionEvent({
        event_type: eventType,
        flow_id: flowIdRef.current,
        account_id: accountId,
        story_id: metadata?.story_id,
        stage_preset: stageLabel,
        visibility_mode: visibilityMode,
        step: metadata?.step,
        action_name: metadata?.action_name,
        duration_ms: metadata?.duration_ms,
        metadata: metadata?.metadata,
      }).catch(() => {
        // Telemetry should never block story generation UX.
      });
    },
    [accountId, stageLabel, visibilityMode]
  );

  const storyStats = useMemo(() => {
    const markdown = result ? previewMarkdown : "";
    if (!markdown) return null;
    const wordCount = countWords(markdown);
    const readingMinutes = Math.max(1, Math.round(wordCount / 220));
    return { wordCount, readingMinutes };
  }, [result, previewMarkdown]);

  const safeToShare = useMemo(() => {
    if (!result) {
      return {
        status: "pending" as const,
        label: "Review Needed",
        reason: "Generate a story to evaluate quote confidence and source coverage.",
        avgConfidence: 0,
      };
    }
    const quoteConfidences = result.quotes
      .map((quote) => quote.confidence_score)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const avgConfidence =
      quoteConfidences.length > 0
        ? quoteConfidences.reduce((sum, value) => sum + value, 0) / quoteConfidences.length
        : 0;
    const confidenceOk = avgConfidence >= 0.72;
    if (confidenceOk && (visibilityMode === "ANONYMOUS" || namedPermissionConfirmed)) {
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
        reason: "Named mode requires customer permission confirmation before sharing.",
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
      result
        ? buildPackagingTemplates({
            accountName,
            markdown: previewMarkdown,
            quotes: result.quotes,
            stageLabel,
            visibilityMode,
          })
        : [],
    [accountName, previewMarkdown, result, stageLabel, visibilityMode]
  );

  const loadingStep =
    loadingProgress < 34 ? 0 : loadingProgress < 67 ? 1 : 2;
  const activeMarkdown = result ? previewMarkdown : "";
  const namedModeBlocked = visibilityMode === "NAMED" && !namedPermissionConfirmed;

  const isLengthDefault = orgDefaults?.default_story_length === storyLength;
  const isOutlineDefault = orgDefaults?.default_story_outline === storyOutline;
  const isTypeDefault = orgDefaults?.default_story_type === storyType;
  const isFormatDefault = orgDefaults?.default_story_format === selectedFormat;
  const onboardingWithinTarget = onboardingElapsedSeconds <= 60;

  useEffect(() => {
    savePersistedSettings({
      selectedStages,
      selectedTopics,
      customTitle,
      selectedFormat,
      storyLength,
      storyOutline,
      storyType,
      isAdvanced,
    });
  }, [
    selectedStages,
    selectedTopics,
    customTitle,
    selectedFormat,
    storyLength,
    storyOutline,
    storyType,
    isAdvanced,
  ]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (phase === "loading") {
          abortGeneration();
        }
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    const timer = requestAnimationFrame(() => {
      modalRef.current?.focus();
    });

    return () => {
      abortGeneration();
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(timer);
      previousFocusRef.current?.focus();
    };
  }, [abortGeneration, onClose, phase]);

  const loadSavedTemplates = useCallback(async () => {
    try {
      const response = await getSharedAssets();
      const templates = response.assets
        .map((asset) => parseSavedTemplate(asset))
        .filter((template): template is StoryTemplateOption => template !== null);
      setSavedTemplates(templates);
    } catch {
      // Shared template loading is best-effort.
    }
  }, []);

  useEffect(() => {
    void loadSavedTemplates();
  }, [loadSavedTemplates]);

  useEffect(() => {
    getStoryContextSettings()
      .then((settings) => {
        setOrgDefaults(settings);
        if (!persistedRef.current) {
          setStoryLength(settings.default_story_length ?? "MEDIUM");
          setStoryOutline(
            settings.default_story_outline ?? "CHRONOLOGICAL_JOURNEY"
          );
          setStoryType(settings.default_story_type ?? "FULL_ACCOUNT_JOURNEY");
          setSelectedFormat(settings.default_story_format ?? "");
        }
      })
      .catch(() => {
        // Keep local defaults when org settings are unavailable.
      });
  }, []);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(ONBOARDING_KEY) === "1";
      setShowOnboarding(!seen);
      if (seen) {
        setFirstStoryShared(true);
      }
    } catch {
      setShowOnboarding(false);
    }
  }, []);

  useEffect(() => {
    trackSellerEvent("modal_open", {
      step: "opened",
      metadata: {
        onboarding_visible: true,
      },
    });
    // Intentionally once per modal mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showOnboarding) {
      return;
    }
    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - flowOpenedAtRef.current) / 1000));
      setOnboardingElapsedSeconds(elapsed);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [showOnboarding]);

  useEffect(() => {
    if (phase === "preview" && result && !completionTelemetryRef.current.success) {
      completionTelemetryRef.current.success = true;
      setFirstStoryGenerated(true);
      const generationDuration =
        generationStartedAtRef.current != null
          ? Date.now() - generationStartedAtRef.current
          : undefined;
      trackSellerEvent("story_generated", {
        step: "preview",
        story_id: result.story_id ?? undefined,
        duration_ms: generationDuration,
      });
    }
  }, [phase, result, trackSellerEvent]);

  useEffect(() => {
    if (phase === "error" && error && !completionTelemetryRef.current.failed) {
      completionTelemetryRef.current.failed = true;
      const generationDuration =
        generationStartedAtRef.current != null
          ? Date.now() - generationStartedAtRef.current
          : undefined;
      trackSellerEvent("generation_failed", {
        step: "error",
        action_name: "story_generation_error",
        duration_ms: generationDuration,
        metadata: { error_message: error },
      });
    }
  }, [error, phase, trackSellerEvent]);

  const triggerGeneration = useCallback(
    (overrides?: Partial<{
      storyLength: StoryLength;
      storyOutline: StoryOutline;
      storyType: StoryTypeInput;
      selectedFormat: StoryFormat | "";
      selectedStages: FunnelStage[];
      selectedTopics: TaxonomyTopic[];
    }>) => {
      if (visibilityMode === "NAMED" && !namedPermissionConfirmed) {
        setError(
          "Named mode requires explicit customer permission confirmation before generation."
        );
        setPhase("error");
        return;
      }
      const effectiveStoryLength = overrides?.storyLength ?? storyLength;
      const effectiveStoryOutline = overrides?.storyOutline ?? storyOutline;
      const effectiveStoryType = overrides?.storyType ?? storyType;
      const effectiveStoryFormat = overrides?.selectedFormat ?? selectedFormat;
      const effectiveStages = overrides?.selectedStages ?? selectedStages;
      const effectiveTopics = overrides?.selectedTopics ?? selectedTopics;

      if (overrides?.storyLength) {
        setStoryLength(overrides.storyLength);
      }
      if (overrides?.storyOutline) {
        setStoryOutline(overrides.storyOutline);
      }
      if (overrides?.storyType) {
        setStoryType(overrides.storyType);
      }
      if (overrides?.selectedFormat !== undefined) {
        setSelectedFormat(overrides.selectedFormat);
      }
      if (overrides?.selectedStages) {
        handleStagesChange(overrides.selectedStages);
      }
      if (overrides?.selectedTopics) {
        setSelectedTopics(overrides.selectedTopics);
      }

      const audienceLabel =
        audienceMode === "EXEC"
          ? "Executive"
          : audienceMode === "PROCUREMENT"
            ? "Procurement"
            : "Champion";
      generationStartedAtRef.current = Date.now();
      completionTelemetryRef.current = { success: false, failed: false };
      trackSellerEvent("generation_started", {
        step: "generate_click",
        action_name: "generate_package",
        duration_ms: Date.now() - flowOpenedAtRef.current,
        metadata: {
          audience_mode: audienceMode,
          title_override: customTitle.trim().length > 0,
        },
      });
      void runStoryGeneration({
        account_id: accountId,
        funnel_stages: effectiveStages.length > 0 ? effectiveStages : undefined,
        filter_topics: effectiveTopics.length > 0 ? effectiveTopics : undefined,
        title:
          customTitle.trim() || `${accountName} ${stageLabel} ${audienceLabel} Story`,
        format: effectiveStoryFormat || undefined,
        story_length: effectiveStoryLength,
        story_outline: effectiveStoryOutline,
        story_type: effectiveStoryType,
      });
    },
    [
      accountId,
      accountName,
      audienceMode,
      customTitle,
      handleStagesChange,
      runStoryGeneration,
      selectedFormat,
      selectedStages,
      selectedTopics,
      setSelectedTopics,
      setError,
      setPhase,
      storyLength,
      storyOutline,
      storyType,
      stageLabel,
      trackSellerEvent,
      visibilityMode,
      namedPermissionConfirmed,
    ]
  );

  const runGeneration = useCallback(() => {
    triggerGeneration();
  }, [triggerGeneration]);

  const handleRegenerateVariant = useCallback((variant: "same" | "shorter" | "executive" | "proof") => {
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
  }, [trackSellerEvent, triggerGeneration]);

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
        story_id: result?.story_id ?? undefined,
        duration_ms: Date.now() - flowOpenedAtRef.current,
        metadata,
      });
      setFirstStoryShared(true);
      try {
        localStorage.setItem(ONBOARDING_KEY, "1");
      } catch {
        // Ignore storage errors in restricted environments.
      }
      setShowOnboarding(false);
    },
    onLandingPageCreated,
    previewMarkdown,
    result,
  });

  const handleCopyPackagingTemplate = useCallback(
    async (templateId: PackagingTemplate["id"]) => {
      const template = packagingTemplates.find((entry) => entry.id === templateId);
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
        story_id: result?.story_id ?? undefined,
        duration_ms: Date.now() - flowOpenedAtRef.current,
      });
      setFirstStoryShared(true);
      setShowOnboarding(false);
      try {
        localStorage.setItem(ONBOARDING_KEY, "1");
      } catch {
        // Ignore storage errors in restricted environments.
      }
    },
    [packagingTemplates, result?.story_id, trackSellerEvent]
  );

  const handleDismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    trackSellerEvent("library_action", {
      action_name: "dismiss_onboarding",
      step: "onboarding",
    });
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, [trackSellerEvent]);

  const handleVisibilityModeChange = useCallback(
    (mode: StoryVisibilityMode) => {
      setVisibilityMode(mode);
      trackSellerEvent("visibility_mode_selected", {
        action_name: mode.toLowerCase(),
        step: "quick_flow",
      });
    },
    [trackSellerEvent]
  );

  const handleApplyTemplate = useCallback(
    (templateId: string) => {
      const template = allTemplates.find((item) => item.id === templateId);
      if (!template) return;

      setActiveTemplateId(template.id);
      setStoryLength(template.values.storyLength);
      setStoryOutline(template.values.storyOutline);
      setStoryType(template.values.storyType);
      setSelectedFormat(template.values.storyFormat);
      handleStagesChange(template.values.selectedStages ?? []);
      setSelectedTopics(template.values.selectedTopics ?? []);
      setStoryTypeMode(
        template.values.storyType === "FULL_ACCOUNT_JOURNEY" ? "FULL" : "TOPIC"
      );
      setIsAdvanced(true);
      trackSellerEvent("preset_selected", {
        action_name: template.id,
        step: "template_gallery",
      });
    },
    [allTemplates, handleStagesChange, setSelectedTopics, trackSellerEvent]
  );

  const handleSaveCurrentTemplate = useCallback(async () => {
    const title = window.prompt("Name this reusable preset", "My Deal Preset");
    if (!title || title.trim().length < 2) {
      return;
    }
    setSavingTemplate(true);
    try {
      await createSharedAsset({
        asset_type: "TEMPLATE",
        title: title.trim(),
        description: "Saved from Story Generator",
        visibility: "ORG",
        metadata: {
          template_values: {
            story_length: storyLength,
            story_outline: storyOutline,
            story_type: storyType,
            story_format: selectedFormat || null,
            selected_stages: selectedStages,
            selected_topics: selectedTopics,
          },
        },
      });
      await loadSavedTemplates();
      showToast("Preset saved to template gallery", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preset");
      setPhase("error");
    } finally {
      setSavingTemplate(false);
    }
  }, [
    loadSavedTemplates,
    selectedFormat,
    selectedStages,
    selectedTopics,
    setError,
    setPhase,
    showToast,
    storyLength,
    storyOutline,
    storyType,
  ]);

  const handleApplyDealStagePreset = useCallback(
    (presetId: string) => {
      const preset = DEAL_STAGE_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      setDealStagePresetId(preset.id);
      setStoryLength(preset.values.storyLength);
      setStoryOutline(preset.values.storyOutline);
      setStoryType(preset.values.storyType);
      setSelectedFormat(preset.values.storyFormat);
      handleStagesChange(preset.values.selectedStages ?? []);
      setSelectedTopics(preset.values.selectedTopics ?? []);
      setStoryTypeMode(
        preset.values.storyType === "FULL_ACCOUNT_JOURNEY" ? "FULL" : "TOPIC"
      );
      trackSellerEvent("preset_selected", {
        action_name: preset.id,
        step: "deal_stage",
      });
    },
    [handleStagesChange, setSelectedTopics, trackSellerEvent]
  );

  useEffect(() => {
    if (visibilityMode === "ANONYMOUS") {
      setNamedPermissionConfirmed(false);
    }
  }, [visibilityMode]);

  useEffect(() => {
    if (storyTypeMode === "FULL") {
      setStoryType("FULL_ACCOUNT_JOURNEY");
      return;
    }
    if (storyType === "FULL_ACCOUNT_JOURNEY") {
      setStoryType(STORY_TYPE_TOPIC_OPTIONS[0]?.[0] ?? "industry_trend_validation");
    }
  }, [storyTypeMode, storyType]);

  useEffect(() => {
    const matched = allTemplates.find(
      (template) =>
        template.values.storyLength === storyLength &&
        template.values.storyOutline === storyOutline &&
        template.values.storyType === storyType &&
        template.values.storyFormat === selectedFormat
    );
    setActiveTemplateId(matched?.id ?? null);
  }, [allTemplates, selectedFormat, storyLength, storyOutline, storyType]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        ref={modalRef}
        className={`modal ${phase === "preview" ? "modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Generate Story"
        tabIndex={-1}
      >
        <div className="modal__header">
          <div>
            <h2 className="modal__title">
              {phase === "preview" ? "Story Preview" : "Generate Story"}
            </h2>
            <p className="modal__subtitle">{accountName}</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        <div className="modal__body">
          {phase === "form" && (
            <div className="story-form">
              <section className="story-form__quick">
                <h3 className="story-form__group-title">Quick Generate</h3>
                <p className="story-form__helper">
                  Generate in one click using your saved settings and org defaults.
                </p>
                <div className="story-form__guided">
                  <h4 className="story-form__group-title">Guided Quick Flow</h4>
                  <div className="story-type-toggle" role="radiogroup" aria-label="Deal stage preset">
                    {DEAL_STAGE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`story-type-toggle__option ${dealStagePresetId === preset.id ? "story-type-toggle__option--active" : ""}`}
                        onClick={() => handleApplyDealStagePreset(preset.id)}
                        role="radio"
                        aria-checked={dealStagePresetId === preset.id}
                        title={preset.description}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="form-grid-2">
                    <div className="form-field">
                      <label className="form-field__label" htmlFor="story-audience-mode">
                        Audience
                      </label>
                      <select
                        id="story-audience-mode"
                        className="form-field__input"
                        value={audienceMode}
                        onChange={(e) => {
                          const mode = e.target.value as StoryAudienceMode;
                          setAudienceMode(mode);
                          trackSellerEvent("library_action", {
                            action_name: `audience_${mode.toLowerCase()}`,
                            step: "quick_flow",
                          });
                        }}
                      >
                        <option value="CHAMPION">Champion Forward</option>
                        <option value="EXEC">Executive Recap</option>
                        <option value="PROCUREMENT">Proof for Procurement</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-field__label">Anonymization Mode</label>
                      <div className="story-type-toggle" role="radiogroup" aria-label="Anonymization mode">
                        <button
                          type="button"
                          className={`story-type-toggle__option ${visibilityMode === "ANONYMOUS" ? "story-type-toggle__option--active" : ""}`}
                          onClick={() => handleVisibilityModeChange("ANONYMOUS")}
                          role="radio"
                          aria-checked={visibilityMode === "ANONYMOUS"}
                        >
                          Anonymous
                        </button>
                        <button
                          type="button"
                          className={`story-type-toggle__option ${visibilityMode === "NAMED" ? "story-type-toggle__option--active" : ""}`}
                          onClick={() => handleVisibilityModeChange("NAMED")}
                          role="radio"
                          aria-checked={visibilityMode === "NAMED"}
                        >
                          Named
                        </button>
                      </div>
                    </div>
                  </div>
                  {visibilityMode === "NAMED" && (
                    <div className="alert alert--warning" role="note">
                      <label className="form-row" style={{ marginTop: 8 }}>
                        <input
                          type="checkbox"
                          checked={namedPermissionConfirmed}
                          onChange={(e) => setNamedPermissionConfirmed(e.target.checked)}
                        />
                        I confirm customer permission for named publishing.
                      </label>
                    </div>
                  )}
                </div>
                {showOnboarding && (
                  <div className="story-onboarding" role="note" aria-live="polite">
                    <div className="story-onboarding__header">
                      <strong>60-second first story sprint</strong>
                      <span
                        className={`story-onboarding__timer ${
                          onboardingWithinTarget ? "story-onboarding__timer--ok" : "story-onboarding__timer--late"
                        }`}
                      >
                        {onboardingElapsedSeconds}s
                      </span>
                    </div>
                    <div className="story-onboarding__copy">
                      Pick a stage, generate, then use a package action to share.
                    </div>
                    <div className="story-onboarding__steps">
                      <div className="story-onboarding__step">
                        <span className="badge badge--success">Done</span>
                        Stage preset selected
                      </div>
                      <div className="story-onboarding__step">
                        <span className="badge badge--success">Done</span>
                        Visibility mode selected
                      </div>
                      <div className="story-onboarding__step">
                        <span
                          className={`badge ${
                            firstStoryGenerated ? "badge--success" : "badge--draft"
                          }`}
                        >
                          {firstStoryGenerated ? "Done" : "Pending"}
                        </span>
                        Generate first story
                      </div>
                      <div className="story-onboarding__step">
                        <span
                          className={`badge ${
                            firstStoryShared ? "badge--success" : "badge--draft"
                          }`}
                        >
                          {firstStoryShared ? "Done" : "Pending"}
                        </span>
                        Share or package output
                      </div>
                    </div>
                    <div className="story-onboarding__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={handleDismissOnboarding}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                <div className="story-template-grid" role="list" aria-label="Story templates">
                  {allTemplates.map((template) => {
                    const selected = activeTemplateId === template.id;
                    const assetId = template.assetId;
                    return (
                      <div
                        key={template.id}
                        role="listitem"
                        className={`story-template ${selected ? "story-template--active" : ""}`}
                      >
                        <button
                          type="button"
                          className="story-template__button"
                          onClick={() => handleApplyTemplate(template.id)}
                          aria-pressed={selected}
                        >
                          <span className="story-template__title">{template.label}</span>
                          <span className="story-template__description">
                            {template.description}
                          </span>
                          {template.source === "saved" ? (
                            <span className="form-default-badge">Saved Preset</span>
                          ) : null}
                        </button>
                        {template.source === "saved" && assetId ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              try {
                                await deleteSharedAsset(assetId);
                                await loadSavedTemplates();
                                showToast("Preset deleted", "info");
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : "Failed to delete preset"
                                );
                                setPhase("error");
                              }
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="story-form__quick-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={runGeneration}
                    disabled={namedModeBlocked}
                    title={
                      namedModeBlocked
                        ? "Confirm customer permission to use named mode."
                        : undefined
                    }
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M8 2v12M2 8h12" />
                    </svg>
                    Generate + Package
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setIsAdvanced((prev) => !prev)}
                    aria-expanded={isAdvanced}
                  >
                    {isAdvanced ? "Hide Customization" : "Customize Settings"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void handleSaveCurrentTemplate()}
                    disabled={savingTemplate}
                  >
                    {savingTemplate ? "Saving..." : "Save as Preset"}
                  </button>
                </div>
              </section>

              {isAdvanced && (
                <>
                  <section className="story-form__group">
                    <h4 className="story-form__group-title">Step 1: Focus</h4>
                    <p className="story-form__helper">
                      Leave these blank to use all available transcript context.
                    </p>
                    <MultiSelect
                      label="Funnel Stages"
                      options={FUNNEL_STAGE_OPTIONS}
                      selected={selectedStages}
                      onChange={handleStagesChange}
                      placeholder="All stages (no filter)"
                    />

                    <MultiSelect
                      label="Topics"
                      options={topicOptions}
                      selected={selectedTopics}
                      onChange={(v) => setSelectedTopics(v as TaxonomyTopic[])}
                      placeholder="All topics (no filter)"
                      grouped
                    />

                    <div className="form-field">
                      <label className="form-field__label" htmlFor="story-custom-title">
                        Custom Title
                        <span className="form-field__hint">Optional</span>
                      </label>
                      <input
                        id="story-custom-title"
                        type="text"
                        className="form-field__input"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        placeholder="Auto-generated if left blank"
                      />
                    </div>
                  </section>

                  <section className="story-form__group">
                    <h4 className="story-form__group-title">Step 2: Format</h4>
                    <FormatSelector value={selectedFormat} onChange={setSelectedFormat} />
                    {isFormatDefault && <span className="form-default-badge">Default</span>}

                    <div className="form-field">
                      <label className="form-field__label" htmlFor="story-length">
                        Story Length
                        {isLengthDefault && <span className="form-default-badge">Default</span>}
                      </label>
                      <select
                        id="story-length"
                        className="form-field__input"
                        value={storyLength}
                        onChange={(e) => setStoryLength(e.target.value as StoryLength)}
                      >
                        {STORY_LENGTH_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label className="form-field__label" htmlFor="story-outline">
                        Story Outline
                        {isOutlineDefault && <span className="form-default-badge">Default</span>}
                      </label>
                      <select
                        id="story-outline"
                        className="form-field__input"
                        value={storyOutline}
                        onChange={(e) =>
                          setStoryOutline(e.target.value as StoryOutline)
                        }
                      >
                        {STORY_OUTLINE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="story-form__group">
                    <h4 className="story-form__group-title">Step 3: Type</h4>
                    <p className="story-form__helper">
                      Pick full-journey mode or search for a topic-specific story.
                    </p>

                    <div className="story-type-toggle" role="radiogroup" aria-label="Story type mode">
                      <button
                        type="button"
                        className={`story-type-toggle__option ${storyTypeMode === "FULL" ? "story-type-toggle__option--active" : ""}`}
                        onClick={() => setStoryTypeMode("FULL")}
                        role="radio"
                        aria-checked={storyTypeMode === "FULL"}
                      >
                        Full Account Journey
                      </button>
                      <button
                        type="button"
                        className={`story-type-toggle__option ${storyTypeMode === "TOPIC" ? "story-type-toggle__option--active" : ""}`}
                        onClick={() => setStoryTypeMode("TOPIC")}
                        role="radio"
                        aria-checked={storyTypeMode === "TOPIC"}
                      >
                        Topic-Specific Story
                      </button>
                    </div>

                    {storyTypeMode === "TOPIC" && (
                      <div className="story-type-picker">
                        <label className="form-field__label" htmlFor="story-type-search">
                          Search Topics
                        </label>
                        <input
                          id="story-type-search"
                          type="search"
                          className="form-field__input"
                          value={storyTypeSearch}
                          onChange={(e) => setStoryTypeSearch(e.target.value)}
                          placeholder="Search by topic name"
                        />
                        <label className="form-field__label" htmlFor="story-type-select">
                          Story Topic
                          {isTypeDefault && <span className="form-default-badge">Default</span>}
                        </label>
                        <select
                          id="story-type-select"
                          className="form-field__input"
                          value={storyType === "FULL_ACCOUNT_JOURNEY" ? "" : storyType}
                          onChange={(e) => setStoryType(e.target.value as StoryTypeInput)}
                        >
                          {filteredStoryTypeOptions.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </section>

                  <div className="story-form__actions">
                    <button type="button" className="btn btn--secondary" onClick={onClose}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={runGeneration}
                      disabled={namedModeBlocked}
                      title={
                        namedModeBlocked
                          ? "Confirm customer permission to use named mode."
                          : undefined
                      }
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M8 2v12M2 8h12" />
                      </svg>
                      Generate + Package
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === "loading" && (
            <StoryLoadingSection
              handleCancelGeneration={handleCancelGeneration}
              loadingMessage={loadingMessage}
              loadingProgress={loadingProgress}
              loadingStep={loadingStep}
              streamedMarkdown={streamedMarkdown}
            />
          )}

          {phase === "preview" && result && (
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
          )}

          {phase === "error" && (
            <StoryErrorSection
              error={error}
              handleBackToForm={handleBackToForm}
              runGeneration={runGeneration}
            />
          )}
        </div>
      </div>
    </div>
  );
}
