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
 *   - onboarding state + dismiss/share handlers
 *   - completion / failure telemetry effects
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
  type StoryFormat,
  type StoryLength,
  type StoryOutline,
  type StoryTypeInput,
} from "../../types/taxonomy";
import {
  createSharedAsset,
  deleteSharedAsset,
  getAvailableAIProviders,
  getSharedAssets,
  getStoryContextSettings,
  type StoryContextSettings,
  type BuildStoryRequest,
} from "../../lib/api";
import { useToast } from "../Toast";
import {
  type AIModelOption,
  type PersistedStorySettings,
  type StoryGenerationOverrides,
  parseSavedTemplate,
  loadPersistedSettings,
  savePersistedSettings,
  loadDefaultStoryModePreference,
  buildStoryGenerationRequest,
} from "./useStoryFormState.helpers";
import { useStoryOnboarding } from "./useStoryFormState.onboarding";

export interface UseStoryFormStateOptions {
  accountId: string;
  accountName: string;
  flowOpenedAt: number;
  onError: (message: string) => void;
  onPhaseError: () => void;
  /** Current phase from useStoryGeneration (for completion telemetry). */
  phase: "form" | "loading" | "preview" | "error";
  /** Current error from useStoryGeneration (for failure telemetry). */
  error: string;
  /** Current result from useStoryGeneration (for completion telemetry). */
  result: import("../../lib/api").BuildStoryResponse | null;
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStoryFormState(options: UseStoryFormStateOptions) {
  const {
    accountId,
    accountName,
    error: generationError,
    flowOpenedAt,
    onError,
    onPhaseError,
    phase,
    result,
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
  const [aiModelOptions, setAiModelOptions] = useState<AIModelOption[]>([]);
  const [selectedAIModelKey, setSelectedAIModelKey] = useState("");

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
  const selectedAIModel = useMemo(
    () =>
      aiModelOptions.find(
        (option) =>
          `${option.provider}:${option.model}` === selectedAIModelKey,
      ) ?? null,
    [aiModelOptions, selectedAIModelKey],
  );

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

  useEffect(() => {
    getAvailableAIProviders()
      .then((catalog) => {
        const options = catalog.org_providers
          .filter((provider) => provider.is_active)
          .flatMap((provider) =>
            (provider.available_models ?? []).map((model) => ({
              provider: provider.provider as "openai" | "anthropic" | "google",
              model,
            })),
          );

        setAiModelOptions(options);
        if (options.length === 0) {
          setSelectedAIModelKey("");
          return;
        }

        setSelectedAIModelKey((current) => {
          if (
            current &&
            options.some(
              (option) => `${option.provider}:${option.model}` === current,
            )
          ) {
            return current;
          }

          const defaultProvider = catalog.org_providers.find(
            (provider) => provider.is_default,
          );
          if (defaultProvider?.default_model) {
            const defaultKey = `${defaultProvider.provider}:${defaultProvider.default_model}`;
            if (
              options.some(
                (option) =>
                  `${option.provider}:${option.model}` === defaultKey,
              )
            ) {
              return defaultKey;
            }
          }

          const first = options[0];
          return `${first.provider}:${first.model}`;
        });
      })
      .catch(() => {
        setAiModelOptions([]);
        setSelectedAIModelKey("");
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

  // ── Onboarding state ──────────────────────────────────────────────────

  const {
    showOnboarding,
    firstStoryShared,
    onboardingElapsedSeconds,
    onboardingWithinTarget,
    handleDismissOnboarding,
    handleShareAction,
  } = useStoryOnboarding({
    flowOpenedAt,
    trackSellerEvent,
  });
  const [firstStoryGenerated, setFirstStoryGenerated] = useState(false);

  // ── Completion / failure telemetry effects ────────────────────────────

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
    if (phase === "error" && generationError && !completionTelemetryRef.current.failed) {
      completionTelemetryRef.current.failed = true;
      const generationDuration =
        generationStartedAtRef.current != null
          ? Date.now() - generationStartedAtRef.current
          : undefined;
      trackSellerEvent("generation_failed", {
        step: "error",
        action_name: "story_generation_error",
        duration_ms: generationDuration,
        metadata: { error_message: generationError },
      });
    }
  }, [generationError, phase, trackSellerEvent]);

  // ── Generation trigger ──────────────────────────────────────────────────

  const triggerGeneration = useCallback(
    (overrides?: StoryGenerationOverrides) => {
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
      void runStoryGeneration(
        buildStoryGenerationRequest({
          accountId,
          accountName,
          customTitle,
          stageLabel,
          audienceMode,
          selectedAIModel,
          storyLength: effectiveStoryLength,
          storyOutline: effectiveStoryOutline,
          storyType: effectiveStoryType,
          selectedFormat: effectiveStoryFormat,
          selectedStages: effectiveStages,
          selectedTopics: effectiveTopics,
        })
      );
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
      selectedAIModel,
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
    aiModelOptions,
    selectedAIModelKey,
    setSelectedAIModelKey,

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

    // Onboarding
    showOnboarding,
    onboardingElapsedSeconds,
    onboardingWithinTarget,
    firstStoryGenerated,
    firstStoryShared,

    // Generation
    triggerGeneration,
    runGeneration,

    // Handlers
    handleVisibilityModeChange,
    handleApplyTemplate,
    handleSaveCurrentTemplate,
    handleApplyDealStagePreset,
    handleDeleteSavedTemplate,
    handleDismissOnboarding,
    handleShareAction,
  };
}
