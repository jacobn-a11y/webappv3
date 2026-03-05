/**
 * Merge.dev API Client Service
 *
 * Handles the full lifecycle of Merge.dev integrations:
 *   1. OAuth Token Management — exchange public tokens from Merge Link for
 *      permanent account tokens, store per-org linked accounts.
 *   2. Historical Recording Fetch — on initial connection, backfill all
 *      existing recordings from the linked provider (Gong, Chorus, Zoom, etc.).
 *   3. CRM Polling Sync — every 15 minutes, pull contacts, accounts, and
 *      opportunities as a fallback for webhooks. Contacts always include the
 *      title field from the underlying Salesforce/HubSpot record.
 *
 * Merge.dev auth model:
 *   - All requests use `Authorization: Bearer <MERGE_API_KEY>`
 *   - Per-linked-account requests add `X-Account-Token: <account_token>`
 *   - Account tokens are permanent (obtained via public_token exchange)
 */

import type { PrismaClient, CallProvider, LinkedAccount } from "@prisma/client";
import type { Queue } from "bullmq";
import {
  EntityResolver,
  normalizeCompanyName,
  extractEmailDomain,
} from "./entity-resolution.js";
import { enqueueProcessCallJob } from "../lib/queue-policy.js";
import logger from "../lib/logger.js";
import { MergeHttpClient } from "./merge-api-http.js";
import {
  integrationSlugToProvider,
  type MergeAccountTokenResponse,
  type MergeLinkedAccountInfo,
  type MergeRecording,
  type MergeCRMContact,
  type MergeCRMAccount,
  type MergeCRMOpportunity,
} from "./merge-api-types.js";

// ─── Core Service ───────────────────────────────────────────────────────────

export class MergeApiClient {
  private prisma: PrismaClient;
  private processingQueue: Queue;
  private resolver: EntityResolver;
  private apiKey: string;
  private http: MergeHttpClient;

  constructor(deps: {
    prisma: PrismaClient;
    processingQueue: Queue;
    mergeApiKey: string;
  }) {
    this.prisma = deps.prisma;
    this.processingQueue = deps.processingQueue;
    this.resolver = new EntityResolver(deps.prisma);
    this.apiKey = deps.mergeApiKey;
    this.http = new MergeHttpClient(deps.mergeApiKey);
  }

  // ─── OAuth Token Management ─────────────────────────────────────────

  /**
   * Exchange a public_token (from Merge Link frontend component) for a
   * permanent account_token. Stores the linked account in the database
   * and triggers the initial historical data fetch.
   */
  async exchangeLinkToken(
    organizationId: string,
    publicToken: string
  ): Promise<LinkedAccount> {
    // Exchange public_token for account_token via Merge API
    const tokenResponse = await this.http.post<MergeAccountTokenResponse>(
      "/account-token",
      { public_token: publicToken }
    );

    const { account_token, integration } = tokenResponse;

    // Determine the category from the integration metadata
    const category = this.resolveCategory(integration.categories);

    // Fetch the linked account details to get the Merge-side ID
    const linkedAccountInfo = await this.fetchLinkedAccountInfo(account_token);

    // Persist the linked account
    const linkedAccount = await this.prisma.linkedAccount.upsert({
      where: { mergeLinkedAccountId: linkedAccountInfo.id },
      create: {
        organizationId,
        mergeLinkedAccountId: linkedAccountInfo.id,
        accountToken: account_token,
        integrationSlug: integration.slug,
        category,
        status: "ACTIVE",
      },
      update: {
        accountToken: account_token,
        status: "ACTIVE",
      },
    });

    // Fire-and-forget: kick off historical data fetch for this new connection
    this.runInitialSync(linkedAccount).catch((err) => {
      logger.error(
        `Initial sync failed for linked account ${linkedAccount.id}`,
        { error: err }
      );
    });

    return linkedAccount;
  }

  /**
   * Retrieve details about a linked account from Merge to get its canonical ID.
   */
  private async fetchLinkedAccountInfo(
    accountToken: string
  ): Promise<MergeLinkedAccountInfo> {
    const resp = await this.http.get<{
      results: MergeLinkedAccountInfo[];
    }>("/linked-accounts", {}, accountToken);
    // The token is scoped to one linked account, so there's exactly one result
    if (!resp.results.length) {
      throw new Error("No linked account found for the provided account token");
    }
    return resp.results[0];
  }

  /**
   * Map Merge integration categories to our internal enum.
   */
  private resolveCategory(categories: string[]): "CRM" | "RECORDING" {
    const lowerCats = categories.map((c) => c.toLowerCase());
    if (lowerCats.includes("crm")) return "CRM";
    // File storage, HRIS, ATS, etc. are not relevant — treat recording-related
    // categories (or anything else) as RECORDING for our purposes
    return "RECORDING";
  }

