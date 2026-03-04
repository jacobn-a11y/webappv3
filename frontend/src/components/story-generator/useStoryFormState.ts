/**
 * useStoryFormState -- manages all form-level state for the story generator.
 *
 * Owns:
 *   - persisted settings (load/save from localStorage)
 *   - quote-selection hook delegation
 *   - story format, length, outline, type controls
 *   - visibility / audience / deal-stage-preset controls
 *   - template management (load, save, delete, apply)
 *   - org defaults loading
 *   - generation trigger (builds the request and calls runStoryGeneration)
 *   - derived "org default" indicators
 *   - filtered story type options
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuoteSelection } from "./useQuoteSelection";
import {
  BUILT_IN_STORY_TEMPLATES,
  DEAL_STAGE_PRESETS,
  STORY_TYPE_TOPIC_OPTIONS,
  type StoryTypeMode,
  type StoryVisibilityMode,
  type StoryAudienceMode,
  type StoryTemplateOption,
} from "./StoryFormStep";
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
} from "../../types/taxonomy";
import {
  createSharedAsset,
  deleteSharedAsset,
  getSharedAssets,
  getStoryContextSettings,
  type SharedAsset,
  type StoryContextSettings,
  type BuildStoryRequest,
} from "../../lib/api";
import { useToast } from "../Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface UseStoryFormStateOptions {
  accountId: string;
  accountName: string;
  flowOpenedAt: number;
  onError: (message: string) => void;
  onPhaseError: () => void;
  runStoryGeneration: (body: BuildStoryRequest) => Promise<void>;
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERSIST_KEY = "story_generator_preferences_v1";

const STORY_LENGTH_VALUES = Object.keys(STORY_LENGTH_LABELS) as StoryLength[];
const STORY_OUTLINE_VALUES = Object.keys(
  STORY_OUTLINE_LABELS,
) as StoryOutline[];
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
          typeof stage === "string" && stage in FUNNEL_STAGE_LABELS,
      )
    : undefined;
  const selectedTopics = Array.isArray(rawValues.selected_topics)
    ? rawValues.selected_topics.filter(
        (topic): topic is TaxonomyTopic =>
          typeof topic === "string" && topic in TOPIC_LABELS,
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStoryFormState(options: UseStoryFormStateOptions) {
  const {
    accountId,
    accountName,
    flowOpenedAt,
    onError,
    onPhaseError,
    runStoryGeneration,
    trackSellerEvent,
  } = options;

  const persistedRef = useRef<PersistedStorySettings | null>(
    loadPersistedSettings(),
  );
  const generationStartedAtRef = useRef<number | null>(null);
  const completionTelemetryRef = useRef<{ success: boolean; failed: boolean }>({
    success: false,
    failed: false,
  });

  // ── Quote selection ─────────────────────────────────────────────────────

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

  // ── Form state ──────────────────────────────────────────────────────────

  const [customTitle, setCustomTitle] = useState(
    persistedRef.current?.customTitle ?? "",
  );
  const [selectedFormat, setSelectedFormat] = useState<StoryFormat | "">(
    persistedRef.current?.selectedFormat ?? "",
  );
  const [storyLength, setStoryLength] = useState<StoryLength>(
    persistedRef.current?.storyLength ?? "MEDIUM",
  );
  const [storyOutline, setStoryOutline] = useState<StoryOutline>(
    persistedRef.current?.storyOutline ?? "CHRONOLOGICAL_JOURNEY",
  );
  const [storyType, setStoryType] = useState<StoryTypeInput>(
    persistedRef.current?.storyType ?? "FULL_ACCOUNT_JOURNEY",
  );
  const [isAdvanced, setIsAdvanced] = useState<boolean>(
    persistedRef.current?.isAdvanced ?? false,
  );
  const [storyTypeMode, setStoryTypeMode] = useState<StoryTypeMode>(
    (persistedRef.current?.storyType ?? "FULL_ACCOUNT_JOURNEY") ===
      "FULL_ACCOUNT_JOURNEY"
      ? "FULL"
      : "TOPIC",
  );
  const [storyTypeSearch, setStoryTypeSearch] = useState("");
  const [dealStagePresetId, setDealStagePresetId] =
    useState<string>("evaluation");
  const [audienceMode, setAudienceMode] =
    useState<StoryAudienceMode>("CHAMPION");
  const [visibilityMode, setVisibilityMode] = useState<StoryVisibilityMode>(
    loadDefaultStoryModePreference(),
  );
  const [namedPermissionConfirmed, setNamedPermissionConfirmed] =
    useState(false);

  // ── Template state ──────────────────────────────────────────────────────

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [orgDefaults, setOrgDefaults] = useState<StoryContextSettings | null>(
    null,
  );
  const [savedTemplates, setSavedTemplates] = useState<StoryTemplateOption[]>(
    [],
  );
  const [savingTemplate, setSavingTemplate] = useState(false);
  const { showToast } = useToast();

  // ── Derived values ──────────────────────────────────────────────────────

  const filteredStoryTypeOptions = useMemo(() => {
    const needle = storyTypeSearch.trim().toLowerCase();
    if (!needle) return STORY_TYPE_TOPIC_OPTIONS;
    return STORY_TYPE_TOPIC_OPTIONS.filter(([, label]) =>
      label.toLowerCase().includes(needle),
    );
  }, [storyTypeSearch]);

  const allTemplates = useMemo(
    () => [...BUILT_IN_STORY_TEMPLATES, ...savedTemplates],
    [savedTemplates],
  );

  const stageLabel = useMemo(
    () =>
      DEAL_STAGE_PRESETS.find((preset) => preset.id === dealStagePresetId)
        ?.label ?? "Evaluation",
    [dealStagePresetId],
  );

  const namedModeBlocked =
    visibilityMode === "NAMED" && !namedPermissionConfirmed;

  const isLengthDefault = orgDefaults?.default_story_length === storyLength;
  const isOutlineDefault = orgDefaults?.default_story_outline === storyOutline;
  const isTypeDefault = orgDefaults?.default_story_type === storyType;
  const isFormatDefault = orgDefaults?.default_story_format === selectedFormat;

  // ── Persistence effect ──────────────────────────────────────────────────

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

  // ── Template loading ────────────────────────────────────────────────────

  const loadSavedTemplates = useCallback(async () => {
    try {
      const response = await getSharedAssets();
      const templates = response.assets
        .map((asset) => parseSavedTemplate(asset))
        .filter(
          (template): template is StoryTemplateOption => template !== null,
        );
      setSavedTemplates(templates);
    } catch {
      // Shared template loading is best-effort.
    }
  }, []);

  useEffect(() => {
    void loadSavedTemplates();
  }, [loadSavedTemplates]);

  // ── Org defaults loading ────────────────────────────────────────────────

  useEffect(() => {
    getStoryContextSettings()
      .then((settings) => {
        setOrgDefaults(settings);
        if (!persistedRef.current) {
          setStoryLength(settings.default_story_length ?? "MEDIUM");
          setStoryOutline(
            settings.default_story_outline ?? "CHRONOLOGICAL_JOURNEY",
          );
          setStoryType(
            settings.default_story_type ?? "FULL_ACCOUNT_JOURNEY",
          );
          setSelectedFormat(settings.default_story_format ?? "");
        }
      })
      .catch(() => {
        // Keep local defaults when org settings are unavailable.
      });
  }, []);

  // ── Sync effects ────────────────────────────────────────────────────────

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
      setStoryType(
        STORY_TYPE_TOPIC_OPTIONS[0]?.[0] ?? "industry_trend_validation",
      );
    }
  }, [storyTypeMode, storyType]);

  useEffect(() => {
    const matched = allTemplates.find(
      (template) =>
        template.values.storyLength === storyLength &&
        template.values.storyOutline === storyOutline &&
        template.values.storyType === storyType &&
        template.values.storyFormat === selectedFormat,
    );
    setActiveTemplateId(matched?.id ?? null);
  }, [allTemplates, selectedFormat, storyLength, storyOutline, storyType]);

  // ── Generation trigger ──────────────────────────────────────────────────

  const triggerGeneration = useCallback(
    (
      overrides?: Partial<{
        storyLength: StoryLength;
        storyOutline: StoryOutline;
        storyType: StoryTypeInput;
        selectedFormat: StoryFormat | "";
        selectedStages: FunnelStage[];
        selectedTopics: TaxonomyTopic[];
      }>,
    ) => {
      if (visibilityMode === "NAMED" && !namedPermissionConfirmed) {
        onError(
          "Named mode requires explicit customer permission confirmation before generation.",
        );
        onPhaseError();
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
        duration_ms: Date.now() - flowOpenedAt,
        metadata: {
          audience_mode: audienceMode,
          title_override: customTitle.trim().length > 0,
        },
      });
      void runStoryGeneration({
        account_id: accountId,
        funnel_stages:
          effectiveStages.length > 0 ? effectiveStages : undefined,
        filter_topics:
          effectiveTopics.length > 0 ? effectiveTopics : undefined,
        title:
          customTitle.trim() ||
          `${accountName} ${stageLabel} ${audienceLabel} Story`,
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
      flowOpenedAt,
      handleStagesChange,
      namedPermissionConfirmed,
      onError,
      onPhaseError,
      runStoryGeneration,
      selectedFormat,
      selectedStages,
      selectedTopics,
      setSelectedTopics,
      stageLabel,
      storyLength,
      storyOutline,
      storyType,
      trackSellerEvent,
      visibilityMode,
    ],
  );

  const runGeneration = useCallback(() => {
    triggerGeneration();
  }, [triggerGeneration]);

  // ── Form handlers ───────────────────────────────────────────────────────

  const handleVisibilityModeChange = useCallback(
    (mode: StoryVisibilityMode) => {
      setVisibilityMode(mode);
      trackSellerEvent("visibility_mode_selected", {
        action_name: mode.toLowerCase(),
        step: "quick_flow",
      });
    },
    [trackSellerEvent],
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
        template.values.storyType === "FULL_ACCOUNT_JOURNEY"
          ? "FULL"
          : "TOPIC",
      );
      setIsAdvanced(true);
      trackSellerEvent("preset_selected", {
        action_name: template.id,
        step: "template_gallery",
      });
    },
    [allTemplates, handleStagesChange, setSelectedTopics, trackSellerEvent],
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
      onError(err instanceof Error ? err.message : "Failed to save preset");
      onPhaseError();
    } finally {
      setSavingTemplate(false);
    }
  }, [
    loadSavedTemplates,
    onError,
    onPhaseError,
    selectedFormat,
    selectedStages,
    selectedTopics,
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
        preset.values.storyType === "FULL_ACCOUNT_JOURNEY" ? "FULL" : "TOPIC",
      );
      trackSellerEvent("preset_selected", {
        action_name: preset.id,
        step: "deal_stage",
      });
    },
    [handleStagesChange, setSelectedTopics, trackSellerEvent],
  );

  const handleDeleteSavedTemplate = useCallback(
    async (assetId: string) => {
      try {
        await deleteSharedAsset(assetId);
        await loadSavedTemplates();
        showToast("Preset deleted", "info");
      } catch (err) {
        onError(
          err instanceof Error ? err.message : "Failed to delete preset",
        );
        onPhaseError();
      }
    },
    [loadSavedTemplates, onError, onPhaseError, showToast],
  );

  // ── Telemetry refs ──────────────────────────────────────────────────────

  return {
    // Quote selection
    selectedStages,
    selectedTopics,
    topicOptions,
    setSelectedTopics,
    handleStagesChange,

    // Form state
    customTitle,
    setCustomTitle,
    selectedFormat,
    setSelectedFormat,
    storyLength,
    setStoryLength,
    storyOutline,
    setStoryOutline,
    storyType,
    setStoryType,
    isAdvanced,
    setIsAdvanced,
    storyTypeMode,
    setStoryTypeMode,
    storyTypeSearch,
    setStoryTypeSearch,
    dealStagePresetId,
    audienceMode,
    setAudienceMode,
    visibilityMode,
    namedPermissionConfirmed,
    setNamedPermissionConfirmed,

    // Templates
    allTemplates,
    activeTemplateId,
    savingTemplate,

    // Derived values
    filteredStoryTypeOptions,
    stageLabel,
    namedModeBlocked,
    isLengthDefault,
    isOutlineDefault,
    isTypeDefault,
    isFormatDefault,

    // Generation
    triggerGeneration,
    runGeneration,
    generationStartedAtRef,
    completionTelemetryRef,

    // Handlers
    handleVisibilityModeChange,
    handleApplyTemplate,
    handleSaveCurrentTemplate,
    handleApplyDealStagePreset,
    handleDeleteSavedTemplate,
  };
}
