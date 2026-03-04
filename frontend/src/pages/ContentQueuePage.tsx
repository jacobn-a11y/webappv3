import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getContentQueue, type ContentQueueItem } from "../lib/api";
import { badgeClass, formatEnumLabel } from "../lib/format";
import { TableSkeleton } from "../components/PageSkeleton";

const STAGES = ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export function ContentQueuePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("");
  const [assetType, setAssetType] = useState<"all" | "story" | "landing_page">(
    "all"
  );
  const [items, setItems] = useState<ContentQueueItem[]>([]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const res = await getContentQueue({
          asset_type: assetType,
          stage: stage ? (stage as (typeof STAGES)[number]) : undefined,
        });
        setItems(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load content queue");
        setItems([]);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [assetType, stage]
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
    if (item.asset_type === "story") {
      navigate("/stories");
      return;
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Content Queue</h1>
          <p className="page__subtitle">Lifecycle view across stories and pages.</p>
        </div>
      </header>

      <div className="form-grid" style={{ gridTemplateColumns: "220px 220px auto" }}>
        <label className="form-group">
          <span className="form-group__label">Asset Type</span>
          <select
            className="form-select"
            value={assetType}
            onChange={(event) =>
              setAssetType(event.target.value as "all" | "story" | "landing_page")
            }
          >
            <option value="all">All</option>
            <option value="story">Stories</option>
            <option value="landing_page">Pages</option>
          </select>
        </label>
        <label className="form-group">
          <span className="form-group__label">Stage</span>
          <select className="form-select" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {formatEnumLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Failed to load content queue</div>
          <div className="state-view__message">{error}</div>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void load()} style={{ marginTop: 12 }}>Retry</button>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table" aria-label="Content queue items">
            <thead>
              <tr>
                <th>Title</th>
                <th>Account</th>
                <th>Type</th>
                <th>Stage</th>
                <th>Creator</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.asset_type}:${item.asset_id}`}>
                  <td>{item.title}</td>
                  <td>{item.account.name}</td>
                  <td>{formatEnumLabel(item.asset_type)}</td>
                  <td>
                    <span className={badgeClass(item.stage)}>{formatEnumLabel(item.stage)}</span>
                  </td>
                  <td>{item.creator?.name || item.creator?.email || "-"}</td>
                  <td>{new Date(item.updated_at).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm btn--secondary"
                      onClick={() => openItem(item)}
                    >
                      Open
                    </button>
                    {item.stage !== "PUBLISHED" && (
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => openItem(item)}
                      >
                        Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="data-table__empty">
                    No items found. Try broadening your filters or check back later.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ContentQueuePage;
