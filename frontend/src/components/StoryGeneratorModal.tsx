import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
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
} from "../types/taxonomy";
import {
  buildStory,
  createLandingPage,
  getStoryContextSettings,
  type BuildStoryResponse,
  type StoryContextSettings,
} from "../lib/api";

type ModalPhase = "form" | "loading" | "preview" | "error";
type StoryTypeMode = "FULL" | "TOPIC";

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

function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#[\]*_>|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function StoryGeneratorModal({
  accountId,
  accountName,
  onClose,
  onLandingPageCreated,
}: StoryGeneratorModalProps) {
  const persistedRef = useRef<PersistedStorySettings | null>(
    loadPersistedSettings()
  );

  const [selectedStages, setSelectedStages] = useState<FunnelStage[]>(
    persistedRef.current?.selectedStages ?? []
  );
  const [selectedTopics, setSelectedTopics] = useState<TaxonomyTopic[]>(
    persistedRef.current?.selectedTopics ?? []
  );
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

  const [phase, setPhase] = useState<ModalPhase>("form");
  const [result, setResult] = useState<BuildStoryResponse | null>(null);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const [orgDefaults, setOrgDefaults] = useState<StoryContextSettings | null>(
    null
  );

  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const topicOptions = buildTopicOptions(selectedStages);

  const filteredStoryTypeOptions = useMemo(() => {
    const needle = storyTypeSearch.trim().toLowerCase();
    if (!needle) return STORY_TYPE_TOPIC_OPTIONS;
    return STORY_TYPE_TOPIC_OPTIONS.filter(([, label]) =>
      label.toLowerCase().includes(needle)
    );
  }, [storyTypeSearch]);

  const storyStats = useMemo(() => {
    if (!result) return null;
    const wordCount = countWords(result.markdown);
    const readingMinutes = Math.max(1, Math.round(wordCount / 220));
    return { wordCount, readingMinutes };
  }, [result]);

  const loadingStep =
    loadingProgress < 34 ? 0 : loadingProgress < 67 ? 1 : 2;

  const isLengthDefault = orgDefaults?.default_story_length === storyLength;
  const isOutlineDefault = orgDefaults?.default_story_outline === storyOutline;
  const isTypeDefault = orgDefaults?.default_story_type === storyType;
  const isFormatDefault = orgDefaults?.default_story_format === selectedFormat;

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
          requestControllerRef.current?.abort();
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
      requestControllerRef.current?.abort();
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(timer);
      previousFocusRef.current?.focus();
    };
  }, [onClose, phase]);

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
    if (phase !== "loading") {
      return;
    }

    setLoadingProgress(8);
    const id = window.setInterval(() => {
      setLoadingProgress((prev) => Math.min(prev + 4, 94));
    }, 700);

    return () => {
      window.clearInterval(id);
    };
  }, [phase]);

  const handleStagesChange = (stages: string[]) => {
    const newStages = stages as FunnelStage[];
    setSelectedStages(newStages);

    if (newStages.length > 0) {
      const validTopics = new Set(newStages.flatMap((s) => STAGE_TOPICS[s]));
      setSelectedTopics((prev) => prev.filter((t) => validTopics.has(t)));
    }
  };

  const runGeneration = useCallback(async () => {
    setPhase("loading");
    setError("");
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const res = await buildStory(
        {
          account_id: accountId,
          funnel_stages: selectedStages.length > 0 ? selectedStages : undefined,
          filter_topics: selectedTopics.length > 0 ? selectedTopics : undefined,
          title: customTitle.trim() || undefined,
          format: selectedFormat || undefined,
          story_length: storyLength,
          story_outline: storyOutline,
          story_type: storyType,
        },
        { signal: controller.signal }
      );

      setLoadingProgress(100);
      setResult(res);
      setPhase("preview");
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (isAbort) {
        setPhase("form");
        setError("");
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to generate story");
      setPhase("error");
    } finally {
      requestControllerRef.current = null;
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

  const handleCancelGeneration = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setPhase("form");
    setLoadingProgress(8);
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
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

  const handleDownloadMarkdown = useCallback(() => {
    if (!result) return;
    const title = sanitizeFileName(result.title || `${accountName}-story`);
    const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title || "story"}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [result, accountName]);

  const handleCreateLandingPage = useCallback(async () => {
    if (!result?.story_id) {
      setError("Could not find generated story id. Please regenerate and try again.");
      setPhase("error");
      return;
    }

    setCreatingPage(true);
    try {
      const page = await createLandingPage({
        story_id: result.story_id,
        title: result.title,
      });

      onLandingPageCreated?.(page.id, page.slug);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create landing page"
      );
      setPhase("error");
    } finally {
      setCreatingPage(false);
    }
  }, [result, onLandingPageCreated]);

  const handleBackToForm = () => {
    setPhase("form");
    setError("");
  };

  useEffect(() => {
    if (storyTypeMode === "FULL") {
      setStoryType("FULL_ACCOUNT_JOURNEY");
      return;
    }
    if (storyType === "FULL_ACCOUNT_JOURNEY") {
      setStoryType(STORY_TYPE_TOPIC_OPTIONS[0]?.[0] ?? "industry_trend_validation");
    }
  }, [storyTypeMode, storyType]);

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
                <div className="story-form__quick-actions">
                  <button type="button" className="btn btn--primary" onClick={runGeneration}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M8 2v12M2 8h12" />
                    </svg>
                    Generate Story
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setIsAdvanced((prev) => !prev)}
                    aria-expanded={isAdvanced}
                  >
                    {isAdvanced ? "Hide Customization" : "Customize Settings"}
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
                    <button type="button" className="btn btn--primary" onClick={runGeneration}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M8 2v12M2 8h12" />
                      </svg>
                      Generate Story
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === "loading" && (
            <div className="loading-state" role="status" aria-live="polite">
              <div
                className="loading-state__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={loadingProgress}
                aria-label="Story generation progress"
              >
                <div className="loading-state__progress-fill" style={{ width: `${loadingProgress}%` }} />
              </div>
              <div className="loading-state__spinner" aria-hidden="true" />
              <h3 className="loading-state__title">Generating your story...</h3>
              <p className="loading-state__text">
                Analyzing transcripts, extracting insights, and composing a structured narrative.
              </p>
              <div className="loading-state__steps">
                <div className={`loading-state__step ${loadingStep > 0 ? "loading-state__step--complete" : loadingStep === 0 ? "loading-state__step--active" : ""}`}>
                  <span className="loading-state__step-dot" />
                  Gathering transcript segments
                </div>
                <div className={`loading-state__step ${loadingStep > 1 ? "loading-state__step--complete" : loadingStep === 1 ? "loading-state__step--active" : ""}`}>
                  <span className="loading-state__step-dot" />
                  Building journey narrative
                </div>
                <div className={`loading-state__step ${loadingStep === 2 ? "loading-state__step--active" : ""}`}>
                  <span className="loading-state__step-dot" />
                  Extracting high-value quotes
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost loading-state__cancel"
                onClick={handleCancelGeneration}
              >
                Cancel generation
              </button>
            </div>
          )}

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
                {storyStats && (
                  <div className="story-preview__stats" aria-label="Story length details">
                    {storyStats.wordCount.toLocaleString()} words · {storyStats.readingMinutes} min read
                  </div>
                )}
                <div className="story-preview__toolbar-actions">
                  <button type="button" className="btn btn--ghost" onClick={runGeneration}>
                    Regenerate
                  </button>
                  <button
                    type="button"
                    className={`btn btn--secondary ${copyFeedback ? "btn--success" : ""}`}
                    onClick={handleCopyToClipboard}
                  >
                    {copyFeedback ? "Copied!" : "Copy to Clipboard"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={handleDownloadMarkdown}
                  >
                    Download .md
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
                        Opening editor...
                      </>
                    ) : (
                      "Edit as Landing Page"
                    )}
                  </button>
                </div>
              </div>

              <div className="sr-only" role="status" aria-live="polite">
                {copyFeedback ? "Story copied to clipboard." : ""}
              </div>

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
                          <p className="quote-card__speaker">- {q.speaker}</p>
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
                        {q.call_id && (
                          <Link to={`/calls/${q.call_id}/transcript`} className="quote-card__source-link">
                            View transcript source
                          </Link>
                        )}
                      </div>
                    ))}
                  </aside>
                )}
              </div>
            </div>
          )}

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
                <button type="button" className="btn btn--secondary" onClick={handleBackToForm}>
                  Back to Form
                </button>
                <button type="button" className="btn btn--primary" onClick={runGeneration}>
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
