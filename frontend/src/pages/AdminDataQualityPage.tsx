import { useEffect, useState } from "react";
import {
  getDataQualityOverview,
  getStoryLineage,
  getStoryQualityFeedback,
  reviewStoryQualityFeedback,
  submitStoryQualityFeedback,
  type DataQualityOverview,
  type StoryLineageResponse,
  type StoryQualityFeedbackRow,
} from "../lib/api";

export function AdminDataQualityPage() {
  const [overview, setOverview] = useState<DataQualityOverview | null>(null);
  const [feedback, setFeedback] = useState<StoryQualityFeedbackRow[]>([]);
  const [lineage, setLineage] = useState<StoryLineageResponse | null>(null);
  const [storyId, setStoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newFeedback, setNewFeedback] = useState<{
    story_id: string;
    feedback_type: "CORRECTION" | "DISPUTE" | "MISSING_EVIDENCE" | "LINEAGE_FIX";
    target_type: "STORY" | "QUOTE" | "CLAIM";
    notes: string;
    corrected_value: string;
    apply_to_prompt_tuning: boolean;
  }>({
    story_id: "",
    feedback_type: "CORRECTION",
    target_type: "STORY",
    notes: "",
    corrected_value: "",
    apply_to_prompt_tuning: true,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, f] = await Promise.all([
        getDataQualityOverview(),
        getStoryQualityFeedback("OPEN"),
      ]);
      setOverview(o);
      setFeedback(f.feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quality dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadLineage = async () => {
    if (!storyId.trim()) return;
    setError(null);
    try {
      const data = await getStoryLineage(storyId.trim());
      setLineage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lineage");
    }
  };

  const submitFeedback = async () => {
    if (!newFeedback.story_id.trim()) return;
    setError(null);
    try {
      await submitStoryQualityFeedback({
        story_id: newFeedback.story_id.trim(),
        feedback_type: newFeedback.feedback_type,
        target_type: newFeedback.target_type,
        corrected_value: newFeedback.corrected_value || undefined,
        notes: newFeedback.notes || undefined,
        apply_to_prompt_tuning: newFeedback.apply_to_prompt_tuning,
      });
      setNewFeedback((s) => ({ ...s, notes: "", corrected_value: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    }
  };

  const reviewFeedback = async (
    feedbackId: string,
    status: "ACCEPTED" | "REJECTED" | "APPLIED"
  ) => {
    setError(null);
    try {
      await reviewStoryQualityFeedback(feedbackId, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review feedback");
    }
  };

  if (loading) {
    return <div className="admin-security__page">Loading quality dashboard...</div>;
  }

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Data Quality & Trust</h1>
      {error && <div className="admin-story-context__error">{error}</div>}

      {overview && (
        <section className="admin-security__card">
          <div>Stories Total: {overview.stories_total}</div>
          <div>Confidence 30d: {overview.confidence.avg_30d}</div>
          <div>Drift: {overview.confidence.drift_status} ({overview.confidence.drift_delta})</div>
          <div>Lineage Claims 30d: {overview.lineage.claims_30d}</div>
          <div>Lineage Coverage: {overview.lineage.coverage_ratio}</div>
          <div>Sync Failures 30d: {overview.sync_errors.failures_30d}</div>
          <div>Human Feedback Open: {overview.human_feedback.open}</div>
        </section>
      )}

      <section className="admin-security__card">
        <h2>Lookup Story Lineage</h2>
        <div className="admin-security__inline">
          <input
            value={storyId}
            onChange={(e) => setStoryId(e.target.value)}
            placeholder="Story ID"
          />
          <button className="btn btn--secondary" onClick={loadLineage}>
            Load Lineage
          </button>
        </div>
        {lineage && (
          <div>
            <h3>{lineage.story.title}</h3>
            <div>Confidence: {lineage.story.confidence_score}</div>
            <ul>
              {lineage.claims.slice(0, 20).map((claim) => (
                <li key={claim.id}>
                  [{claim.claim_type}] {claim.claim_text.slice(0, 120)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="admin-security__card">
        <h2>Submit Quality Feedback (Human-in-the-loop)</h2>
        <div className="admin-security__inline">
          <input
            value={newFeedback.story_id}
            onChange={(e) => setNewFeedback((s) => ({ ...s, story_id: e.target.value }))}
            placeholder="Story ID"
          />
          <select
            value={newFeedback.feedback_type}
            onChange={(e) =>
              setNewFeedback((s) => ({
                ...s,
                feedback_type: e.target.value as "CORRECTION" | "DISPUTE" | "MISSING_EVIDENCE" | "LINEAGE_FIX",
              }))
            }
          >
            <option value="CORRECTION">CORRECTION</option>
            <option value="DISPUTE">DISPUTE</option>
            <option value="MISSING_EVIDENCE">MISSING_EVIDENCE</option>
            <option value="LINEAGE_FIX">LINEAGE_FIX</option>
          </select>
          <select
            value={newFeedback.target_type}
            onChange={(e) =>
              setNewFeedback((s) => ({ ...s, target_type: e.target.value as "STORY" | "QUOTE" | "CLAIM" }))
            }
          >
            <option value="STORY">STORY</option>
            <option value="QUOTE">QUOTE</option>
            <option value="CLAIM">CLAIM</option>
          </select>
          <input
            value={newFeedback.corrected_value}
            onChange={(e) => setNewFeedback((s) => ({ ...s, corrected_value: e.target.value }))}
            placeholder="Corrected value"
          />
        </div>
        <textarea
          className="admin-story-context__textarea"
          value={newFeedback.notes}
          onChange={(e) => setNewFeedback((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Feedback notes"
        />
        <label className="admin-security__row">
          <input
            type="checkbox"
            checked={newFeedback.apply_to_prompt_tuning}
            onChange={(e) =>
              setNewFeedback((s) => ({ ...s, apply_to_prompt_tuning: e.target.checked }))
            }
          />
          Apply to prompt/model tuning queue
        </label>
        <button className="btn btn--primary" onClick={submitFeedback}>
          Submit Feedback
        </button>
      </section>

      <section className="admin-security__card">
        <h2>Feedback Queue</h2>
        <table className="admin-ops__table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Story</th>
              <th>Type</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {feedback.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.status}</td>
                <td>{row.story.title}</td>
                <td>{row.feedback_type}</td>
                <td>{row.notes || "-"}</td>
                <td>
                  <button className="btn btn--secondary" onClick={() => reviewFeedback(row.id, "ACCEPTED")}>
                    Accept
                  </button>{" "}
                  <button className="btn btn--secondary" onClick={() => reviewFeedback(row.id, "REJECTED")}>
                    Reject
                  </button>{" "}
                  <button className="btn btn--secondary" onClick={() => reviewFeedback(row.id, "APPLIED")}>
                    Applied
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
