import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getStoryLibraryTaxonomy, type StoryLibraryTaxonomyCounts } from "../lib/api";
import { FUNNEL_STAGE_LABELS, STAGE_TOPICS, TOPIC_LABELS, type FunnelStage } from "../types/taxonomy";

const EMPTY_COUNTS: StoryLibraryTaxonomyCounts = {
  funnel_stage_counts: {},
  topic_counts: {},
};

export function TaxonomyBrowserPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<StoryLibraryTaxonomyCounts>(EMPTY_COUNTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getStoryLibraryTaxonomy()
      .then((res) => {
        if (cancelled) return;
        setCounts(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load taxonomy counts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stages = useMemo(
    () => Object.keys(STAGE_TOPICS).sort() as FunnelStage[],
    []
  );

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Taxonomy Browser</h1>
          <p className="page__subtitle">Explore funnel-stage and topic coverage across your accessible story library.</p>
        </div>
      </header>

      {loading && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading taxonomy...</div>
        </div>
      )}

      {!loading && error && (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Failed to load taxonomy</div>
          <div className="state-view__message">{error}</div>
        </div>
      )}

      {!loading && !error && (
        <div className="card card--elevated" style={{ display: "grid", gap: 16 }}>
          {stages.map((stage) => {
            const topics = STAGE_TOPICS[stage] ?? [];
            const stageCount = counts.funnel_stage_counts[stage] ?? 0;
            return (
              <section key={stage} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <h2 style={{ margin: 0 }}>{FUNNEL_STAGE_LABELS[stage] ?? stage}</h2>
                  <span className="badge badge--info">{stageCount} stories</span>
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {topics.map((topic) => {
                    const topicCount = counts.topic_counts[topic] ?? 0;
                    return (
                      <button
                        key={topic}
                        type="button"
                        className="btn btn--ghost"
                        style={{ justifyContent: "space-between", display: "flex" }}
                        onClick={() => navigate(`/stories?funnel_stage=${encodeURIComponent(stage)}&topic=${encodeURIComponent(topic)}`)}
                      >
                        <span>{TOPIC_LABELS[topic] ?? topic}</span>
                        <span>{topicCount}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TaxonomyBrowserPage;