  // ─── Historical Fetch (Initial Connection) ──────────────────────────

  /**
   * On initial connection, backfill all historical recordings from the
   * linked provider. For CRM connections, run a full contact/account/
   * opportunity sync immediately.
   */
  async runInitialSync(linkedAccount: LinkedAccount): Promise<void> {
    if (linkedAccount.initialSyncDone) return;

    try {
      if (linkedAccount.category === "RECORDING") {
        await this.fetchHistoricalRecordings(linkedAccount);
      } else if (linkedAccount.category === "CRM") {
        await this.syncCRMAccounts(linkedAccount);
        await this.syncCRMContacts(linkedAccount);
        await this.syncCRMOpportunities(linkedAccount);
      }

      await this.prisma.linkedAccount.update({
        where: { id: linkedAccount.id },
        data: { initialSyncDone: true, lastSyncedAt: new Date() },
      });
    } catch (err) {
      await this.prisma.linkedAccount.update({
        where: { id: linkedAccount.id },
        data: { status: "ERROR" },
      });
      throw err;
    }
  }

  /**
   * Paginate through all recordings for a linked account and ingest them.
   */
  private async fetchHistoricalRecordings(
    linkedAccount: LinkedAccount
  ): Promise<void> {
    const provider = integrationSlugToProvider(linkedAccount.integrationSlug);
    await this.http.paginate<MergeRecording>(
      "/filestorage/v1/recordings",
      linkedAccount.accountToken,
      undefined,
      async (recording) => {
        await this.ingestRecording(linkedAccount.organizationId, recording, provider);
      }
    );
  }

  /**
   * Upsert a single recording into the Call table, store participants and
   * transcript, then queue for async processing.
   */
  private async ingestRecording(
    organizationId: string,
    recording: MergeRecording,
    provider: CallProvider
  ): Promise<void> {
    const call = await this.prisma.call.upsert({
      where: { mergeRecordingId: recording.id },
      create: {
        organizationId,
        title: recording.name ?? null,
        provider,
        mergeRecordingId: recording.id,
        externalId: recording.remote_id ?? null,
        recordingUrl: recording.recording_url ?? null,
        duration: recording.duration ?? null,
        occurredAt: recording.start_time
          ? new Date(recording.start_time)
          : new Date(),
      },
      update: {
        title: recording.name ?? undefined,
        recordingUrl: recording.recording_url ?? undefined,
        duration: recording.duration ?? undefined,
      },
    });

    // Store participants
    const participants = recording.participants ?? [];
    for (const p of participants) {
      await this.prisma.callParticipant.create({
        data: {
          callId: call.id,
          email: p.email?.toLowerCase() ?? null,
          name: p.name ?? null,
          isHost: p.is_organizer ?? false,
        },
      });
    }

    // Entity resolution
    const participantInputs = participants.map((p) => ({
      email: p.email ?? undefined,
      name: p.name ?? undefined,
    }));

    const resolution = await this.resolver.resolveAndLinkContacts(
      organizationId,
      call.id,
      participantInputs
    );

    // Store transcript if present
    if (recording.transcript) {
      await this.prisma.transcript.upsert({
        where: { callId: call.id },
        create: {
          callId: call.id,
          fullText: recording.transcript,
          wordCount: recording.transcript.split(/\s+/).length,
        },
        update: {
          fullText: recording.transcript,
          wordCount: recording.transcript.split(/\s+/).length,
        },
      });
    }

    // Queue for async processing
    await enqueueProcessCallJob({
      queue: this.processingQueue,
      source: "merge-api-client",
      payload: {
        callId: call.id,
        organizationId,
        accountId: resolution.accountId || null,
        hasTranscript: !!recording.transcript,
      },
    });
  }

  // ─── CRM Polling Sync ───────────────────────────────────────────────

  /**
   * Run a single polling cycle across all active CRM linked accounts.
   * Scheduled via BullMQ integration-sync job (replaces legacy setInterval).
   */
  async pollAllLinkedAccounts(): Promise<void> {
    if (!this.apiKey?.trim()) return;
    const activeAccounts = await this.prisma.linkedAccount.findMany({
      where: { status: "ACTIVE", category: "CRM" },
    });

    for (const linked of activeAccounts) {
      try {
        await this.syncCRMAccounts(linked);
        await this.syncCRMContacts(linked);
        await this.syncCRMOpportunities(linked);

        await this.prisma.linkedAccount.update({
          where: { id: linked.id },
          data: { lastSyncedAt: new Date() },
        });
      } catch (err) {
        logger.error(
          `CRM sync failed for linked account ${linked.id} (${linked.integrationSlug})`,
          { error: err }
        );
        // Don't mark as ERROR for transient failures — only initial sync does that
      }
    }
  }

