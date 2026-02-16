/**
 * Landing Page Export Service
 *
 * Three export methods for landing pages:
 *   1. PDF — Renders the public page HTML via Puppeteer and returns a PDF buffer
 *   2. Google Doc — Creates a Google Doc via the Google Docs API
 *   3. Slack — Posts the story summary + top 3 callout boxes to a Slack channel
 */

import type { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";
import { google } from "googleapis";
import { renderLandingPageHtml } from "../api/public-page-renderer.js";
import type { CalloutBox } from "./landing-page-editor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExportablePage {
  title: string;
  subtitle: string | null;
  body: string;
  calloutBoxes: CalloutBox[];
  totalCallHours: number;
  heroImageUrl: string | null;
  customCss: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LandingPageExporter {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ─── PDF Export ──────────────────────────────────────────────────────

  /**
   * Renders a landing page as a branded PDF using Puppeteer.
   * Uses the same HTML renderer as the public page, so the PDF
   * matches the live page exactly.
   *
   * Requires PUPPETEER_EXECUTABLE_PATH to be set to a Chrome/Chromium binary.
   */
  async exportPdf(pageId: string): Promise<{ buffer: Buffer; filename: string }> {
    const page = await this.getExportablePage(pageId);
    const html = renderLandingPageHtml(page);

    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      "/usr/bin/chromium-browser";

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    try {
      const browserPage = await browser.newPage();
      await browserPage.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await browserPage.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;padding:0 0.5in;">
          <span>${page.title.replace(/"/g, "&quot;")}</span>
        </div>`,
        footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;padding:0 0.5in;">
          <span>Compiled by AI from ${page.totalCallHours} hours of call recordings</span>
          <span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      });

      const slug = await this.getPageSlug(pageId);
      const filename = `${slug}.pdf`;

      return { buffer: Buffer.from(pdfBuffer), filename };
    } finally {
      await browser.close();
    }
  }

  // ─── Google Doc Export ───────────────────────────────────────────────

  /**
   * Creates a Google Doc from the landing page content.
   * Uses the Google Docs API to build a structured document with
   * title, callout boxes, and the story body.
   *
   * Requires a valid OAuth2 access token with docs + drive scopes.
   */
  async exportGoogleDoc(
    pageId: string,
    accessToken: string
  ): Promise<{ documentId: string; documentUrl: string }> {
    const page = await this.getExportablePage(pageId);

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const docs = google.docs({ version: "v1", auth });
    const drive = google.drive({ version: "v3", auth });

    // 1. Create the document
    const createRes = await docs.documents.create({
      requestBody: { title: page.title },
    });
    const documentId = createRes.data.documentId!;

    // 2. Build the document content via batchUpdate
    const requests: object[] = [];
    let insertIndex = 1; // docs start at index 1

    // Helper: insert text and advance index
    const insertText = (text: string, bold = false, fontSize?: number, color?: string) => {
      const endIndex = insertIndex + text.length;
      requests.push({
        insertText: { location: { index: insertIndex }, text },
      });
      const style: Record<string, unknown> = {};
      if (bold) style.bold = true;
      if (fontSize) style.fontSize = { magnitude: fontSize, unit: "PT" };
      if (color) {
        const rgb = hexToRgb(color);
        style.foregroundColor = {
          color: { rgbColor: { red: rgb.r / 255, green: rgb.g / 255, blue: rgb.b / 255 } },
        };
      }
      if (Object.keys(style).length > 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: insertIndex, endIndex },
            textStyle: style,
            fields: Object.keys(style).join(","),
          },
        });
      }
      insertIndex = endIndex;
    };

    const insertNewline = () => insertText("\n");

    // Subtitle
    if (page.subtitle) {
      insertText(page.subtitle, false, 13, "#555770");
      insertNewline();
      insertNewline();
    }

    // AI badge text
    const hoursLabel = page.totalCallHours === 1 ? "hour" : "hours";
    insertText(
      `Compiled by AI from ${page.totalCallHours} ${hoursLabel} of real call recordings with a specific client`,
      false,
      9,
      "#888888"
    );
    insertNewline();
    insertNewline();

    // Callout boxes
    if (page.calloutBoxes.length > 0) {
      for (const box of page.calloutBoxes) {
        const iconLabel = (box.icon ?? "insight").toUpperCase();
        insertText(`[${iconLabel}] `, true, 10, calloutColor(box.icon));
        insertText(box.title, true, 11);
        insertNewline();
        insertText(box.body);
        insertNewline();
        insertNewline();
      }

      // Horizontal rule (simulated)
      insertText("─".repeat(50), false, 8, "#CCCCCC");
      insertNewline();
      insertNewline();
    }

    // Body — convert markdown to plain text sections
    const bodyLines = page.body.split("\n");
    for (const line of bodyLines) {
      const h1Match = line.match(/^# (.+)$/);
      const h2Match = line.match(/^## (.+)$/);
      const h3Match = line.match(/^### (.+)$/);
      const h4Match = line.match(/^#### (.+)$/);
      const blockquoteMatch = line.match(/^> (.+)$/);
      const listMatch = line.match(/^- (.+)$/);

      if (h1Match) {
        insertText(h1Match[1], true, 18);
        insertNewline();
      } else if (h2Match) {
        insertText(h2Match[1], true, 15, "#4f46e5");
        insertNewline();
      } else if (h3Match) {
        insertText(h3Match[1], true, 13);
        insertNewline();
      } else if (h4Match) {
        insertText(h4Match[1], true, 12);
        insertNewline();
      } else if (blockquoteMatch) {
        insertText(`"${blockquoteMatch[1]}"`, false, 11, "#4f46e5");
        insertNewline();
      } else if (listMatch) {
        insertText(`  \u2022 ${listMatch[1]}`);
        insertNewline();
      } else if (line.trim() === "---") {
        insertText("─".repeat(50), false, 8, "#CCCCCC");
        insertNewline();
      } else if (line.trim() === "") {
        insertNewline();
      } else {
        // Strip inline markdown formatting for plain text
        const cleaned = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
        insertText(cleaned);
        insertNewline();
      }
    }

    // 3. Apply the batchUpdate
    if (requests.length > 0) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });
    }

    // 4. Update the title style (heading)
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: { startIndex: 1, endIndex: 2 },
              paragraphStyle: { namedStyleType: "TITLE" },
              fields: "namedStyleType",
            },
          },
        ],
      },
    });

    // 5. Optionally move to a specific folder if configured
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (folderId) {
      const file = await drive.files.get({
        fileId: documentId,
        fields: "parents",
      });
      const previousParents = (file.data.parents ?? []).join(",");
      await drive.files.update({
        fileId: documentId,
        addParents: folderId,
        removeParents: previousParents,
        fields: "id, parents",
      });
    }

    return {
      documentId,
      documentUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    };
  }

  // ─── Slack Export ────────────────────────────────────────────────────

  /**
   * Posts the story summary and top 3 callout boxes to a Slack channel
   * via an incoming webhook URL.
   *
   * The webhook URL can be passed per-request or configured via
   * SLACK_WEBHOOK_URL environment variable.
   */
  async exportSlack(
    pageId: string,
    webhookUrl?: string
  ): Promise<{ ok: boolean }> {
    const url = webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      throw new Error(
        "No Slack webhook URL provided. Pass webhook_url in the request body or set SLACK_WEBHOOK_URL."
      );
    }

    const page = await this.getExportablePage(pageId);
    const publicUrl = await this.getPagePublicUrl(pageId);

    // Build Slack Block Kit message
    const blocks: object[] = [];

    // Header
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: page.title, emoji: true },
    });

    // Subtitle + AI badge
    if (page.subtitle) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `_${page.subtitle}_` },
      });
    }

    const hoursLabel = page.totalCallHours === 1 ? "hour" : "hours";
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:robot_face: Compiled by AI from *${page.totalCallHours} ${hoursLabel}* of real call recordings`,
        },
      ],
    });

    blocks.push({ type: "divider" });

    // Top 3 callout boxes
    const topCallouts = page.calloutBoxes.slice(0, 3);
    for (const box of topCallouts) {
      const emoji = calloutEmoji(box.icon);
      // Strip markdown bold markers for Slack display
      const bodyText = box.body
        .replace(/\*\*(.+?)\*\*/g, "*$1*"); // convert markdown bold to Slack bold
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${box.title}*\n${bodyText}`,
        },
      });
    }

    blocks.push({ type: "divider" });

    // Story summary (first ~500 chars of body, stripped of markdown)
    const summaryText = page.body
      .replace(/^#{1,4} .+$/gm, "") // remove headers
      .replace(/\*\*(.+?)\*\*/g, "$1") // remove bold
      .replace(/\*(.+?)\*/g, "$1") // remove italic
      .replace(/^- /gm, "\u2022 ") // bullet points
      .replace(/^> /gm, "") // remove blockquotes
      .replace(/---/g, "") // remove hrs
      .replace(/\n{3,}/g, "\n\n") // collapse extra newlines
      .trim()
      .slice(0, 500);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: summaryText + (page.body.length > 500 ? "..." : ""),
      },
    });

    // Link to full page
    if (publicUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Full Story", emoji: true },
            url: publicUrl,
            style: "primary",
          },
        ],
      });
    }

    // Send to Slack
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slack webhook failed (${response.status}): ${body}`);
    }

    return { ok: true };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  /**
   * Loads a landing page with all data needed for export.
   * Uses the scrubbed content if published, editable content otherwise.
   */
  private async getExportablePage(pageId: string): Promise<ExportablePage> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    return {
      title: page.title,
      subtitle: page.subtitle,
      body: page.scrubbedBody || page.editableBody,
      calloutBoxes: (page.calloutBoxes as unknown as CalloutBox[]) ?? [],
      totalCallHours: page.totalCallHours,
      heroImageUrl: page.heroImageUrl,
      customCss: page.customCss,
    };
  }

  private async getPageSlug(pageId: string): Promise<string> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      select: { slug: true },
    });
    return page.slug;
  }

  private async getPagePublicUrl(pageId: string): Promise<string | null> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      select: { slug: true, status: true, visibility: true },
    });

    if (page.status !== "PUBLISHED" || page.visibility !== "SHARED_WITH_LINK") {
      return null;
    }

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    return `${baseUrl}/s/${page.slug}`;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/** Maps callout box icon types to brand colors (matching the CSS variables). */
function calloutColor(icon?: string): string {
  const colors: Record<string, string> = {
    metric: "#059669",
    quote: "#7c3aed",
    insight: "#2563eb",
    timeline: "#d97706",
    warning: "#dc2626",
    success: "#059669",
  };
  return colors[icon ?? "insight"] ?? "#2563eb";
}

/** Maps callout box icon types to Slack emoji. */
function calloutEmoji(icon?: string): string {
  const emojis: Record<string, string> = {
    metric: ":chart_with_upwards_trend:",
    quote: ":speech_balloon:",
    insight: ":bulb:",
    timeline: ":clock3:",
    warning: ":warning:",
    success: ":white_check_mark:",
  };
  return emojis[icon ?? "insight"] ?? ":bulb:";
}
