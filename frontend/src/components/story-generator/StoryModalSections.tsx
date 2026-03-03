import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Dispatch, SetStateAction } from "react";
import type { BuildStoryResponse, StoryQuote } from "../../lib/api";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function buildTranscriptSourcePath(quote: StoryQuote): string | null {
  if (quote.transcript_deep_link) {
    return quote.transcript_deep_link;
  }
  if (!quote.call_id) {
    return null;
  }
  const params = new URLSearchParams();
  if (
    typeof quote.source_timestamp_ms === "number" &&
    Number.isFinite(quote.source_timestamp_ms) &&
    quote.source_timestamp_ms >= 0
  ) {
    params.set("tms", String(Math.floor(quote.source_timestamp_ms)));
  }
  if (quote.source_chunk_id) {
    params.set("chunk", quote.source_chunk_id);
  }
  const query = params.toString();
  return query.length > 0
    ? `/calls/${quote.call_id}/transcript?${query}`
    : `/calls/${quote.call_id}/transcript`;
}

export function StoryLoadingSection(props: {
  handleCancelGeneration: () => void;
  loadingMessage: string;
  loadingProgress: number;
  loadingStep: number;
  streamedMarkdown: string;
}) {
  const {
    handleCancelGeneration,
    loadingMessage,
    loadingProgress,
    loadingStep,
    streamedMarkdown,
  } = props;

  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div
        className="loading-state__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loadingProgress}
        aria-label="Story generation progress"
      >
        <div
          className="loading-state__progress-fill"
          style={{ width: `${loadingProgress}%` }}
        />
      </div>
      <div className="loading-state__spinner" aria-hidden="true" />
      <h3 className="loading-state__title">Generating your story...</h3>
      <p className="loading-state__text">
        Analyzing transcripts, extracting insights, and composing a structured
        narrative.
      </p>
      <p className="loading-state__hint">{loadingMessage}</p>
      <div className="loading-state__steps">
        <div
          className={`loading-state__step ${
            loadingStep > 0
              ? "loading-state__step--complete"
              : loadingStep === 0
                ? "loading-state__step--active"
                : ""
          }`}
        >
          <span className="loading-state__step-dot" />
          Gathering transcript segments
        </div>
        <div
          className={`loading-state__step ${
            loadingStep > 1
              ? "loading-state__step--complete"
              : loadingStep === 1
                ? "loading-state__step--active"
                : ""
          }`}
        >
          <span className="loading-state__step-dot" />
          Building journey narrative
        </div>
        <div
          className={`loading-state__step ${
            loadingStep === 2 ? "loading-state__step--active" : ""
          }`}
        >
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
      {streamedMarkdown.trim().length > 0 && (
        <div className="loading-state__live">
          <div className="loading-state__live-title">Live draft preview</div>
          <article className="markdown-body loading-state__live-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {`${streamedMarkdown}▍`}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}

export function StoryPreviewSection(props: {
  activeMarkdown: string;
  copyFeedback: boolean;
  creatingPage: boolean;
  editMode: boolean;
  exportingFormat: "pdf" | "docx" | null;
  handleBackToForm: () => void;
  handleCopyToClipboard: () => void;
  handleCopyPackagingTemplate: (
    templateId: "executive_recap" | "champion_forward" | "roi_proof"
  ) => void;
  handleCreateLandingPage: () => void;
  handleDownloadExport: (format: "pdf" | "docx") => Promise<void>;
  handleDownloadMarkdown: () => void;
  handleRegenerateVariant: (
    variant: "same" | "shorter" | "executive" | "proof"
  ) => void;
  packagingTemplates: Array<{
    id: "executive_recap" | "champion_forward" | "roi_proof";
    label: string;
    description: string;
    body: string;
  }>;
  result: BuildStoryResponse;
  runGeneration: () => void;
  safeToShare: {
    status: "pending" | "ready" | "warning";
    label: string;
    reason: string;
    avgConfidence: number;
  };
  setEditMode: Dispatch<SetStateAction<boolean>>;
  setPreviewMarkdown: Dispatch<SetStateAction<string>>;
  storyStats: { wordCount: number; readingMinutes: number } | null;
}) {
  const {
    activeMarkdown,
    copyFeedback,
    creatingPage,
    editMode,
    exportingFormat,
    handleBackToForm,
    handleCopyToClipboard,
    handleCopyPackagingTemplate,
    handleCreateLandingPage,
    handleDownloadExport,
    handleDownloadMarkdown,
    handleRegenerateVariant,
    packagingTemplates,
    result,
    runGeneration,
    safeToShare,
    setEditMode,
    setPreviewMarkdown,
    storyStats,
  } = props;

  return (
    <div className="story-preview">
      <div className="story-preview__toolbar">
        <button type="button" className="btn btn--ghost" onClick={handleBackToForm}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M10 12L6 8l4-4" />
          </svg>
          Back
        </button>
        {storyStats && (
          <div className="story-preview__stats" aria-label="Story length details">
            {storyStats.wordCount.toLocaleString()} words · {storyStats.readingMinutes} min read
          </div>
        )}
        <div
          className={`story-preview__safe-indicator story-preview__safe-indicator--${safeToShare.status}`}
          role="status"
          aria-live="polite"
        >
          <strong>{safeToShare.label}</strong>
          <span>{safeToShare.reason}</span>
        </div>
        <div className="story-preview__toolbar-actions">
          <button type="button" className="btn btn--ghost" onClick={runGeneration}>
            Regenerate
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => handleRegenerateVariant("shorter")}
          >
            Shorter
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => handleRegenerateVariant("executive")}
          >
            More Executive
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => handleRegenerateVariant("proof")}
          >
            More Proof
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setEditMode((prev) => !prev)}
          >
            {editMode ? "Preview Mode" : "Edit Inline"}
          </button>
          {editMode && activeMarkdown !== result.markdown && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setPreviewMarkdown(result.markdown)}
            >
              Reset Edits
            </button>
          )}
          <button
            type="button"
            className={`btn btn--secondary ${copyFeedback ? "btn--success" : ""}`}
            onClick={handleCopyToClipboard}
          >
            {copyFeedback ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button type="button" className="btn btn--secondary" onClick={handleDownloadMarkdown}>
            Download .md
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void handleDownloadExport("pdf")}
            disabled={!result.story_id || exportingFormat !== null}
          >
            {exportingFormat === "pdf" ? "Exporting..." : "PDF"}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void handleDownloadExport("docx")}
            disabled={!result.story_id || exportingFormat !== null}
          >
            {exportingFormat === "docx" ? "Exporting..." : "DOCX"}
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

      {packagingTemplates.length > 0 && (
        <section className="story-preview__packages">
          {packagingTemplates.map((template) => (
            <article key={template.id} className="story-preview__package-card">
              <h4>{template.label}</h4>
              <p>{template.description}</p>
              <pre>{template.body}</pre>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => handleCopyPackagingTemplate(template.id)}
              >
                Copy {template.label}
              </button>
            </article>
          ))}
        </section>
      )}

      <div className="story-preview__layout">
        <div className="story-preview__content">
          {editMode ? (
            <div className="story-preview__editor">
              <label className="form-field__label" htmlFor="story-inline-editor">
                Edit Story
              </label>
              <textarea
                id="story-inline-editor"
                className="story-preview__editor-input"
                value={activeMarkdown}
                onChange={(e) => setPreviewMarkdown(e.target.value)}
              />
            </div>
          ) : (
            <article className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeMarkdown}</ReactMarkdown>
            </article>
          )}
        </div>

        {result.quotes.length > 0 && (
          <aside className="story-preview__sidebar">
            <h3 className="story-preview__sidebar-title">High-Value Quotes</h3>
            {result.quotes.map((quote, index) => (
              <div key={index} className="quote-card">
                <blockquote className="quote-card__text">"{quote.quote_text}"</blockquote>
                {quote.speaker && <p className="quote-card__speaker">- {quote.speaker}</p>}
                {quote.metric_value && (
                  <div className="quote-card__metric">
                    <span className="quote-card__metric-value">{quote.metric_value}</span>
                    {quote.metric_type && (
                      <span className="quote-card__metric-type">
                        {quote.metric_type.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                )}
                {typeof quote.confidence_score === "number" && (
                  <div className="quote-card__confidence">
                    Confidence {Math.round(quote.confidence_score * 100)}%
                  </div>
                )}
                {(() => {
                  const transcriptPath = buildTranscriptSourcePath(quote);
                  const sourceTimestampMs = typeof quote.source_timestamp_ms === "number"
                    ? quote.source_timestamp_ms
                    : null;
                  const recordingUrl = quote.source_recording_url;
                  if (!transcriptPath && !recordingUrl) {
                    return null;
                  }
                  return (
                    <div className="quote-card__sources">
                      {transcriptPath && (
                        <Link to={transcriptPath} className="quote-card__source-link">
                          {sourceTimestampMs != null
                            ? `View transcript source (${formatTimestamp(sourceTimestampMs)})`
                            : "View transcript source"}
                        </Link>
                      )}
                      {recordingUrl && (
                        <a
                          href={recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="quote-card__recording-link"
                        >
                          Open recording
                        </a>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

export function StoryErrorSection(props: {
  error: string;
  handleBackToForm: () => void;
  runGeneration: () => void;
}) {
  const { error, handleBackToForm, runGeneration } = props;

  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          stroke="#dc2626"
          strokeWidth="2"
          aria-hidden="true"
        >
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
  );
}
