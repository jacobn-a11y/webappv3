import type { PrismaClient } from "@prisma/client";
import { decodeDataGovernancePolicy, encodeJsonValue } from "../types/json-boundaries.js";

export interface ApprovalSlackSettings {
  enabled: boolean;
  approverWebhookUrl: string | null;
  creatorWebhookUrl: string | null;
}

export class SlackApprovalNotifier {
  constructor(private prisma: PrismaClient) {}

  async getSettings(organizationId: string): Promise<ApprovalSlackSettings> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
    });
    const policy = decodeDataGovernancePolicy(settings?.dataGovernancePolicy);
    const raw = policy as Record<string, unknown>;
    return {
      enabled: raw.approval_slack_enabled === true,
      approverWebhookUrl:
        typeof raw.approval_slack_approver_webhook_url === "string"
          ? raw.approval_slack_approver_webhook_url
          : null,
      creatorWebhookUrl:
        typeof raw.approval_slack_creator_webhook_url === "string"
          ? raw.approval_slack_creator_webhook_url
          : null,
    };
  }

  async updateSettings(
    organizationId: string,
    input: {
      enabled: boolean;
      approverWebhookUrl: string | null;
      creatorWebhookUrl: string | null;
    }
  ): Promise<ApprovalSlackSettings> {
    if (input.approverWebhookUrl) {
      this.validateWebhookUrl(input.approverWebhookUrl);
    }
    if (input.creatorWebhookUrl) {
      this.validateWebhookUrl(input.creatorWebhookUrl);
    }

    const current = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
    });
    const policy = decodeDataGovernancePolicy(current?.dataGovernancePolicy);

    const next = {
      ...(policy as Record<string, unknown>),
      approval_slack_enabled: input.enabled,
      approval_slack_approver_webhook_url: input.approverWebhookUrl,
      approval_slack_creator_webhook_url: input.creatorWebhookUrl,
    };

    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        dataGovernancePolicy: encodeJsonValue(next),
      },
      update: {
        dataGovernancePolicy: encodeJsonValue(next),
      },
    });

    return {
      enabled: input.enabled,
      approverWebhookUrl: input.approverWebhookUrl,
      creatorWebhookUrl: input.creatorWebhookUrl,
    };
  }

  async notifyApprovalRequested(input: {
    organizationId: string;
    requestId: string;
    title: string;
    accountName?: string | null;
    requestedByLabel: string;
    reviewUrl: string;
    assetType: "story" | "landing_page";
  }): Promise<void> {
    const settings = await this.getSettings(input.organizationId);
    if (!settings.enabled || !settings.approverWebhookUrl) return;

    await this.postWebhook(settings.approverWebhookUrl, {
      text: `Publish approval requested: ${input.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*Publish approval requested*\n` +
              `*Asset:* ${input.assetType === "story" ? "Story" : "Landing Page"}\n` +
              `*Title:* ${input.title}\n` +
              `*Account:* ${input.accountName ?? "Unknown"}\n` +
              `*Requested by:* ${input.requestedByLabel}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Review Request" },
              url: input.reviewUrl,
            },
          ],
        },
      ],
    });
  }

  async notifyApprovalDecision(input: {
    organizationId: string;
    status: "APPROVED" | "REJECTED";
    title: string;
    reviewerLabel: string;
    creatorLabel: string;
    publishUrl: string;
  }): Promise<void> {
    const settings = await this.getSettings(input.organizationId);
    if (!settings.enabled || !settings.creatorWebhookUrl) return;

    const actionText =
      input.status === "APPROVED"
        ? `Your content was approved by ${input.reviewerLabel}.`
        : `Your content was rejected by ${input.reviewerLabel}.`;

    await this.postWebhook(settings.creatorWebhookUrl, {
      text: `Publish request ${input.status.toLowerCase()}: ${input.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*${input.status}*\n` +
              `*Title:* ${input.title}\n` +
              `*Creator:* ${input.creatorLabel}\n` +
              `${actionText}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: input.status === "APPROVED" ? "Open to Publish" : "Open Request",
              },
              url: input.publishUrl,
            },
          ],
        },
      ],
    });
  }

  private validateWebhookUrl(url: string): void {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Slack webhook must use https://");
    }
    const allowed = ["hooks.slack.com", "hooks.slack-gov.com"];
    if (!allowed.includes(parsed.hostname.toLowerCase())) {
      throw new Error("Slack webhook host is not allowed");
    }
  }

  private async postWebhook(url: string, payload: unknown): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slack webhook failed (${response.status}): ${body}`);
    }
  }
}