  // ─── CRM Account Sync ──────────────────────────────────────────────

  /**
   * Pull all CRM accounts and upsert them into our Account table.
   */
  private async syncCRMAccounts(linkedAccount: LinkedAccount): Promise<void> {
    const modifiedAfter = linkedAccount.lastSyncedAt?.toISOString();

    await this.http.paginate<MergeCRMAccount>(
      "/crm/v1/accounts",
      linkedAccount.accountToken,
      modifiedAfter,
      async (mergeAccount) => {
        if (!mergeAccount.name) return;

        const domain = mergeAccount.domain ?? mergeAccount.website
          ? this.extractDomainFromUrl(mergeAccount.domain ?? mergeAccount.website ?? "")
          : null;

        const normalizedName = normalizeCompanyName(mergeAccount.name);

        // Try to find existing account by mergeAccountId first, then by domain
        const existing = await this.prisma.account.findFirst({
          where: {
            organizationId: linkedAccount.organizationId,
            OR: [
              { mergeAccountId: mergeAccount.id },
              ...(domain ? [{ domain }] : []),
            ],
          },
        });

        if (existing) {
          await this.prisma.account.update({
            where: { id: existing.id },
            data: {
              name: mergeAccount.name,
              normalizedName,
              mergeAccountId: mergeAccount.id,
              domain: domain ?? existing.domain,
              industry: mergeAccount.industry ?? existing.industry,
              employeeCount:
                mergeAccount.number_of_employees ?? existing.employeeCount,
            },
          });
        } else {
          await this.prisma.account.create({
            data: {
              organizationId: linkedAccount.organizationId,
              name: mergeAccount.name,
              normalizedName,
              mergeAccountId: mergeAccount.id,
              domain,
              industry: mergeAccount.industry ?? null,
              employeeCount: mergeAccount.number_of_employees ?? null,
            },
          });
        }
      }
    );
  }

  // ─── CRM Contact Sync ──────────────────────────────────────────────

  /**
   * Pull all CRM contacts and upsert them. Always fetches the title field
   * from the underlying Salesforce/HubSpot record so it can be stored on
   * the Contact model.
   *
   * Merge.dev's unified Contact model includes `title` as a first-class
   * field — it maps to Salesforce's Contact.Title and HubSpot's
   * contact.jobtitle automatically.
   */
  private async syncCRMContacts(linkedAccount: LinkedAccount): Promise<void> {
    const modifiedAfter = linkedAccount.lastSyncedAt?.toISOString();

    await this.http.paginate<MergeCRMContact>(
      "/crm/v1/contacts",
      linkedAccount.accountToken,
      modifiedAfter,
      async (mergeContact) => {
        const primaryEmail =
          mergeContact.email_addresses?.[0]?.email_address;
        if (!primaryEmail) return;

        const emailLower = primaryEmail.toLowerCase();
        const domain = extractEmailDomain(emailLower);
        if (!domain) return;

        const fullName = [mergeContact.first_name, mergeContact.last_name]
          .filter(Boolean)
          .join(" ") || null;

        // Resolve the title from Merge's unified model. Merge maps:
        //   Salesforce Contact.Title → mergeContact.title
        //   HubSpot contact.jobtitle → mergeContact.title
        // If the unified field is empty, fall back to remote_data if available.
        const title =
          mergeContact.title ?? this.extractTitleFromRemoteData(mergeContact);

        const phone =
          mergeContact.phone_numbers?.[0]?.phone_number ?? null;

        // Find the CRM account this contact belongs to
        const account = await this.findAccountForContact(
          linkedAccount.organizationId,
          mergeContact.account,
          domain
        );

        if (!account) {
          // No matching account — skip (webhook or next account sync will create it)
          return;
        }

        // Determine provider-specific IDs
        const salesforceId = linkedAccount.integrationSlug === "salesforce"
          ? mergeContact.remote_id
          : undefined;
        const hubspotId = linkedAccount.integrationSlug === "hubspot"
          ? mergeContact.remote_id
          : undefined;

        await this.prisma.contact.upsert({
          where: {
            accountId_email: { accountId: account.id, email: emailLower },
          },
          create: {
            accountId: account.id,
            email: emailLower,
            emailDomain: domain,
            name: fullName,
            title,
            phone,
            mergeContactId: mergeContact.id,
            salesforceId: salesforceId ?? null,
            hubspotId: hubspotId ?? null,
          },
          update: {
            name: fullName ?? undefined,
            title: title ?? undefined,
            phone: phone ?? undefined,
            mergeContactId: mergeContact.id,
            ...(salesforceId ? { salesforceId } : {}),
            ...(hubspotId ? { hubspotId } : {}),
          },
        });
      }
    );
  }

