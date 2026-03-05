import {
  STORY_TYPE_TOPIC_OPTIONS,
  type StoryTemplateOption,
  type StoryVisibilityMode,
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
import type { BuildStoryRequest, SharedAsset } from "../../lib/api";

export interface PersistedStorySettings {
  selectedStages: FunnelStage[];
  selectedTopics: TaxonomyTopic[];
  customTitle: string;
  selectedFormat: StoryFormat | "";
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  isAdvanced: boolean;
}

export interface AIModelOption {
  provider: "openai" | "anthropic" | "google";
  model: string;
}

export interface StoryGenerationOverrides {
  storyLength?: StoryLength;
  storyOutline?: StoryOutline;
  storyType?: StoryTypeInput;
  selectedFormat?: StoryFormat | "";
  selectedStages?: FunnelStage[];
  selectedTopics?: TaxonomyTopic[];
}

interface BuildStoryRequestInput {
  accountId: string;
  accountName: string;
  customTitle: string;
  stageLabel: string;
  audienceMode: "CHAMPION" | "EXEC" | "PROCUREMENT";
  selectedAIModel: AIModelOption | null;
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  selectedFormat: StoryFormat | "";
  selectedStages: FunnelStage[];
  selectedTopics: TaxonomyTopic[];
}

export const PERSIST_KEY = "story_generator_preferences_v1";
export const ONBOARDING_KEY = "story_generator_onboarding_seen_v1";

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

export function parseSavedTemplate(asset: SharedAsset): StoryTemplateOption | null {
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
        (stage): stage is FunnelStage => typeof stage === "string" && stage in FUNNEL_STAGE_LABELS
      )
    : undefined;
  const selectedTopics = Array.isArray(rawValues.selected_topics)
    ? rawValues.selected_topics.filter(
        (topic): topic is TaxonomyTopic => typeof topic === "string" && topic in TOPIC_LABELS
      )
    : undefined;

  const storyFormat =
    typeof rawFormat === "string" && STORY_FORMAT_LIST.includes(rawFormat as StoryFormat)
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

export function loadPersistedSettings(): PersistedStorySettings | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedStorySettings;
  } catch {
    return null;
  }
}

export function savePersistedSettings(settings: PersistedStorySettings): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export function loadDefaultStoryModePreference(): StoryVisibilityMode {
  try {
    const raw = localStorage.getItem("user_preferences_v1");
    if (!raw) return "ANONYMOUS";
    const parsed = JSON.parse(raw) as { default_story_mode?: string };
    return parsed.default_story_mode === "named" ? "NAMED" : "ANONYMOUS";
  } catch {
    return "ANONYMOUS";
  }
}

export function buildStoryGenerationRequest(input: BuildStoryRequestInput): BuildStoryRequest {
  const audienceLabel =
    input.audienceMode === "EXEC"
      ? "Executive"
      : input.audienceMode === "PROCUREMENT"
        ? "Procurement"
        : "Champion";

  return {
    account_id: input.accountId,
    funnel_stages: input.selectedStages.length > 0 ? input.selectedStages : undefined,
    filter_topics: input.selectedTopics.length > 0 ? input.selectedTopics : undefined,
    title: input.customTitle.trim() || `${input.accountName} ${input.stageLabel} ${audienceLabel} Story`,
    format: input.selectedFormat || undefined,
    story_length: input.storyLength,
    story_outline: input.storyOutline,
    story_type: input.storyType,
    ai_provider: input.selectedAIModel?.provider,
    ai_model: input.selectedAIModel?.model,
  };
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    // Ignore storage errors in restricted environments.
  }
}
