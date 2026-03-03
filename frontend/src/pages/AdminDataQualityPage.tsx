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
import { badgeClass, formatEnumLabel } from "../lib/format";
import { AdminErrorState } from "../components/admin/AdminErrorState";
import {
  AdminKpi,
  AdminKpiGrid,
  AdminSection,
} from "../components/admin/AdminLayoutPrimitives";

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
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading quality dashboard...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header"><div className="page__header-text"><h1 className="page__title">Data Quality & Trust</h1><p className="page__subtitle">Monitor story confidence, lineage coverage, and human feedback</p></div></div>
      {error && (
        <AdminErrorState
          title="Quality Data Request Failed"
          message={error}
          onRetry={() => void load()}
        />
      )}

      {overview && (
        <AdminSection title="Quality Overview">
          <AdminKpiGrid>
            <AdminKpi label="Stories Total" value={overview.stories_total} />
            <AdminKpi label="Confidence (30d)" value={overview.confidence.avg_30d} />
            <AdminKpi
              label="Drift"
              value={formatEnumLabel(overview.confidence.drift_status)}
              hint={overview.confidence.drift_delta}
            />
            <AdminKpi label="Lineage Claims (30d)" value={overview.lineage.claims_30d} />
            <AdminKpi label="Lineage Coverage" value={overview.lineage.coverage_ratio} />
            <AdminKpi label="Sync Failures (30d)" value={overview.sync_errors.failures_30d} />
            <AdminKpi label="Open Feedback" value={overview.human_feedback.open} />
          </AdminKpiGrid>
        </AdminSection>
      )}

      <AdminSection title="Lookup Story Lineage">
        <div className="form-row">
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
                  [{formatEnumLabel(claim.claim_type)}] {claim.claim_text.slice(0, 120)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminSection>

      <section className="card card--elevated">
        <h2>Submit Quality Feedback (Human-in-the-loop)</h2>
        <div className="form-row">
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
            <option value="CORRECTION">{formatEnumLabel("CORRECTION")}</option>
            <option value="DISPUTE">{formatEnumLabel("DISPUTE")}</option>
            <option value="MISSING_EVIDENCE">{formatEnumLabel("MISSING_EVIDENCE")}</option>
            <option value="LINEAGE_FIX">{formatEnumLabel("LINEAGE_FIX")}</option>
          </select>
          <select
            value={newFeedback.target_type}
            onChange={(e) =>
              setNewFeedback((s) => ({ ...s, target_type: e.target.value as "STORY" | "QUOTE" | "CLAIM" }))
            }
          >
            <option value="STORY">{formatEnumLabel("STORY")}</option>
            <option value="QUOTE">{formatEnumLabel("QUOTE")}</option>
            <option value="CLAIM">{formatEnumLabel("CLAIM")}</option>
          </select>
          <input
            value={newFeedback.corrected_value}
            onChange={(e) => setNewFeedback((s) => ({ ...s, corrected_value: e.target.value }))}
            placeholder="Corrected value"
          />
        </div>
        <textarea
          className="form-textarea"
          value={newFeedback.notes}
          onChange={(e) => setNewFeedback((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Feedback notes"
        />
        <label className="form-row">
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

      <section className="card card--elevated">
        <h2>Feedback Queue</h2>
        <table className="data-table">
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
                <td><span className={badgeClass(row.status)}>{formatEnumLabel(row.status)}</span></td>
                <td>{row.story.title}</td>
                <td>{formatEnumLabel(row.feedback_type)}</td>
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
