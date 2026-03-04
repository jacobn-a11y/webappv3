/**
 * StoryGeneratorModal -- thin modal shell with step routing and state machine.
 *
 * Delegates all domain logic to extracted hooks and step components:
 *   - useStoryGeneration  -> phase, loading, streaming, result
 *   - useStoryFormState   -> form fields, templates, onboarding, telemetry
 *   - StoryFormStep       -> form UI
 *   - StoryPreviewStep    -> preview UI (uses StoryPublishStep internally)
 *   - StoryLoadingSection -> loading UI
 *   - StoryErrorSection   -> error UI
 */

import { useCallback, useEffect, useRef } from "react";
import {
  StoryErrorSection,
  StoryLoadingSection,
} from "./story-generator/StoryModalSections";
import { StoryPreviewStep } from "./story-generator/StoryPreviewStep";
import { StoryFormStep } from "./story-generator/StoryFormStep";
import { useStoryGeneration } from "./story-generator/useStoryGeneration";
import { useStoryFormState } from "./story-generator/useStoryFormState";
import {
  trackSellerAdoptionEvent,
  type SellerAdoptionEventType,
} from "../lib/api";

// Re-export sub-modules used by StoryPreviewStep so downstream consumers
// that previously imported publish-related symbols from the modal barrel can
// still reach them.
export { useStoryPublishFlow } from "./story-generator/StoryPublishStep";
export type { PackagingTemplate } from "./story-generator/StoryPublishStep";
export { usePublishFlow } from "./story-generator/usePublishFlow";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoryGeneratorModalProps {
  accountId: string;
  accountName: string;
  onClose: () => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  // ── Modal chrome refs ─────────────────────────────────────────────────

  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── Story generation hook ─────────────────────────────────────────────

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

  // ── Telemetry (ref-based to stay stable across renders) ───────────────

  const telemetryContextRef = useRef({
    stageLabel: "Evaluation",
    visibilityMode: "ANONYMOUS" as "ANONYMOUS" | "NAMED",
  });

  const trackSellerEvent = useCallback(
    (
      eventType: string,
      metadata?: {
        step?: string;
        story_id?: string;
        action_name?: string;
        duration_ms?: number;
        metadata?: Record<string, unknown>;
      },
    ) => {
      void trackSellerAdoptionEvent({
        event_type: eventType as SellerAdoptionEventType,
        flow_id: flowIdRef.current,
        account_id: accountId,
        story_id: metadata?.story_id,
        stage_preset: telemetryContextRef.current.stageLabel,
        visibility_mode: telemetryContextRef.current.visibilityMode,
        step: metadata?.step,
        action_name: metadata?.action_name,
        duration_ms: metadata?.duration_ms,
        metadata: metadata?.metadata,
      }).catch(() => {
        // Telemetry should never block story generation UX.
      });
    },
    [accountId],
  );

  // ── Form state hook (owns all form, onboarding, and telemetry logic) ──

  const form = useStoryFormState({
    accountId,
    accountName,
    error,
    flowOpenedAt: flowOpenedAtRef.current,
    onError: setError,
    onPhaseError: () => setPhase("error"),
    phase,
    result,
    runStoryGeneration,
    trackSellerEvent,
  });

  // Keep telemetry context in sync with form-derived values.
  telemetryContextRef.current.stageLabel = form.stageLabel;
  telemetryContextRef.current.visibilityMode = form.visibilityMode;

  const loadingStep =
    loadingProgress < 34 ? 0 : loadingProgress < 67 ? 1 : 2;

  // ─── Modal chrome effects (escape, focus trap, cleanup) ───────────────

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
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  // ─── Render ───────────────────────────────────────────────────────────

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
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        <div className="modal__body">
          {phase === "form" && (
            <StoryFormStep
              dealStagePresetId={form.dealStagePresetId}
              audienceMode={form.audienceMode}
              visibilityMode={form.visibilityMode}
              namedPermissionConfirmed={form.namedPermissionConfirmed}
              namedModeBlocked={form.namedModeBlocked}
              showOnboarding={form.showOnboarding}
              onboardingElapsedSeconds={form.onboardingElapsedSeconds}
              onboardingWithinTarget={form.onboardingWithinTarget}
              firstStoryGenerated={form.firstStoryGenerated}
              firstStoryShared={form.firstStoryShared}
              allTemplates={form.allTemplates}
              activeTemplateId={form.activeTemplateId}
              savingTemplate={form.savingTemplate}
              isAdvanced={form.isAdvanced}
              selectedStages={form.selectedStages}
              selectedTopics={form.selectedTopics}
              topicOptions={form.topicOptions}
              customTitle={form.customTitle}
              selectedFormat={form.selectedFormat}
              storyLength={form.storyLength}
              storyOutline={form.storyOutline}
              storyType={form.storyType}
              storyTypeMode={form.storyTypeMode}
              storyTypeSearch={form.storyTypeSearch}
              filteredStoryTypeOptions={form.filteredStoryTypeOptions}
              isLengthDefault={form.isLengthDefault}
              isOutlineDefault={form.isOutlineDefault}
              isTypeDefault={form.isTypeDefault}
              isFormatDefault={form.isFormatDefault}
              onClose={onClose}
              runGeneration={form.runGeneration}
              handleApplyDealStagePreset={form.handleApplyDealStagePreset}
              handleApplyTemplate={form.handleApplyTemplate}
              handleSaveCurrentTemplate={() => void form.handleSaveCurrentTemplate()}
              handleDismissOnboarding={form.handleDismissOnboarding}
              handleVisibilityModeChange={form.handleVisibilityModeChange}
              handleStagesChange={form.handleStagesChange}
              setAudienceMode={form.setAudienceMode}
              setNamedPermissionConfirmed={form.setNamedPermissionConfirmed}
              setIsAdvanced={form.setIsAdvanced}
              setCustomTitle={form.setCustomTitle}
              setSelectedFormat={form.setSelectedFormat}
              setStoryLength={form.setStoryLength}
              setStoryOutline={form.setStoryOutline}
              setStoryType={form.setStoryType}
              setStoryTypeMode={form.setStoryTypeMode}
              setStoryTypeSearch={form.setStoryTypeSearch}
              setSelectedTopics={form.setSelectedTopics}
              handleDeleteSavedTemplate={(assetId) =>
                void form.handleDeleteSavedTemplate(assetId)
              }
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
              namedPermissionConfirmed={form.namedPermissionConfirmed}
              onClose={onClose}
              onLandingPageCreated={onLandingPageCreated}
              onShareAction={form.handleShareAction}
              previewMarkdown={previewMarkdown}
              result={result}
              setEditMode={setEditMode}
              setError={setError}
              setPhase={setPhase}
              setPreviewMarkdown={setPreviewMarkdown}
              stageLabel={form.stageLabel}
              trackSellerEvent={trackSellerEvent}
              triggerGeneration={form.triggerGeneration}
              visibilityMode={form.visibilityMode}
            />
          )}

          {phase === "error" && (
            <StoryErrorSection
              error={error}
              handleBackToForm={handleBackToForm}
              runGeneration={form.runGeneration}
            />
          )}
        </div>
      </div>
    </div>
  );
}
