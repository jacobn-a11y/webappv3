import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  StoryErrorSection,
  StoryLoadingSection,
} from "./story-generator/StoryModalSections";
import { StoryPreviewStep } from "./story-generator/StoryPreviewStep";
import { useQuoteSelection } from "./story-generator/useQuoteSelection";
import { useStoryGeneration } from "./story-generator/useStoryGeneration";
import {
  StoryFormStep,
  BUILT_IN_STORY_TEMPLATES,
  DEAL_STAGE_PRESETS,
  STORY_TYPE_TOPIC_OPTIONS,
  type StoryTypeMode,
  type StoryVisibilityMode,
  type StoryAudienceMode,
  type StoryTemplateOption,
} from "./story-generator/StoryFormStep";
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
  type StoryContextSettings,
} from "../lib/api";
import { useToast } from "./Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const PERSIST_KEY = "story_generator_preferences_v1";
const ONBOARDING_KEY = "story_generator_onboarding_seen_v1";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function createFlowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `story-flow-${crypto.randomUUID()}`;
  }
  return `story-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ─── Main Component (Shell) ──────────────────────────────────────────────────

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

  const namedModeBlocked = visibilityMode === "NAMED" && !namedPermissionConfirmed;

  const isLengthDefault = orgDefaults?.default_story_length === storyLength;
  const isOutlineDefault = orgDefaults?.default_story_outline === storyOutline;
  const isTypeDefault = orgDefaults?.default_story_type === storyType;
  const isFormatDefault = orgDefaults?.default_story_format === selectedFormat;
  const onboardingWithinTarget = onboardingElapsedSeconds <= 60;
  const loadingStep =
    loadingProgress < 34 ? 0 : loadingProgress < 67 ? 1 : 2;

  // ─── Effects ──────────────────────────────────────────────────────────────

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

  // ─── Generation trigger ────────────────────────────────────────────────────

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

  // ─── Form-step handlers ────────────────────────────────────────────────────

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

  const handleDeleteSavedTemplate = useCallback(
    async (assetId: string) => {
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
    },
    [loadSavedTemplates, setError, setPhase, showToast]
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

  const handleShareAction = useCallback(() => {
    setFirstStoryShared(true);
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

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
            <StoryFormStep
              dealStagePresetId={dealStagePresetId}
              audienceMode={audienceMode}
              visibilityMode={visibilityMode}
              namedPermissionConfirmed={namedPermissionConfirmed}
              namedModeBlocked={namedModeBlocked}
              showOnboarding={showOnboarding}
              onboardingElapsedSeconds={onboardingElapsedSeconds}
              onboardingWithinTarget={onboardingWithinTarget}
              firstStoryGenerated={firstStoryGenerated}
              firstStoryShared={firstStoryShared}
              allTemplates={allTemplates}
              activeTemplateId={activeTemplateId}
              savingTemplate={savingTemplate}
              isAdvanced={isAdvanced}
              selectedStages={selectedStages}
              selectedTopics={selectedTopics}
              topicOptions={topicOptions}
              customTitle={customTitle}
              selectedFormat={selectedFormat}
              storyLength={storyLength}
              storyOutline={storyOutline}
              storyType={storyType}
              storyTypeMode={storyTypeMode}
              storyTypeSearch={storyTypeSearch}
              filteredStoryTypeOptions={filteredStoryTypeOptions}
              isLengthDefault={isLengthDefault}
              isOutlineDefault={isOutlineDefault}
              isTypeDefault={isTypeDefault}
              isFormatDefault={isFormatDefault}
              onClose={onClose}
              runGeneration={runGeneration}
              handleApplyDealStagePreset={handleApplyDealStagePreset}
              handleApplyTemplate={handleApplyTemplate}
              handleSaveCurrentTemplate={() => void handleSaveCurrentTemplate()}
              handleDismissOnboarding={handleDismissOnboarding}
              handleVisibilityModeChange={handleVisibilityModeChange}
              handleStagesChange={handleStagesChange}
              setAudienceMode={setAudienceMode}
              setNamedPermissionConfirmed={setNamedPermissionConfirmed}
              setIsAdvanced={setIsAdvanced}
              setCustomTitle={setCustomTitle}
              setSelectedFormat={setSelectedFormat}
              setStoryLength={setStoryLength}
              setStoryOutline={setStoryOutline}
              setStoryType={setStoryType}
              setStoryTypeMode={setStoryTypeMode}
              setStoryTypeSearch={setStoryTypeSearch}
              setSelectedTopics={setSelectedTopics}
              handleDeleteSavedTemplate={(assetId) => void handleDeleteSavedTemplate(assetId)}
              trackSellerEvent={trackSellerEvent}
            />
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
            <StoryPreviewStep
              accountName={accountName}
              editMode={editMode}
              flowOpenedAt={flowOpenedAtRef.current}
              handleBackToForm={handleBackToForm}
              namedPermissionConfirmed={namedPermissionConfirmed}
              onClose={onClose}
              onLandingPageCreated={onLandingPageCreated}
              onShareAction={handleShareAction}
              previewMarkdown={previewMarkdown}
              result={result}
              setEditMode={setEditMode}
              setError={setError}
              setPhase={setPhase}
              setPreviewMarkdown={setPreviewMarkdown}
              stageLabel={stageLabel}
              trackSellerEvent={trackSellerEvent}
              triggerGeneration={triggerGeneration}
              visibilityMode={visibilityMode}
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
