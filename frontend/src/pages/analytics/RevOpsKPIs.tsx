import type { RevOpsKpiData } from "../../lib/api";
import { SummaryCard } from "./SummaryCards";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface RevOpsKPIsProps {
  kpis: RevOpsKpiData;
}

// ─── RevOpsKPIs ─────────────────────────────────────────────────────────────

export function RevOpsKPIs({ kpis }: RevOpsKPIsProps) {
  return (
    <div className="analytics__section">
      <h3 className="analytics__section-title">RevOps KPI Package (Last {kpis.window_days} Days)</h3>
      <div className="analytics__summary-grid">
        <SummaryCard
          title="Pipeline Influence"
          value={`${kpis.pipeline_influence.influence_rate_percent}%`}
          icon={<span />}
        />
        <SummaryCard
          title="Win Rate"
          value={`${kpis.win_loss.win_rate_percent}%`}
          icon={<span />}
        />
        <SummaryCard
          title="Competitor Mentions"
          value={formatNumber(kpis.competitor_mentions.transcript_level_competitor_mentions)}
          icon={<span />}
        />
        <SummaryCard
          title="Objection Mentions"
          value={formatNumber(kpis.persona_objections.transcript_level_objection_mentions)}
          icon={<span />}
        />
      </div>
      <div className="analytics__tables-row">
        <div className="analytics__table-card">
          <h3 className="analytics__table-title">Attribution Links</h3>
          <table className="pages-table">
            <tbody>
              <tr><td>Linked Calls</td><td className="views">{kpis.attribution_links.linked_calls}</td></tr>
              <tr><td>Linked Stories</td><td className="views">{kpis.attribution_links.linked_stories}</td></tr>
              <tr><td>Opportunity Events</td><td className="views">{kpis.attribution_links.linked_opportunity_events}</td></tr>
              <tr><td>Campaign Links</td><td className="views">{kpis.attribution_links.linked_campaigns}</td></tr>
            </tbody>
          </table>
          <p className="analytics__note">{kpis.attribution_links.note}</p>
        </div>
        <div className="analytics__table-card">
          <h3 className="analytics__table-title">Executive Summary</h3>
          <ul>
            {kpis.executive_summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
