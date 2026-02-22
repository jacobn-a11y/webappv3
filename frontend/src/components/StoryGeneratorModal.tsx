import { useState, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MultiSelect } from "./MultiSelect";
import { FormatSelector } from "./FormatSelector";
import {
  type FunnelStage,
  type TaxonomyTopic,
  type StoryFormat,
  type StoryLength,
  type StoryOutline,
  type StoryTypeInput,
  FUNNEL_STAGE_LABELS,
  STAGE_TOPICS,
  TOPIC_LABELS,
  STORY_LENGTH_LABELS,
  STORY_OUTLINE_LABELS,
  STORY_TYPE_INPUT_LABELS,
} from "../types/taxonomy";
import {
  buildStory,
  createLandingPage,
  getStoryContextSettings,
  type BuildStoryResponse,
} from "../lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalPhase = "form" | "loading" | "preview" | "error";

interface StoryGeneratorModalProps {
  accountId: string;
  accountName: string;
  onClose: () => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
}

// ─── Build options for MultiSelect ──────────────────────────────────────────

const FUNNEL_STAGE_OPTIONS = (
  Object.entries(FUNNEL_STAGE_LABELS) as [FunnelStage, string][]
).map(([value, label]) => ({ value, label }));

function buildTopicOptions(selectedStages: FunnelStage[]) {
  const stages =
    selectedStages.length > 0
      ? selectedStages
      : (Object.keys(STAGE_TOPICS) as FunnelStage[]);

  return stages.flatMap((stage) =>
    STAGE_TOPICS[stage].map((topic) => ({
      value: topic,
      label: TOPIC_LABELS[topic],
      group: FUNNEL_STAGE_LABELS[stage],
    }))
  );
}

const STORY_TYPE_OPTIONS = Object.entries(
  STORY_TYPE_INPUT_LABELS
) as [StoryTypeInput, string][];
const STORY_LENGTH_OPTIONS = Object.entries(
  STORY_LENGTH_LABELS
) as [StoryLength, string][];
const STORY_OUTLINE_OPTIONS = Object.entries(
  STORY_OUTLINE_LABELS
) as [StoryOutline, string][];

// ─── Component ──────────────────────────────────────────────────────────────

