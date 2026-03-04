import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMyApprovalRequests,
  getMyQueue,
  type ContentQueueItem,
  type MyApprovalRequestRow,
  type MyQueueBuckets,
  type MyQueueCounts,
} from "../lib/api";
import { badgeClass, formatEnumLabel } from "../lib/format";
import { TableSkeleton } from "../components/PageSkeleton";

const EMPTY_BUCKETS: MyQueueBuckets = {
  draft: [],
  in_review: [],
  approved: [],
  published_recent: [],
};

const EMPTY_COUNTS: MyQueueCounts = {
  draft: 0,
  in_review: 0,
  approved: 0,
  published_recent: 0,
};

function QueueSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ContentQueueItem[];
  onOpen: (item: ContentQueueItem) => void;
}) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <header className="card__header">
        <h2 className="card__title">{title}</h2>
      </header>
      <div className="card__body">
        {items.length === 0 ? (
          <p className="muted">No items.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Account</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.asset_type}:${item.asset_id}`}>
                  <td>{item.title}</td>
                  <td>{formatEnumLabel(item.asset_type)}</td>
                  <td>{item.account.name}</td>
                  <td>{new Date(item.updated_at).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm btn--secondary"
                      onClick={() => onOpen(item)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function MyQueuePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<MyQueueCounts>(EMPTY_COUNTS);
  const [buckets, setBuckets] = useState<MyQueueBuckets>(EMPTY_BUCKETS);
  const [requests, setRequests] = useState<MyApprovalRequestRow[]>([]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const [queueRes, requestRes] = await Promise.all([
          getMyQueue(),
          getMyApprovalRequests({ status: "ALL", limit: 100 }),
        ]);
        setCounts(queueRes.counts);
        setBuckets(queueRes.buckets);
        setRequests(requestRes.requests);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load your queue");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load({ silent: true });
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const openItem = (item: ContentQueueItem) => {
    if (item.latest_page_id) {
      navigate(`/pages/${item.latest_page_id}/edit`);
      return;
    }
    navigate("/stories");
  };

  const openRequest = (request: MyApprovalRequestRow) => {
    if (request.asset_type === "landing_page") {
      navigate(`/pages/${request.asset_id}/edit`);
      return;
    }
    navigate("/stories");
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">My Queue</h1>
          <p className="page__subtitle">Your drafts, approvals, and recent publishes.</p>
        </div>
      </header>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><span className="stat-card__label">Draft</span><strong className="stat-card__value">{counts.draft}</strong></div>
        <div className="stat-card"><span className="stat-card__label">In Review</span><strong className="stat-card__value">{counts.in_review}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Approved</span><strong className="stat-card__value">{counts.approved}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Published (30d)</span><strong className="stat-card__value">{counts.published_recent}</strong></div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Failed to load your queue</div>
          <div className="state-view__message">{error}</div>
        </div>
      ) : (
        <>
          <QueueSection title="Draft" items={buckets.draft} onOpen={openItem} />
          <QueueSection title="In Review" items={buckets.in_review} onOpen={openItem} />
          <QueueSection title="Approved" items={buckets.approved} onOpen={openItem} />
          <QueueSection
            title="Published (Recent)"
            items={buckets.published_recent}
            onOpen={openItem}
          />

          <section className="card" style={{ marginBottom: 16 }}>
            <header className="card__header">
              <h2 className="card__title">My Requests History</h2>
            </header>
            <div className="card__body">
              {requests.length === 0 ? (
                <p className="muted">No publish requests yet.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th>Asset</th>
                      <th>Title</th>
                      <th>Account</th>
                      <th>Reviewed</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => (
                      <tr key={request.id}>
                        <td>{new Date(request.created_at).toLocaleString()}</td>
                        <td>
                          <span className={badgeClass(request.status)}>
                            {formatEnumLabel(request.status)}
                          </span>
                        </td>
                        <td>{formatEnumLabel(request.asset_type)}</td>
                        <td>{request.title}</td>
                        <td>{request.account_name ?? "-"}</td>
                        <td>
                          {request.reviewed_at
                            ? new Date(request.reviewed_at).toLocaleString()
                            : "-"}
                        </td>
                        <td>{request.review_notes || "-"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary"
                            onClick={() => openRequest(request)}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default MyQueuePage;
