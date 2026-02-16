/**
 * Account Journey Timeline Routes
 *
 * Provides:
 *   - GET /api/accounts/:accountId/journey      — JSON API for timeline data
 *   - GET /api/accounts/:accountId/journey/view  — Server-rendered HTML timeline
 *
 * The timeline merges calls and Salesforce CRM events chronologically.
 * Each call node shows: date, title, provider icon, duration, participant
 * avatars, and taxonomy tag pills color-coded by funnel stage.
 *
 * A sidebar displays the account's CRM data (industry, revenue, contacts).
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import {
  AccountJourneyService,
  type TimelineNode,
  type TimelineCallNode,
  type TimelineCrmEventNode,
  type AccountCrmSidebar,
} from "../services/account-journey.js";

// ─── Auth Request ─────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ────────────────────────────────────────────────────────────

export function createAccountJourneyRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const journeyService = new AccountJourneyService(prisma);

  /**
   * GET /api/accounts/:accountId/journey
   *
   * Returns the full account journey data as JSON:
   *   - account sidebar (CRM data, contacts, metrics)
   *   - timeline nodes (calls + CRM events, chronologically sorted)
   *   - stage counts
   */
  router.get("/:accountId/journey", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const data = await journeyService.getAccountJourney(
        req.params.accountId as string,
        req.organizationId
      );

      res.json({
        account: {
          id: data.account.id,
          name: data.account.name,
          domain: data.account.domain,
          industry: data.account.industry,
          employee_count: data.account.employeeCount,
          annual_revenue: data.account.annualRevenue,
          salesforce_id: data.account.salesforceId,
          hubspot_id: data.account.hubspotId,
          contact_count: data.account.contactCount,
          call_count: data.account.callCount,
          total_call_minutes: data.account.totalCallMinutes,
          story_count: data.account.storyCount,
          top_contacts: data.account.topContacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            title: c.title,
            call_appearances: c.callAppearances,
          })),
        },
        timeline: data.timeline.map((node) => {
          if (node.type === "call") {
            return {
              type: "call",
              id: node.id,
              date: node.date,
              title: node.title,
              provider: node.provider,
              duration: node.duration,
              primary_stage: node.primaryStage,
              participants: node.participants.map((p) => ({
                id: p.id,
                name: p.name,
                email: p.email,
                is_host: p.isHost,
                title: p.title,
              })),
              tags: node.tags.map((t) => ({
                funnel_stage: t.funnelStage,
                topic: t.topic,
                topic_label: t.topicLabel,
                confidence: t.confidence,
              })),
            };
          }
          return {
            type: "crm_event",
            id: node.id,
            date: node.date,
            event_type: node.eventType,
            stage_name: node.stageName,
            opportunity_id: node.opportunityId,
            amount: node.amount,
            description: node.description,
          };
        }),
        stage_counts: data.stageCounts,
      });
    } catch (err) {
      console.error("Account journey error:", err);
      res.status(500).json({ error: "Failed to load account journey" });
    }
  });

  /**
   * GET /api/accounts/:accountId/journey/view
   *
   * Renders the Account Journey Timeline as a full server-rendered HTML page.
   */
  router.get(
    "/:accountId/journey/view",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const data = await journeyService.getAccountJourney(
          req.params.accountId as string,
          req.organizationId
        );

        res.setHeader("Cache-Control", "private, no-cache");
        res.send(
          renderJourneyPage(data.account, data.timeline, data.stageCounts)
        );
      } catch (err) {
        console.error("Account journey view error:", err);
        res.status(500).send(renderErrorPage());
      }
    }
  );

  return router;
}

