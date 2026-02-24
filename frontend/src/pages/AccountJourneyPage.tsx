import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumb } from "../components/Breadcrumb";
import {
  getAccountJourney,
  type JourneyAccount,
  type JourneyTimelineNode,
} from "../lib/api";

// ─── Local Types ─────────────────────────────────────────────────────────────

type TopContact = JourneyAccount["top_contacts"][number];

// ─── Constants ──────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  TOFU: "#059669",
  MOFU: "#336FE6",
  BOFU: "#ea580c",
  POST_SALE: "#7c3aed",
  INTERNAL: "#8A888E",
};

const STAGE_LABELS: Record<string, string> = {
  TOFU: "Top of Funnel",
  MOFU: "Mid-Funnel",
  BOFU: "Bottom of Funnel",
  POST_SALE: "Post-Sale",
  INTERNAL: "Internal",
};

const CRM_EVENT_LABELS: Record<string, string> = {
  OPPORTUNITY_CREATED: "Opportunity Created",
  OPPORTUNITY_STAGE_CHANGE: "Stage Change",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
  CONTACT_CREATED: "Contact Created",
  NOTE_CREATED: "Note Created",
  TASK_COMPLETED: "Task Completed",
  EMAIL_SENT: "Email Sent",
};

interface CrmEventConfig {
  icon: React.ReactNode;
  color: string;
}

const CRM_EVENT_CONFIGS: Record<string, CrmEventConfig> = {
  OPPORTUNITY_CREATED: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#336FE6" strokeWidth="1.5">
        <polygon points="8,1 10,6 15,6.5 11,10 12.5,15 8,12 3.5,15 5,10 1,6.5 6,6" />
      </svg>
    ),
    color: "#336FE6",
  },
  OPPORTUNITY_STAGE_CHANGE: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#d97706" strokeWidth="1.5">
        <path d="M4 8h8M9 4l4 4-4 4" />
      </svg>
    ),
    color: "#d97706",
  },
  CLOSED_WON: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#059669" strokeWidth="1.5">
        <path d="M5 2v3h6V2M4 5h8l1 9H3l1-9z" />
        <circle cx="8" cy="10" r="1.5" />
      </svg>
    ),
    color: "#059669",
  },
  CLOSED_LOST: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#dc2626" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
      </svg>
    ),
    color: "#dc2626",
  },
  CONTACT_CREATED: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8A888E" strokeWidth="1.5">
        <circle cx="8" cy="6" r="3" />
        <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      </svg>
    ),
    color: "#8A888E",
  },
  NOTE_CREATED: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8A888E" strokeWidth="1.5">
        <rect x="3" y="2" width="10" height="12" rx="1" />
        <path d="M6 5h4M6 8h4M6 11h2" />
      </svg>
    ),
    color: "#8A888E",
  },
  TASK_COMPLETED: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#059669" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M5 8l2 2 4-4" />
      </svg>
    ),
    color: "#059669",
  },
  EMAIL_SENT: {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#336FE6" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M2 4l6 5 6-5" />
      </svg>
    ),
    color: "#336FE6",
  },
};

const DEFAULT_CRM_CONFIG: CrmEventConfig = {
  icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8A888E" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  ),
  color: "#8A888E",
};

// ─── Provider Icons ─────────────────────────────────────────────────────────

function ProviderIcon({ provider }: { provider: string | undefined }) {
  const label = provider ?? "call";
  const firstChar = label.charAt(0).toUpperCase();
  return (
    <span className="journey__provider-icon" title={label}>
      {firstChar}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateTime(dateStr: string): {
  date: string;
  time: string;
} {
  try {
    const d = new Date(dateStr);
    return {
      date: d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
    };
  } catch {
    return { date: dateStr, time: "" };
  }
}

function getMonthKey(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function formatMonthLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });
  } catch {
    return dateStr;
  }
}

