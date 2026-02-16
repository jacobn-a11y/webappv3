/**
 * Email Service
 *
 * Sends transactional emails via Resend. Used by the weekly story
 * regeneration job to notify org admins about updated account stories.
 */

import { Resend } from "resend";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountChange {
  accountName: string;
  accountId: string;
  newCallCount: number;
  diffSummary: string;
  /** Sections that were added in the new version */
  sectionsAdded: string[];
  /** Sections that were removed */
  sectionsRemoved: string[];
  /** Sections that were modified */
  sectionsModified: string[];
  /** True if this is the first FULL_JOURNEY story for the account */
  isFirstStory: boolean;
}

export interface DigestEmailOptions {
  to: string[];
  orgName: string;
  accountChanges: AccountChange[];
  runDate: Date;
}

// ─── Email Service ───────────────────────────────────────────────────────────

export class EmailService {
  private resend: Resend;
  private fromAddress: string;
  private appUrl: string;

  constructor(apiKey: string, fromAddress: string, appUrl: string) {
    this.resend = new Resend(apiKey);
    this.fromAddress = fromAddress;
    this.appUrl = appUrl;
  }

  /**
   * Sends the weekly story regeneration digest to org admins.
   */
  async sendWeeklyDigest(options: DigestEmailOptions): Promise<void> {
    const { to, orgName, accountChanges, runDate } = options;

    if (to.length === 0 || accountChanges.length === 0) return;

    const dateStr = runDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const subject = `StoryEngine Weekly Digest: ${accountChanges.length} account${accountChanges.length === 1 ? "" : "s"} updated — ${dateStr}`;

    const html = this.buildDigestHtml(orgName, accountChanges, dateStr);

    await this.resend.emails.send({
      from: this.fromAddress,
      to,
      subject,
      html,
    });
  }

  // ─── HTML Template ───────────────────────────────────────────────

  private buildDigestHtml(
    orgName: string,
    changes: AccountChange[],
    dateStr: string
  ): string {
    const accountRows = changes
      .map((c) => this.buildAccountRow(c))
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
    .container { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #1a1a2e; color: #fff; padding: 24px 32px; }
    .header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
    .header p { margin: 0; opacity: 0.8; font-size: 14px; }
    .body { padding: 24px 32px; }
    .summary { background: #f0f4ff; border-radius: 6px; padding: 16px; margin-bottom: 24px; font-size: 14px; }
    .summary strong { color: #1a1a2e; }
    .account-card { border: 1px solid #e5e5e5; border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
    .account-header { background: #fafafa; padding: 12px 16px; border-bottom: 1px solid #e5e5e5; display: flex; justify-content: space-between; align-items: center; }
    .account-name { font-weight: 600; font-size: 15px; color: #1a1a2e; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-new { background: #dcfce7; color: #15803d; }
    .account-body { padding: 12px 16px; font-size: 13px; line-height: 1.6; }
    .change-list { margin: 4px 0 0; padding-left: 18px; }
    .change-list li { margin-bottom: 4px; }
    .label { font-weight: 500; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .diff-summary { color: #555; margin-bottom: 8px; }
    .section-tag { display: inline-block; background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-size: 12px; margin: 2px; color: #555; }
    .section-tag.added { background: #dcfce7; color: #15803d; }
    .section-tag.removed { background: #fee2e2; color: #dc2626; }
    .section-tag.modified { background: #fef3c7; color: #d97706; }
    .footer { padding: 16px 32px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 12px; color: #999; }
    .footer a { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Weekly Story Digest</h1>
      <p>${orgName} &mdash; ${dateStr}</p>
    </div>
    <div class="body">
      <div class="summary">
        <strong>${changes.length} account${changes.length === 1 ? "" : "s"}</strong>
        ${changes.length === 1 ? "has" : "have"} updated stories based on
        <strong>${changes.reduce((sum, c) => sum + c.newCallCount, 0)} new call${changes.reduce((sum, c) => sum + c.newCallCount, 0) === 1 ? "" : "s"}</strong>
        processed this cycle.
      </div>
      ${accountRows}
    </div>
    <div class="footer">
      <p>Sent by <a href="${this.appUrl}">StoryEngine</a>. You received this because you are an admin of ${orgName}.</p>
    </div>
  </div>
</body>
</html>`;
  }

  private buildAccountRow(change: AccountChange): string {
    const badge = change.isFirstStory
      ? `<span class="badge badge-new">New Story</span>`
      : `<span class="badge">${change.newCallCount} new call${change.newCallCount === 1 ? "" : "s"}</span>`;

    const sectionTags = [
      ...change.sectionsAdded.map(
        (s) => `<span class="section-tag added">+ ${s}</span>`
      ),
      ...change.sectionsModified.map(
        (s) => `<span class="section-tag modified">~ ${s}</span>`
      ),
      ...change.sectionsRemoved.map(
        (s) => `<span class="section-tag removed">- ${s}</span>`
      ),
    ].join(" ");

    return `
    <div class="account-card">
      <div class="account-header">
        <span class="account-name">${this.escapeHtml(change.accountName)}</span>
        ${badge}
      </div>
      <div class="account-body">
        <div class="diff-summary">${this.escapeHtml(change.diffSummary)}</div>
        ${sectionTags ? `<div class="label">Sections changed</div><div>${sectionTags}</div>` : ""}
      </div>
    </div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
