/**
 * StoryLibraryPage — Layout shell, view toggle, filter state.
 * Sub-components decomposed into ./story-library/
 */

import { ConfirmDialog } from "../components/ConfirmDialog";
import { StoryFilters } from "./story-library/StoryFilters";
import { StoryCard } from "./story-library/StoryCard";
import { StoryTable } from "./story-library/StoryTable";
import { useStoryLibrary } from "./story-library/useStoryLibrary";

// Re-export sub-components for backward compatibility
export { StoryFilters } from "./story-library/StoryFilters";
export { StoryCard } from "./story-library/StoryCard";
export { StoryTable } from "./story-library/StoryTable";
export { useStoryLibrary } from "./story-library/useStoryLibrary";

export function StoryLibraryPage({ userRole }: { userRole: string }) {
  const lib = useStoryLibrary(userRole);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Story Library</h1>
          <p className="page__subtitle">
            Browse stories across all accessible accounts.
          </p>
        </div>
      </header>

      <StoryFilters
        searchDraft={lib.searchDraft}
        setSearchDraft={lib.setSearchDraft}
        storyType={lib.storyType}
        setStoryType={lib.setStoryType}
        status={lib.status}
        setStatus={lib.setStatus}
        pageSize={lib.pageSize}
        setPageSize={lib.setPageSize}
        viewMode={lib.viewMode}
        setViewMode={lib.setViewMode}
        setPage={lib.setPage}
        uniqueStoryTypes={lib.uniqueStoryTypes}
      />

      <div className="story-library__count" aria-live="polite">
        {lib.loading
          ? "Loading..."
          : `${lib.rangeStart}-${lib.rangeEnd} of ${lib.totalCount} stor${lib.totalCount === 1 ? "y" : "ies"}`}
      </div>

      {!lib.loading && lib.stories.length > 0 && lib.viewMode === "table" && (
        <div className="story-library__bulk">
          <label className="story-library__bulk-select">
            <input
              type="checkbox"
              checked={lib.allSelectedOnPage}
              onChange={lib.toggleSelectAllOnPage}
              aria-label="Select all stories on this page"
            />
            Select all on page
          </label>
          <span className="story-library__bulk-count">
            {lib.selectedStoryIds.length} selected
          </span>
          <div className="story-library__bulk-actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void lib.handleBulkCopy()} disabled={lib.selectedStoryIds.length === 0 || lib.bulkBusy}>
              Copy Selected
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void lib.handleBulkExport("pdf")} disabled={lib.selectedStoryIds.length === 0 || lib.bulkBusy}>
              Export PDFs
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => void lib.handleBulkExport("docx")} disabled={lib.selectedStoryIds.length === 0 || lib.bulkBusy}>
              Export DOCX
            </button>
            {!lib.isViewer && (
              <button type="button" className="btn btn--sm btn--danger" onClick={() => void lib.handleBulkDelete()} disabled={lib.selectedStoryIds.length === 0 || lib.bulkBusy}>
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {lib.loading && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading story library...</div>
        </div>
      )}

      {!lib.loading && lib.error && (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Failed to load story library</div>
          <div className="state-view__message">{lib.error}</div>
        </div>
      )}

      {!lib.loading && !lib.error && lib.stories.length === 0 && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="state-view__title">No stories found</div>
          <div className="state-view__message">
            Try broadening your filters, or generate a new story from Accounts.
          </div>
        </div>
      )}

      {!lib.loading && !lib.error && lib.stories.length > 0 && (
        <>
          {lib.viewMode === "cards" ? (
            <div className="story-library__card-grid">
              {lib.stories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  busyStoryId={lib.busyStoryId}
                  bulkBusy={lib.bulkBusy}
                  isViewer={lib.isViewer}
                  onShare={lib.handleShare}
                  onCopy={lib.handleCopyStoryMarkdown}
                  onCreateOrEditPage={lib.handleCreateOrEditPage}
                  onExport={lib.handleExport}
                  onCopyCrmNote={lib.handleCopyCrmNote}
                  onPushCrmNote={lib.handlePushCrmNote}
                  onOpenComments={lib.openCommentThread}
                />
              ))}
            </div>
          ) : (
            <StoryTable
              stories={lib.stories}
              selectedStoryIds={lib.selectedStoryIds}
              busyStoryId={lib.busyStoryId}
              bulkBusy={lib.bulkBusy}
              isViewer={lib.isViewer}
              onToggleSelection={lib.toggleStorySelection}
              onShare={lib.handleShare}
              onCopy={lib.handleCopyStoryMarkdown}
              onCreateOrEditPage={lib.handleCreateOrEditPage}
              onExport={lib.handleExport}
              onCopyCrmNote={lib.handleCopyCrmNote}
              onPushCrmNote={lib.handlePushCrmNote}
              onOpenComments={lib.openCommentThread}
              onDelete={lib.handleDelete}
            />
          )}

          <div className="story-library__pagination">
            <button type="button" className="btn btn--secondary" disabled={lib.page <= 1} onClick={() => lib.setPage((prev) => Math.max(1, prev - 1))}>
              Previous
            </button>
            <span>Page {lib.page} of {Math.max(lib.totalPages, 1)}</span>
            <button type="button" className="btn btn--secondary" disabled={lib.page >= lib.totalPages} onClick={() => lib.setPage((prev) => prev + 1)}>
              Next
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!lib.confirmState}
        title={lib.confirmState?.title ?? ""}
        message={lib.confirmState?.message ?? ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { lib.confirmState?.action(); lib.setConfirmState(null); }}
        onCancel={() => lib.setConfirmState(null)}
      />

      {lib.commentStory && (
        <div className="story-library__comments-overlay" role="dialog" aria-modal="true">
          <div className="story-library__comments-modal">
            <div className="story-library__comments-header">
              <div>
                <h2 className="story-library__comments-title">Feedback Thread</h2>
                <p className="story-library__comments-subtitle">{lib.commentStory.title}</p>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={lib.closeCommentThread}>
                Close
              </button>
            </div>

            <div className="story-library__comments-targets">
              <button type="button" className={`btn btn--sm ${lib.commentTarget === "story" ? "btn--primary" : "btn--secondary"}`} onClick={() => lib.setCommentTarget("story")}>
                Story Thread
              </button>
              {lib.commentStory.landing_page && (
                <button type="button" className={`btn btn--sm ${lib.commentTarget === "page" ? "btn--primary" : "btn--secondary"}`} onClick={() => lib.setCommentTarget("page")}>
                  Page Thread
                </button>
              )}
            </div>

            <div className="story-library__comments-list">
              {lib.commentsLoading && (<div className="story-library__comments-empty">Loading comments...</div>)}
              {!lib.commentsLoading && lib.comments.length === 0 && (<div className="story-library__comments-empty">No comments yet. Start the thread.</div>)}
              {!lib.commentsLoading && lib.comments.map((comment) => (
                <div className="story-library__comment" key={comment.id}>
                  <div className="story-library__comment-meta">
                    <strong>{comment.author?.name || comment.author?.email || "Unknown user"}</strong>
                    <span>{new Date(comment.created_at).toLocaleString()}</span>
                  </div>
                  <div className="story-library__comment-body">{comment.message}</div>
                </div>
              ))}
            </div>

            {lib.commentsError && (<div className="story-library__comments-error" role="alert">{lib.commentsError}</div>)}

            <div className="story-library__comments-compose">
              <textarea className="form-textarea" rows={3} value={lib.commentDraft} onChange={(event) => lib.setCommentDraft(event.target.value)} placeholder="Add feedback for this story/page..." aria-label="Comment message" />
              <div className="story-library__comments-compose-actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={lib.closeCommentThread} disabled={lib.commentSubmitting}>Cancel</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void lib.submitComment()} disabled={lib.commentSubmitting || !lib.commentDraft.trim()}>
                  {lib.commentSubmitting ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