/** Build CRM data rows from account fields */
function buildCrmData(account: JourneyAccount): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (account.industry) rows.push({ label: "Industry", value: account.industry });
  if (account.annual_revenue != null) rows.push({ label: "Revenue", value: formatCurrency(account.annual_revenue) });
  if (account.employee_count != null) rows.push({ label: "Employees", value: formatNumber(account.employee_count) });
  if (account.salesforce_id) rows.push({ label: "Salesforce ID", value: account.salesforce_id });
  if (account.hubspot_id) rows.push({ label: "HubSpot ID", value: account.hubspot_id });
  return rows;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AccountJourneyPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [account, setAccount] = useState<JourneyAccount | null>(null);
  const [timeline, setTimeline] = useState<JourneyTimelineNode[]>([]);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    getAccountJourney(accountId)
      .then((res) => {
        setAccount(res.account);
        setTimeline(res.timeline);
        setStageCounts(res.stage_counts);
        setError(null);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load journey"
        );
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  if (!accountId) {
    return (
      <div className="journey__error">No account ID provided.</div>
    );
  }

  if (loading) {
    return (
      <div className="journey__loading" role="status" aria-live="polite">
        <div className="journey__spinner" aria-hidden="true" />
        <p>Loading account journey...</p>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="journey__error" role="alert">
        <p>Error: {error ?? "No data available"}</p>
      </div>
    );
  }

  const crmData = buildCrmData(account);

  return (
    <div className="journey__container">
      <div className="journey__breadcrumb">
        <Breadcrumb items={[
          { label: "Home", to: "/" },
          { label: "Accounts", to: "/accounts" },
          { label: account.name, to: `/accounts/${accountId}` },
          { label: "Journey" },
        ]} />
      </div>
      {/* Sidebar */}
      <aside className="journey__sidebar">
        {/* Account Info */}
        <div className="journey__account-header">
          <h2 className="journey__account-name">{account.name}</h2>
          {account.domain && (
            <span className="journey__account-domain">{account.domain}</span>
          )}
        </div>

        {/* Stats Grid */}
        <div className="journey__stats-grid">
          <div className="journey__stat">
            <span className="journey__stat-value">
              {formatNumber(account.call_count)}
            </span>
            <span className="journey__stat-label">Calls</span>
          </div>
          <div className="journey__stat">
            <span className="journey__stat-value">
              {formatMinutes(account.total_call_minutes)}
            </span>
            <span className="journey__stat-label">Call Time</span>
          </div>
          <div className="journey__stat">
            <span className="journey__stat-value">
              {formatNumber(account.contact_count)}
            </span>
            <span className="journey__stat-label">Contacts</span>
          </div>
          <div className="journey__stat">
            <span className="journey__stat-value">
              {formatNumber(account.story_count)}
            </span>
            <span className="journey__stat-label">Stories</span>
          </div>
        </div>

        {/* CRM Data */}
        {crmData.length > 0 && (
          <div className="journey__crm-section">
            <h3 className="journey__section-title">CRM Data</h3>
            <div className="journey__crm-rows">
              {crmData.map((row, i) => (
                <div key={i} className="journey__crm-row">
                  <span className="journey__crm-label">{row.label}</span>
                  <span className="journey__crm-value">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Funnel Stage Legend */}
        <div className="journey__funnel-section">
          <h3 className="journey__section-title">Funnel Stages</h3>
          <div className="journey__funnel-legend">
            {Object.entries(STAGE_COLORS).map(([stage, color]) => (
              <div key={stage} className="journey__funnel-item">
                <span
                  className="journey__funnel-dot"
                  style={{ backgroundColor: color }}
                />
                <span className="journey__funnel-label">
                  {STAGE_LABELS[stage] ?? stage}
                </span>
                <span className="journey__funnel-count">
                  {stageCounts[stage] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Contacts */}
        {account.top_contacts.length > 0 && (
          <div className="journey__contacts-section">
            <h3 className="journey__section-title">Top Contacts</h3>
            <div className="journey__contacts-list">
              {account.top_contacts.map((contact, i) => (
                <ContactCard key={i} contact={contact} />
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="journey__main">
        <div className="journey__header">
          <h1 className="journey__title">Account Journey</h1>
          <Link to={`/accounts/${accountId}?newStory=1`} className="btn btn--primary">
            Generate Story
          </Link>
        </div>

        <div className="journey__timeline">
          <TimelineRenderer timeline={timeline} />
        </div>
      </main>
    </div>
  );
}

// ─── Contact Card ───────────────────────────────────────────────────────────

function ContactCard({ contact }: { contact: TopContact }) {
  return (
    <div className="journey__contact">
      <div className="journey__contact-avatar">
        <span className="journey__contact-initials">
          {getInitials(contact.name)}
        </span>
      </div>
      <div className="journey__contact-info">
        <span className="journey__contact-name">{contact.name ?? "Unknown"}</span>
        {contact.title && (
          <span className="journey__contact-title">{contact.title}</span>
        )}
        {contact.email && (
          <span className="journey__contact-email">{contact.email}</span>
        )}
      </div>
      <span className="journey__contact-calls">
        {contact.call_appearances} call{contact.call_appearances !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

// ─── Timeline Renderer ─────────────────────────────────────────────────────

function TimelineRenderer({ timeline }: { timeline: JourneyTimelineNode[] }) {
  if (timeline.length === 0) {
    return (
      <div className="journey__timeline-empty">
        <p>No timeline events found for this account.</p>
      </div>
    );
  }

  let lastMonth = "";

  return (
    <>
      {timeline.map((node) => {
        const nodeDate = node.date;
        const monthKey = getMonthKey(nodeDate);
        let showSeparator = false;

        if (monthKey !== lastMonth) {
          showSeparator = true;
          lastMonth = monthKey;
        }

        return (
          <div key={node.id}>
            {showSeparator && (
              <div className="journey__month-separator">
                <span className="journey__month-label">
                  {formatMonthLabel(nodeDate)}
                </span>
              </div>
            )}
            {node.type === "call" ? (
              <CallNode node={node} />
            ) : (
              <CrmEventNode node={node} />
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── Call Node ───────────────────────────────────────────────────────────────

function CallNode({ node }: { node: JourneyTimelineNode }) {
  const stageColor =
    node.primary_stage && STAGE_COLORS[node.primary_stage]
      ? STAGE_COLORS[node.primary_stage]
      : "#8A888E";
  const { date, time } = formatDateTime(node.date);
  const participants = node.participants ?? [];
  const maxAvatars = 5;
  const visibleParticipants = participants.slice(0, maxAvatars);
  const overflow = participants.length - maxAvatars;
  const tags = node.tags ?? [];

  return (
    <div className="journey__node journey__node--call">
      <div className="journey__node-line">
        <span
          className="journey__node-dot"
          style={{ backgroundColor: stageColor }}
        />
      </div>
      <div className="journey__node-content">
        <div className="journey__node-header">
          <ProviderIcon provider={node.provider} />
          <div className="journey__node-title-group">
            <h4 className="journey__node-title">{node.title ?? "Untitled Call"}</h4>
            <span className="journey__node-datetime">
              {date} &middot; {time}
              {node.duration != null && <> &middot; {formatDuration(node.duration)}</>}
            </span>
          </div>
        </div>

        {/* Participants */}
        {participants.length > 0 && (
          <div className="journey__participants">
            {visibleParticipants.map((p, i) => (
              <div key={i} className="journey__participant" title={p.name ?? p.email ?? "Unknown"}>
                <span className="journey__participant-initials">
                  {getInitials(p.name ?? p.email)}
                </span>
              </div>
            ))}
            {overflow > 0 && (
              <div className="journey__participant journey__participant--overflow">
                <span>+{overflow}</span>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="journey__tags">
            {tags.map((tag, i) => (
              <span key={i} className="journey__tag">
                {tag.topic_label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CRM Event Node ─────────────────────────────────────────────────────────

function CrmEventNode({ node }: { node: JourneyTimelineNode }) {
  const eventType = node.event_type ?? "";
  const config = CRM_EVENT_CONFIGS[eventType] ?? DEFAULT_CRM_CONFIG;
  const { date } = formatDateTime(node.date);
  const label = CRM_EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");

  return (
    <div className="journey__node journey__node--crm">
      <div className="journey__node-line">
        <span
          className="journey__node-dot journey__node-dot--crm"
          style={{ borderColor: config.color }}
        />
      </div>
      <div className="journey__node-content journey__node-content--crm">
        <div className="journey__node-header">
          <span className="journey__crm-icon">{config.icon}</span>
          <div className="journey__node-title-group">
            <h4 className="journey__node-title">
              {node.stage_name ? `${label}: ${node.stage_name}` : label}
            </h4>
            <span className="journey__node-datetime">{date}</span>
          </div>
        </div>

        {node.description && (
          <p className="journey__crm-detail">{node.description}</p>
        )}

        {node.amount != null && (
          <span className="journey__crm-amount">
            {formatCurrency(node.amount)}
          </span>
        )}
      </div>
    </div>
  );
}