// ─── Funnel Stage Colors ──────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  TOFU:      { bg: "#ecfdf5", fg: "#059669", border: "#059669", label: "ToFu" },
  MOFU:      { bg: "#eff6ff", fg: "#2563eb", border: "#2563eb", label: "MoFu" },
  BOFU:      { bg: "#fff7ed", fg: "#ea580c", border: "#ea580c", label: "BoFu" },
  POST_SALE: { bg: "#faf5ff", fg: "#7c3aed", border: "#7c3aed", label: "Post-Sale" },
  INTERNAL:  { bg: "#f3f4f6", fg: "#6b7280", border: "#6b7280", label: "Internal" },
  VERTICAL:  { bg: "#f3f4f6", fg: "#6b7280", border: "#6b7280", label: "Vertical" },
};

function getStageColor(stage: string | null) {
  return STAGE_COLORS[stage ?? ""] ?? { bg: "#f3f4f6", fg: "#6b7280", border: "#9ca3af", label: "Unknown" };
}

// ─── CRM Event Labels & Icons ─────────────────────────────────────────────────

const CRM_EVENT_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  OPPORTUNITY_CREATED:      { label: "Opportunity Created",    icon: "star",     color: "#2563eb" },
  OPPORTUNITY_STAGE_CHANGE: { label: "Stage Change",           icon: "arrow",    color: "#d97706" },
  CLOSED_WON:               { label: "Closed Won",             icon: "trophy",   color: "#059669" },
  CLOSED_LOST:              { label: "Closed Lost",            icon: "x-circle", color: "#dc2626" },
  CONTACT_CREATED:          { label: "Contact Created",        icon: "user",     color: "#6b7280" },
  LEAD_CONVERTED:           { label: "Lead Converted",         icon: "check",    color: "#059669" },
  TASK_COMPLETED:           { label: "Task Completed",         icon: "check",    color: "#6b7280" },
  NOTE_ADDED:               { label: "Note Added",             icon: "note",     color: "#6b7280" },
};

// ─── Provider Icons (SVG) ─────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  GONG:        '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">G</text></svg>',
  CHORUS:      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">C</text></svg>',
  ZOOM:        '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="6" width="20" height="12" rx="3"/><text x="12" y="15" text-anchor="middle" fill="white" font-size="8" font-weight="bold">Zm</text></svg>',
  GOOGLE_MEET: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="5" width="13" height="14" rx="2"/><polygon points="15,8 22,4 22,20 15,16"/></svg>',
  TEAMS:       '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">T</text></svg>',
  FIREFLIES:   '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">F</text></svg>',
  DIALPAD:     '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">D</text></svg>',
  AIRCALL:     '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">A</text></svg>',
  RINGCENTRAL: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">R</text></svg>',
  SALESLOFT:   '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">S</text></svg>',
  OUTREACH:    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">O</text></svg>',
  OTHER:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>',
};

// ─── CRM Event SVG Icons ──────────────────────────────────────────────────────

const CRM_ICONS: Record<string, string> = {
  star:       '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>',
  arrow:      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>',
  trophy:     '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 5a3 3 0 015-2.236A3 3 0 0114.83 6H16a2 2 0 110 4h-1.17a3 3 0 01-1.659 1.115l.537 2.15A2 2 0 0111.768 16H8.232a2 2 0 01-1.94-2.735l.537-2.15A3 3 0 015.17 10H4a2 2 0 110-4h1.17A3 3 0 015 5z" clip-rule="evenodd"/></svg>',
  "x-circle": '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
  user:       '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>',
  check:      '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>',
  note:       '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>',
};

// ─── HTML Renderer ────────────────────────────────────────────────────────────

