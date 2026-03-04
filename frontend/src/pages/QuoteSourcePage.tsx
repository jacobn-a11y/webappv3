import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getQuoteSourceSegment, type QuoteSourceSegmentResponse } from "../lib/api";

export function QuoteSourcePage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QuoteSourceSegmentResponse | null>(null);

  useEffect(() => {
    if (!quoteId) return;
    setLoading(true);
    setError(null);
    getQuoteSourceSegment(quoteId)
      .then((result) => setData(result))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load source segment");
      })
      .finally(() => setLoading(false));
  }, [quoteId]);

  if (!quoteId) {
    return <div className="page"><div className="state-view state-view--error">Missing quote ID.</div></div>;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Source Segment</h1>
          <p className="page__subtitle">Quote provenance reference</p>
        </div>
      </header>

      {loading ? (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading source...</div>
        </div>
      ) : error ? (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Source unavailable</div>
          <div className="state-view__message">{error}</div>
        </div>
      ) : data ? (
        <section className="card">
          <div className="card__body">
            <p><strong>Mode:</strong> {data.mode}</p>
            {data.call && (
              <p>
                <strong>Call:</strong> {data.call.title || data.call.id} ({new Date(data.call.occurred_at).toLocaleString()})
              </p>
            )}
            <blockquote style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
              {data.source.text}
            </blockquote>
            {data.transcript_url && (
              <p style={{ marginTop: 12 }}>
                <Link to={data.transcript_url}>Open full transcript</Link>
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default QuoteSourcePage;