  /**
   * Extract the job title from Merge's remote_data array when the unified
   * `title` field is null. Handles both Salesforce and HubSpot payloads.
   */
  private extractTitleFromRemoteData(
    contact: MergeCRMContact
  ): string | null {
    if (!contact.remote_data?.length) return null;

    for (const entry of contact.remote_data) {
      const data = entry.data;
      // Salesforce: field is "Title"
      if (typeof data.Title === "string" && data.Title) {
        return data.Title;
      }
      // HubSpot: field is "jobtitle"
      if (typeof data.jobtitle === "string" && data.jobtitle) {
        return data.jobtitle;
      }
      // HubSpot alternate: nested under properties
      const props = data.properties as Record<string, unknown> | undefined;
      if (props && typeof props.jobtitle === "string" && props.jobtitle) {
        return props.jobtitle;
      }
    }

    return null;
  }

  /**
   * Find the local Account for a contact using the Merge account reference
   * or email domain.
   */
  private async findAccountForContact(
    organizationId: string,
    mergeAccountRef: string | null,
    emailDomain: string
  ) {
    // Try by Merge account ID first
    if (mergeAccountRef) {
      const byMergeId = await this.prisma.account.findFirst({
        where: { organizationId, mergeAccountId: mergeAccountRef },
      });
      if (byMergeId) return byMergeId;
    }

    // Fall back to email domain
    return this.prisma.account.findFirst({
      where: { organizationId, domain: emailDomain },
    });
  }

  // ─── CRM Opportunity Sync ──────────────────────────────────────────

  /**
   * Pull all CRM opportunities and log them as SalesforceEvents.
   */
  private async syncCRMOpportunities(
    linkedAccount: LinkedAccount
  ): Promise<void> {
    const modifiedAfter = linkedAccount.lastSyncedAt?.toISOString();

    await this.http.paginate<MergeCRMOpportunity>(
      "/crm/v1/opportunities",
      linkedAccount.accountToken,
      modifiedAfter,
      async (opp) => {
        if (!opp.account) return;

        // Resolve the local account
        const account = await this.prisma.account.findFirst({
          where: {
            organizationId: linkedAccount.organizationId,
            mergeAccountId: opp.account,
          },
        });

        if (!account) return;

        // Determine event type
        let eventType:
          | "CLOSED_WON"
          | "CLOSED_LOST"
          | "OPPORTUNITY_STAGE_CHANGE"
          | "OPPORTUNITY_CREATED";

        if (
          opp.status === "WON" ||
          opp.stage?.toLowerCase().includes("closed won")
        ) {
          eventType = "CLOSED_WON";
        } else if (
          opp.status === "LOST" ||
          opp.stage?.toLowerCase().includes("closed lost")
        ) {
          eventType = "CLOSED_LOST";
        } else {
          eventType = "OPPORTUNITY_STAGE_CHANGE";
        }

        // Upsert to avoid dedup race; unique on (accountId, opportunityId, stageName)
        if (!opp.remote_id) return;
        const stageName = opp.stage ?? "";
        const eventData = {
          accountId: account.id,
          eventType,
          stageName,
          opportunityId: opp.remote_id,
          amount: opp.amount ?? null,
          closeDate: opp.close_date ? new Date(opp.close_date) : null,
          description: opp.name ?? null,
        };
        await this.prisma.salesforceEvent.upsert({
          where: {
            salesforce_event_account_opp_stage: {
              accountId: account.id,
              opportunityId: opp.remote_id,
              stageName: stageName,
            },
          },
          create: eventData,
          update: {
            eventType: eventData.eventType,
            amount: eventData.amount,
            closeDate: eventData.closeDate,
            description: eventData.description,
          },
        });
      }
    );
  }

  /**
   * Extract a clean domain from a URL or domain string.
   */
  private extractDomainFromUrl(input: string): string | null {
    if (!input) return null;
    try {
      // If it looks like a bare domain (no protocol), prepend https://
      const urlStr = input.includes("://") ? input : `https://${input}`;
      const url = new URL(urlStr);
      return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return input.toLowerCase().replace(/^www\./, "").trim() || null;
    }
  }
}