function renderJourneyPage(
  account: AccountCrmSidebar,
  timeline: TimelineNode[],
  stageCounts: Record<string, number>
): string {
  // Reset month tracker per render to avoid cross-request state
  const monthTracker = { lastMonth: "" };
  const timelineHtml = timeline.length > 0
    ? timeline.map((node) => renderTimelineNode(node, monthTracker)).join("\n")
    : '<div class="empty-state">No calls or events recorded for this account yet.</div>';

  const sidebarHtml = renderSidebar(account, stageCounts);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Account Journey — ${esc(account.name)}</title>
  <style>
    /* ─── Reset & Base ────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8fafc;
      --color-surface: #ffffff;
      --color-text: #0f172a;
      --color-text-secondary: #64748b;
      --color-text-muted: #94a3b8;
      --color-border: #e2e8f0;
      --color-border-light: #f1f5f9;
      --color-accent: #4f46e5;
      --color-accent-light: #eef2ff;
      --stage-tofu: #059669;
      --stage-mofu: #2563eb;
      --stage-bofu: #ea580c;
      --stage-postsale: #7c3aed;
      --stage-internal: #6b7280;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --sidebar-width: 340px;
      --timeline-line: #cbd5e1;
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ──────────────────────────────────────────────── */
    .page-layout {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      position: sticky;
      top: 0;
      width: var(--sidebar-width);
      height: 100vh;
      overflow-y: auto;
      border-right: 1px solid var(--color-border);
      background: var(--color-surface);
      padding: 1.5rem;
      flex-shrink: 0;
    }

    .main-content {
      flex: 1;
      padding: 2rem 2.5rem;
      max-width: 900px;
    }

    /* ─── Sidebar ─────────────────────────────────────────────── */
    .sidebar__header {
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid var(--color-accent);
    }
    .sidebar__account-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text);
      line-height: 1.3;
    }
    .sidebar__domain {
      font-size: 0.8rem;
      color: var(--color-text-secondary);
      margin-top: 0.25rem;
    }

    .sidebar__section {
      margin-bottom: 1.25rem;
    }
    .sidebar__section-title {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin-bottom: 0.5rem;
    }

    .sidebar__stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .sidebar__stat {
      background: var(--color-bg);
      border-radius: 8px;
      padding: 0.6rem 0.75rem;
    }
    .sidebar__stat-value {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--color-text);
    }
    .sidebar__stat-label {
      font-size: 0.7rem;
      color: var(--color-text-muted);
      margin-top: 0.1rem;
    }

    .sidebar__info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.35rem 0;
      font-size: 0.82rem;
      border-bottom: 1px solid var(--color-border-light);
    }
    .sidebar__info-label { color: var(--color-text-muted); }
    .sidebar__info-value { color: var(--color-text); font-weight: 500; }

    .sidebar__contact {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--color-border-light);
    }
    .sidebar__contact:last-child { border-bottom: none; }
    .sidebar__contact-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--color-accent-light);
      color: var(--color-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 600;
      flex-shrink: 0;
    }
    .sidebar__contact-info {
      min-width: 0;
    }
    .sidebar__contact-name {
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebar__contact-title {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebar__contact-calls {
      margin-left: auto;
      font-size: 0.7rem;
      color: var(--color-text-muted);
      flex-shrink: 0;
    }

    /* Stage legend */
    .sidebar__stage-legend {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .sidebar__stage-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
    }
    .sidebar__stage-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .sidebar__stage-count {
      margin-left: auto;
      font-weight: 600;
      font-size: 0.8rem;
    }

    /* ─── Page Header ─────────────────────────────────────────── */
    .page-header {
      margin-bottom: 2rem;
    }
    .page-header__title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
    }
    .page-header__subtitle {
      font-size: 0.9rem;
      color: var(--color-text-secondary);
      margin-top: 0.25rem;
    }

    /* ─── Timeline ────────────────────────────────────────────── */
    .timeline {
      position: relative;
      padding-left: 2rem;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 11px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--timeline-line);
    }

    .timeline-node {
      position: relative;
      margin-bottom: 1.5rem;
    }

    /* ─── Timeline: Call Node ─────────────────────────────────── */
    .call-node {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .call-node:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      border-color: #cbd5e1;
    }

    .call-node__dot {
      position: absolute;
      left: -2rem;
      top: 1.15rem;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 3px solid var(--color-surface);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }
    .call-node__dot svg {
      width: 12px;
      height: 12px;
      color: white;
    }

    .call-node__header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .call-node__provider-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .call-node__provider-icon svg { width: 18px; height: 18px; }
    .call-node__title-area { flex: 1; min-width: 0; }
    .call-node__title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.3;
    }
    .call-node__meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.2rem;
      font-size: 0.78rem;
      color: var(--color-text-muted);
    }
    .call-node__meta-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .call-node__meta-item svg { width: 13px; height: 13px; }

    /* Participants */
    .call-node__participants {
      display: flex;
      align-items: center;
      gap: 0;
      margin-top: 0.6rem;
      margin-bottom: 0.5rem;
    }
    .participant-avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid var(--color-surface);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.62rem;
      font-weight: 600;
      margin-left: -6px;
      position: relative;
      cursor: default;
    }
    .participant-avatar:first-child { margin-left: 0; }
    .participant-avatar--host {
      background: var(--color-accent);
      color: white;
    }
    .participant-avatar--guest {
      background: #e0e7ff;
      color: var(--color-accent);
    }
    .participant-overflow {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid var(--color-surface);
      background: var(--color-bg);
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      font-weight: 600;
      margin-left: -6px;
    }
    .participant-tooltip {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-text);
      color: white;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
    }
    .participant-avatar:hover .participant-tooltip { opacity: 1; }

    /* Tags */
    .call-node__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .tag-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.55rem;
      border-radius: 99px;
      font-size: 0.7rem;
      font-weight: 500;
      line-height: 1.5;
      border: 1px solid;
    }

    /* ─── Timeline: CRM Event Node ────────────────────────────── */
    .crm-node {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 1rem;
      background: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: 10px;
    }

    .crm-node__dot {
      position: absolute;
      left: -2rem;
      top: 0.7rem;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 2px dashed;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }
    .crm-node__dot svg { width: 12px; height: 12px; }

    .crm-node__icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .crm-node__icon svg { width: 16px; height: 16px; }

    .crm-node__content { flex: 1; }
    .crm-node__label {
      font-size: 0.85rem;
      font-weight: 600;
    }
    .crm-node__detail {
      font-size: 0.78rem;
      color: var(--color-text-secondary);
      margin-top: 0.1rem;
    }
    .crm-node__date {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      flex-shrink: 0;
    }
    .crm-node__amount {
      font-size: 0.85rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    /* ─── Date Separator ──────────────────────────────────────── */
    .date-separator {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      margin-top: 0.5rem;
      padding-left: 0;
      position: relative;
    }
    .date-separator__label {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      background: var(--color-bg);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
    }

    /* ─── Empty State ─────────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--color-text-secondary);
      font-size: 0.95rem;
    }

    /* ─── Responsive ──────────────────────────────────────────── */
    @media (max-width: 900px) {
      .page-layout { flex-direction: column; }
      .sidebar {
        position: static;
        width: 100%;
        height: auto;
        border-right: none;
        border-bottom: 1px solid var(--color-border);
      }
      .main-content { padding: 1.5rem 1rem; }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="page-layout">
    ${sidebarHtml}

    <div class="main-content">
      <div class="page-header">
        <h1 class="page-header__title">Account Journey</h1>
        <p class="page-header__subtitle">${esc(account.name)} — ${timeline.length} event${timeline.length !== 1 ? "s" : ""} across the sales cycle</p>
      </div>

      <div class="timeline">
        ${timelineHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Sidebar Renderer ─────────────────────────────────────────────────────────

function renderSidebar(
  account: AccountCrmSidebar,
  stageCounts: Record<string, number>
): string {
  const stats = [
    { value: String(account.callCount), label: "Calls" },
    { value: `${account.totalCallMinutes}m`, label: "Call Time" },
    { value: String(account.contactCount), label: "Contacts" },
    { value: String(account.storyCount), label: "Stories" },
  ];

  const crmInfo: { label: string; value: string }[] = [];
  if (account.industry) crmInfo.push({ label: "Industry", value: account.industry });
  if (account.employeeCount) crmInfo.push({ label: "Employees", value: formatNumber(account.employeeCount) });
  if (account.annualRevenue) crmInfo.push({ label: "Revenue", value: formatCurrency(account.annualRevenue) });
  if (account.salesforceId) crmInfo.push({ label: "Salesforce", value: "Connected" });
  if (account.hubspotId) crmInfo.push({ label: "HubSpot", value: "Connected" });

  const stageOrder = ["TOFU", "MOFU", "BOFU", "POST_SALE", "INTERNAL"];

  return `
    <aside class="sidebar">
      <div class="sidebar__header">
        <div class="sidebar__account-name">${esc(account.name)}</div>
        ${account.domain ? `<div class="sidebar__domain">${esc(account.domain)}</div>` : ""}
      </div>

      <!-- Stats Grid -->
      <div class="sidebar__section">
        <div class="sidebar__section-title">Overview</div>
        <div class="sidebar__stat-grid">
          ${stats.map((s) => `
            <div class="sidebar__stat">
              <div class="sidebar__stat-value">${s.value}</div>
              <div class="sidebar__stat-label">${s.label}</div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- CRM Data -->
      ${crmInfo.length > 0 ? `
      <div class="sidebar__section">
        <div class="sidebar__section-title">CRM Data</div>
        ${crmInfo.map((r) => `
          <div class="sidebar__info-row">
            <span class="sidebar__info-label">${r.label}</span>
            <span class="sidebar__info-value">${esc(r.value)}</span>
          </div>
        `).join("")}
      </div>
      ` : ""}

      <!-- Funnel Stage Distribution -->
      <div class="sidebar__section">
        <div class="sidebar__section-title">Funnel Stages</div>
        <div class="sidebar__stage-legend">
          ${stageOrder.map((stage) => {
            const color = getStageColor(stage);
            const count = stageCounts[stage] ?? 0;
            return `
              <div class="sidebar__stage-row">
                <span class="sidebar__stage-dot" style="background: ${color.fg}"></span>
                <span>${color.label}</span>
                <span class="sidebar__stage-count" style="color: ${color.fg}">${count}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- Top Contacts -->
      ${account.topContacts.length > 0 ? `
      <div class="sidebar__section">
        <div class="sidebar__section-title">Top Contacts</div>
        ${account.topContacts.slice(0, 8).map((c) => `
          <div class="sidebar__contact">
            <div class="sidebar__contact-avatar">${getInitials(c.name ?? c.email)}</div>
            <div class="sidebar__contact-info">
              <div class="sidebar__contact-name">${esc(c.name ?? c.email)}</div>
              ${c.title ? `<div class="sidebar__contact-title">${esc(c.title)}</div>` : ""}
            </div>
            <span class="sidebar__contact-calls">${c.callAppearances} call${c.callAppearances !== 1 ? "s" : ""}</span>
          </div>
        `).join("")}
      </div>
      ` : ""}
    </aside>
  `;
}

// ─── Timeline Node Renderers ──────────────────────────────────────────────────

function renderTimelineNode(node: TimelineNode, tracker: { lastMonth: string }): string {
  const date = new Date(node.date);
  const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
  let separator = "";

  if (monthKey !== tracker.lastMonth) {
    tracker.lastMonth = monthKey;
    const monthLabel = date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    separator = `<div class="date-separator"><span class="date-separator__label">${monthLabel}</span></div>`;
  }

  if (node.type === "call") {
    return separator + renderCallNode(node);
  }
  return separator + renderCrmEventNode(node);
}

function renderCallNode(node: TimelineCallNode): string {
  const date = new Date(node.date);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const durationStr = node.duration ? formatDuration(node.duration) : "";
  const stageColor = getStageColor(node.primaryStage);

  const providerIcon =
    PROVIDER_ICONS[node.provider] ?? PROVIDER_ICONS.OTHER;

  // Participant avatars (show up to 5, then +N overflow)
  const MAX_VISIBLE = 5;
  const visible = node.participants.slice(0, MAX_VISIBLE);
  const overflow = node.participants.length - MAX_VISIBLE;

  const participantsHtml = visible
    .map((p) => {
      const initials = getInitials(p.name ?? p.email ?? "?");
      const cls = p.isHost ? "participant-avatar--host" : "participant-avatar--guest";
      const tooltip = esc(p.name ?? p.email ?? "Unknown");
      return `<div class="participant-avatar ${cls}"><span class="participant-tooltip">${tooltip}${p.title ? ` — ${esc(p.title)}` : ""}</span>${initials}</div>`;
    })
    .join("");

  const overflowHtml =
    overflow > 0
      ? `<div class="participant-overflow">+${overflow}</div>`
      : "";

  // Tag pills
  const tagsHtml = node.tags
    .slice(0, 6)
    .map((t) => {
      const c = getStageColor(t.funnelStage);
      return `<span class="tag-pill" style="background: ${c.bg}; color: ${c.fg}; border-color: ${c.bg}">${esc(t.topicLabel)}</span>`;
    })
    .join("");

  return `
    <div class="timeline-node">
      <div class="call-node__dot" style="background: ${stageColor.fg}">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg>
      </div>
      <div class="call-node" style="border-left: 3px solid ${stageColor.fg}">
        <div class="call-node__header">
          <div class="call-node__provider-icon">${providerIcon}</div>
          <div class="call-node__title-area">
            <div class="call-node__title">${esc(node.title ?? "Untitled Call")}</div>
            <div class="call-node__meta">
              <span class="call-node__meta-item">
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
                ${dateStr}
              </span>
              <span class="call-node__meta-item">
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
                ${timeStr}
              </span>
              ${durationStr ? `
              <span class="call-node__meta-item">
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg>
                ${durationStr}
              </span>` : ""}
              <span class="call-node__meta-item" style="color: ${stageColor.fg}; font-weight: 500">${stageColor.label}</span>
            </div>
          </div>
        </div>

        ${node.participants.length > 0 ? `
        <div class="call-node__participants">
          ${participantsHtml}${overflowHtml}
        </div>
        ` : ""}

        ${tagsHtml ? `<div class="call-node__tags">${tagsHtml}</div>` : ""}
      </div>
    </div>
  `;
}

function renderCrmEventNode(node: TimelineCrmEventNode): string {
  const config = CRM_EVENT_CONFIG[node.eventType] ?? {
    label: node.eventType,
    icon: "note",
    color: "#6b7280",
  };

  const date = new Date(node.date);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const icon = CRM_ICONS[config.icon] ?? CRM_ICONS.note;

  const detail = node.stageName
    ? node.stageName
    : node.description
      ? node.description
      : null;

  const amountStr = node.amount ? formatCurrency(node.amount) : "";

  return `
    <div class="timeline-node">
      <div class="crm-node__dot" style="border-color: ${config.color}; color: ${config.color}">
        ${icon}
      </div>
      <div class="crm-node">
        <div class="crm-node__icon" style="background: ${config.color}15; color: ${config.color}">
          ${icon}
        </div>
        <div class="crm-node__content">
          <div class="crm-node__label" style="color: ${config.color}">${config.label}</div>
          ${detail ? `<div class="crm-node__detail">${esc(detail)}</div>` : ""}
        </div>
        ${amountStr ? `<span class="crm-node__amount" style="color: ${config.color}">${amountStr}</span>` : ""}
        <span class="crm-node__date">${dateStr}</span>
      </div>
    </div>
  `;
}

// ─── Error Page ───────────────────────────────────────────────────────────────

function renderErrorPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc}h1{color:#64748b;font-weight:500}</style></head><body><h1>Failed to load account journey</h1></body></html>`;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInitials(name: string): string {
  const parts = name.trim().split(/[\s@]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