export function StoryGeneratorModal({
  accountId,
  accountName,
  onClose,
  onLandingPageCreated,
}: StoryGeneratorModalProps) {
  // Form state
  const [selectedStages, setSelectedStages] = useState<FunnelStage[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<TaxonomyTopic[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<StoryFormat | "">("");
  const [storyLength, setStoryLength] = useState<StoryLength>("MEDIUM");
  const [storyOutline, setStoryOutline] = useState<StoryOutline>("CHRONOLOGICAL_JOURNEY");
  const [storyType, setStoryType] = useState<StoryTypeInput>("FULL_ACCOUNT_JOURNEY");

  // Focus trap refs
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Flow state
  const [phase, setPhase] = useState<ModalPhase>("form");
  const [result, setResult] = useState<BuildStoryResponse | null>(null);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);

  const topicOptions = buildTopicOptions(selectedStages);

  // Capture previous focus and manage focus trap
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Focus the modal on open
    const timer = requestAnimationFrame(() => {
      modalRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(timer);
      // Restore focus to the element that opened the modal
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    getStoryContextSettings()
      .then((settings) => {
        setStoryLength(settings.default_story_length ?? "MEDIUM");
        setStoryOutline(
          settings.default_story_outline ?? "CHRONOLOGICAL_JOURNEY"
        );
        setStoryType(settings.default_story_type ?? "FULL_ACCOUNT_JOURNEY");
        setSelectedFormat(settings.default_story_format ?? "");
      })
      .catch(() => {
        // Use local defaults if org settings are unavailable.
      });
  }, []);

  // When stages change, remove any selected topics that no longer belong
  const handleStagesChange = (stages: string[]) => {
    const newStages = stages as FunnelStage[];
    setSelectedStages(newStages);

    if (newStages.length > 0) {
      const validTopics = new Set(newStages.flatMap((s) => STAGE_TOPICS[s]));
      setSelectedTopics((prev) =>
        prev.filter((t) => validTopics.has(t))
      );
    }
  };

  const handleSubmit = useCallback(async () => {
    setPhase("loading");
    setError("");

    try {
      const res = await buildStory({
        account_id: accountId,
        funnel_stages: selectedStages.length > 0 ? selectedStages : undefined,
        filter_topics: selectedTopics.length > 0 ? selectedTopics : undefined,
        title: customTitle.trim() || undefined,
        format: selectedFormat || undefined,
        story_length: storyLength,
        story_outline: storyOutline,
        story_type: storyType,
      });
      setResult(res);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate story");
      setPhase("error");
    }
  }, [
    accountId,
    selectedStages,
    selectedTopics,
    customTitle,
    selectedFormat,
    storyLength,
    storyOutline,
    storyType,
  ]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = result.markdown;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }, [result]);

  const handleCreateLandingPage = useCallback(async () => {
    if (!result) return;
    setCreatingPage(true);
    try {
      // We need the story ID — for now we use the latest story for this account.
      // The buildStory response doesn't include an ID directly, so we create
      // the landing page by re-fetching stories and using the most recent one.
      const storiesRes = await fetch(`/api/stories/${accountId}`);
      const storiesData = await storiesRes.json();
      const latestStory = storiesData.stories?.[0];

      if (!latestStory) {
        throw new Error("Could not find the generated story");
      }

      const page = await createLandingPage({
        story_id: latestStory.id,
        title: result.title,
      });

      onLandingPageCreated?.(page.id, page.slug);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create landing page"
      );
    } finally {
      setCreatingPage(false);
    }
  }, [result, accountId, onLandingPageCreated]);

  const handleBackToForm = () => {
    setPhase("form");
    setError("");
  };

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
        {/* Header */}
        <div className="modal__header">
          <div>
            <h2 className="modal__title">
              {phase === "preview" ? "Story Preview" : "Generate Story"}
            </h2>
            <p className="modal__subtitle">{accountName}</p>
          </div>
          <button
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal__body">
          {/* ── FORM PHASE ──────────────────────────────────────────── */}
          {phase === "form" && (
            <div className="story-form">
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
                <label className="form-field__label">
                  Custom Title
                  <span className="form-field__hint">Optional</span>
                </label>
                <input
                  type="text"
                  className="form-field__input"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Auto-generated if left blank"
                />
              </div>

              <FormatSelector
                value={selectedFormat}
                onChange={setSelectedFormat}
              />

              <div className="form-field">
                <label className="form-field__label">Story Length</label>
                <select
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
                <label className="form-field__label">Story Outline</label>
                <select
                  className="form-field__input"
                  value={storyOutline}
                  onChange={(e) => setStoryOutline(e.target.value as StoryOutline)}
                >
                  {STORY_OUTLINE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-field__label">Story Type</label>
                <select
                  className="form-field__input"
                  value={storyType}
                  onChange={(e) => setStoryType(e.target.value as StoryTypeInput)}
                >
                  {STORY_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="story-form__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleSubmit}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M8 2v12M2 8h12" />
                  </svg>
                  Generate Story
                </button>
              </div>
            </div>
          )}

          {/* ── LOADING PHASE ──────────────────────────────────────── */}
          {phase === "loading" && (
            <div className="loading-state" role="status" aria-live="polite">
              <div className="loading-state__spinner" aria-hidden="true" />
              <h3 className="loading-state__title">Generating your story...</h3>
              <p className="loading-state__text">
                Analyzing transcripts, extracting insights, and composing a
                structured narrative. This typically takes 15-30 seconds.
              </p>
              <div className="loading-state__steps">
                <div className="loading-state__step loading-state__step--active">
                  <span className="loading-state__step-dot" />
                  Gathering transcript segments
                </div>
                <div className="loading-state__step">
                  <span className="loading-state__step-dot" />
                  Building journey narrative
                </div>
                <div className="loading-state__step">
                  <span className="loading-state__step-dot" />
                  Extracting high-value quotes
                </div>
              </div>
            </div>
          )}

          {/* ── PREVIEW PHASE ──────────────────────────────────────── */}
          {phase === "preview" && result && (
            <div className="story-preview">
              <div className="story-preview__toolbar">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleBackToForm}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M10 12L6 8l4-4" />
                  </svg>
                  Back
                </button>
                <div className="story-preview__toolbar-actions">
                  <button
                    type="button"
                    className={`btn btn--secondary ${copyFeedback ? "btn--success" : ""}`}
                    onClick={handleCopyMarkdown}
                  >
                    {copyFeedback ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="5" y="5" width="8" height="8" rx="1" />
                          <path d="M3 11V3h8" />
                        </svg>
                        Copy Markdown
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleCreateLandingPage}
                    disabled={creatingPage}
                  >
                    {creatingPage ? (
                      <>
                        <span className="btn__spinner" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="2" y="2" width="12" height="12" rx="2" />
                          <path d="M5 6h6M5 8h6M5 10h4" />
                        </svg>
                        Create Landing Page
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quotes sidebar + Markdown preview */}
              <div className="story-preview__layout">
                <div className="story-preview__content">
                  <article className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {result.markdown}
                    </ReactMarkdown>
                  </article>
                </div>

                {result.quotes.length > 0 && (
                  <aside className="story-preview__sidebar">
                    <h3 className="story-preview__sidebar-title">
                      High-Value Quotes
                    </h3>
                    {result.quotes.map((q, i) => (
                      <div key={i} className="quote-card">
                        <blockquote className="quote-card__text">
                          "{q.quote_text}"
                        </blockquote>
                        {q.speaker && (
                          <p className="quote-card__speaker">
                            &mdash; {q.speaker}
                          </p>
                        )}
                        {q.metric_value && (
                          <div className="quote-card__metric">
                            <span className="quote-card__metric-value">
                              {q.metric_value}
                            </span>
                            {q.metric_type && (
                              <span className="quote-card__metric-type">
                                {q.metric_type.replace(/_/g, " ")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </aside>
                )}
              </div>
            </div>
          )}

          {/* ── ERROR PHASE ────────────────────────────────────────── */}
          {phase === "error" && (
            <div className="error-state" role="alert">
              <div className="error-state__icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#dc2626" strokeWidth="2" aria-hidden="true">
                  <circle cx="24" cy="24" r="20" />
                  <path d="M24 16v10M24 30v2" />
                </svg>
              </div>
              <h3 className="error-state__title">Generation Failed</h3>
              <p className="error-state__message">{error}</p>
              <div className="error-state__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleBackToForm}
                >
                  Back to Form
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleSubmit}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
