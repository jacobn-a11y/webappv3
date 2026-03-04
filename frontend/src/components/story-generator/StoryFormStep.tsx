import { useMemo, type Dispatch, type SetStateAction } from "react";
import { MultiSelect } from "../MultiSelect";
import { FormatSelector } from "../FormatSelector";
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

// ─── Types ────────────────────────────────────────────────────────────────────

export type StoryTypeMode = "FULL" | "TOPIC";
export type StoryVisibilityMode = "ANONYMOUS" | "NAMED";
export type StoryAudienceMode = "CHAMPION" | "EXEC" | "PROCUREMENT";

export interface StoryTemplateValues {
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  storyFormat: StoryFormat | "";
  selectedStages?: FunnelStage[];
  selectedTopics?: TaxonomyTopic[];
}

export interface StoryTemplateOption {
  id: string;
  label: string;
  description: string;
  values: StoryTemplateValues;
  source: "built_in" | "saved";
  assetId?: string;
}

export interface DealStagePreset {
  id: string;
  label: string;
  description: string;
  values: StoryTemplateValues;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const FUNNEL_STAGE_OPTIONS = (
  Object.entries(FUNNEL_STAGE_LABELS) as [FunnelStage, string][]
).map(([value, label]) => ({ value, label }));

export const STORY_TYPE_TOPIC_OPTIONS = Object.entries(TOPIC_LABELS) as [
  TaxonomyTopic,
  string,
][];

export const STORY_LENGTH_OPTIONS = Object.entries(
  STORY_LENGTH_LABELS
) as [StoryLength, string][];

export const STORY_OUTLINE_OPTIONS = Object.entries(
  STORY_OUTLINE_LABELS
) as [StoryOutline, string][];

export const BUILT_IN_STORY_TEMPLATES: StoryTemplateOption[] = [
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

export const DEAL_STAGE_PRESETS: DealStagePreset[] = [
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StoryFormStepProps {
  // Quick flow state
  dealStagePresetId: string;
  audienceMode: StoryAudienceMode;
  visibilityMode: StoryVisibilityMode;
  namedPermissionConfirmed: boolean;
  namedModeBlocked: boolean;

  // Onboarding state
  showOnboarding: boolean;
  onboardingElapsedSeconds: number;
  onboardingWithinTarget: boolean;
  firstStoryGenerated: boolean;
  firstStoryShared: boolean;

  // Template state
  allTemplates: StoryTemplateOption[];
  activeTemplateId: string | null;
  savingTemplate: boolean;

  // Advanced form state
  isAdvanced: boolean;
  selectedStages: FunnelStage[];
  selectedTopics: TaxonomyTopic[];
  topicOptions: Array<{ value: string; label: string; group: string }>;
  customTitle: string;
  selectedFormat: StoryFormat | "";
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  storyTypeMode: StoryTypeMode;
  storyTypeSearch: string;
  filteredStoryTypeOptions: [TaxonomyTopic, string][];

  // Org defaults
  isLengthDefault: boolean;
  isOutlineDefault: boolean;
  isTypeDefault: boolean;
  isFormatDefault: boolean;

  // Callbacks
  onClose: () => void;
  runGeneration: () => void;
  handleApplyDealStagePreset: (presetId: string) => void;
  handleApplyTemplate: (templateId: string) => void;
  handleSaveCurrentTemplate: () => void;
  handleDismissOnboarding: () => void;
  handleVisibilityModeChange: (mode: StoryVisibilityMode) => void;
  handleStagesChange: (stages: string[]) => void;

  // Setters
  setAudienceMode: Dispatch<SetStateAction<StoryAudienceMode>>;
  setNamedPermissionConfirmed: Dispatch<SetStateAction<boolean>>;
  setIsAdvanced: Dispatch<SetStateAction<boolean>>;
  setCustomTitle: Dispatch<SetStateAction<string>>;
  setSelectedFormat: Dispatch<SetStateAction<StoryFormat | "">>;
  setStoryLength: Dispatch<SetStateAction<StoryLength>>;
  setStoryOutline: Dispatch<SetStateAction<StoryOutline>>;
  setStoryType: Dispatch<SetStateAction<StoryTypeInput>>;
  setStoryTypeMode: Dispatch<SetStateAction<StoryTypeMode>>;
  setStoryTypeSearch: Dispatch<SetStateAction<string>>;
  setSelectedTopics: Dispatch<SetStateAction<TaxonomyTopic[]>>;

  // Template delete
  handleDeleteSavedTemplate: (assetId: string) => void;

  // Telemetry
  trackSellerEvent: (
    eventType: string,
    metadata?: {
      step?: string;
      story_id?: string;
      action_name?: string;
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    }
  ) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StoryFormStep(props: StoryFormStepProps) {
  const {
    dealStagePresetId,
    audienceMode,
    visibilityMode,
    namedPermissionConfirmed,
    namedModeBlocked,
    showOnboarding,
    onboardingElapsedSeconds,
    onboardingWithinTarget,
    firstStoryGenerated,
    firstStoryShared,
    allTemplates,
    activeTemplateId,
    savingTemplate,
    isAdvanced,
    selectedStages,
    selectedTopics,
    topicOptions,
    customTitle,
    selectedFormat,
    storyLength,
    storyOutline,
    storyType,
    storyTypeMode,
    storyTypeSearch,
    filteredStoryTypeOptions,
    isLengthDefault,
    isOutlineDefault,
    isTypeDefault,
    isFormatDefault,
    onClose,
    runGeneration,
    handleApplyDealStagePreset,
    handleApplyTemplate,
    handleSaveCurrentTemplate,
    handleDismissOnboarding,
    handleVisibilityModeChange,
    handleStagesChange,
    setAudienceMode,
    setNamedPermissionConfirmed,
    setIsAdvanced,
    setCustomTitle,
    setSelectedFormat,
    setStoryLength,
    setStoryOutline,
    setStoryType,
    setStoryTypeMode,
    setStoryTypeSearch,
    setSelectedTopics,
    handleDeleteSavedTemplate,
    trackSellerEvent,
  } = props;

  return (
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
                    onClick={() => handleDeleteSavedTemplate(assetId)}
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
  );
}
