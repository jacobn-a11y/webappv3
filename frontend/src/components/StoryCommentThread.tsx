/**
 * Comment thread dialog for a story or its landing page.
 *
 * Extracted from StoryLibraryPage to reduce component size
 * and isolate comment state management.
 */
import { useEffect, useState } from "react";
import {
  createStoryComment,
  getStoryComments,
  type StoryComment,
  type StoryLibraryItem,
} from "../lib/api";

interface StoryCommentThreadProps {
  story: StoryLibraryItem;
  onClose: () => void;
  onTrack?: (actionName: string, metadata?: Record<string, unknown>) => void;
}

export function StoryCommentThread({
  story,
  onClose,
  onTrack,
}: StoryCommentThreadProps) {
  const [commentTarget, setCommentTarget] = useState<"story" | "page">(
    story.landing_page ? "page" : "story",
  );
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getStoryComments(story.id, {
      target: commentTarget,
      page_id: commentTarget === "page" ? story.landing_page?.id : undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setComments(res.comments);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load comments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [story.id, story.landing_page?.id, commentTarget]);

  const handleSubmit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createStoryComment(story.id, {
        message: draft.trim(),
        target: commentTarget,
        page_id: commentTarget === "page" ? story.landing_page?.id : undefined,
      });
      setComments((prev) => [...prev, created]);
      setDraft("");
      onTrack?.("post_comment", { target: commentTarget });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="story-library__comments-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comment-thread-title"
    >
      <div className="story-library__comments-modal">
        <div className="story-library__comments-header">
          <div>
            <h2 className="story-library__comments-title" id="comment-thread-title">
              Feedback Thread
            </h2>
            <p className="story-library__comments-subtitle">{story.title}</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="story-library__comments-targets">
          <button
            type="button"
            className={`btn btn--sm ${
              commentTarget === "story" ? "btn--primary" : "btn--secondary"
            }`}
            onClick={() => setCommentTarget("story")}
          >
            Story Thread
          </button>
          {story.landing_page && (
            <button
              type="button"
              className={`btn btn--sm ${
                commentTarget === "page" ? "btn--primary" : "btn--secondary"
              }`}
              onClick={() => setCommentTarget("page")}
            >
              Page Thread
            </button>
          )}
        </div>

        <div className="story-library__comments-list">
          {loading && (
            <div className="story-library__comments-empty">Loading comments...</div>
          )}
          {!loading && comments.length === 0 && (
            <div className="story-library__comments-empty">
              No comments yet. Start the thread.
            </div>
          )}
          {!loading &&
            comments.map((comment) => (
              <div className="story-library__comment" key={comment.id}>
                <div className="story-library__comment-meta">
                  <strong>
                    {comment.author?.name || comment.author?.email || "Unknown user"}
                  </strong>
                  <span>{new Date(comment.created_at).toLocaleString()}</span>
                </div>
                <div className="story-library__comment-body">{comment.message}</div>
              </div>
            ))}
        </div>

        {error && (
          <div className="story-library__comments-error" role="alert">
            {error}
          </div>
        )}

        <div className="story-library__comments-compose">
          <textarea
            className="form-textarea"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add feedback for this story/page..."
            aria-label="Comment message"
          />
          <div className="story-library__comments-compose-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void handleSubmit()}
              disabled={submitting || !draft.trim()}
            >
              {submitting ? "Posting..." : "Post Comment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
