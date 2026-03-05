import { Prisma, type IntegrationConfig, type PrismaClient } from "@prisma/client";
import { extractEmailDomain, normalizeCompanyName } from "../services/entity-resolution.js";
import type {
  CRMDataProvider,
  NormalizedAccount,
  NormalizedContact,
  NormalizedOpportunity,
  ProviderCredentials,
} from "./types.js";
import type { SalesforceProvider } from "./salesforce-provider.js";

interface MergeConflictInput {
  organizationId: string;
  targetType: string;
  targetId: string;
  requestPayload: Record<string, unknown>;
}

interface SyncEngineCRMDeps {
  prisma: PrismaClient;
  withRetry<T>(
    fn: () => Promise<T>,
    opts?: { attempts?: number; baseDelayMs?: number }
  ): Promise<T>;
  queueMergeConflictReview(input: MergeConflictInput): Promise<void>;
}

export async function syncCRMProvider(
  deps: SyncEngineCRMDeps,
  config: IntegrationConfig,
  provider: CRMDataProvider,
  credentials: ProviderCredentials
): Promise<number> {
  // Wire up token persistence for providers that support refresh
  if (
    "setTokenRefreshCallback" in provider &&
    typeof (provider as SalesforceProvider).setTokenRefreshCallback === "function"
  ) {
    (provider as SalesforceProvider).setTokenRefreshCallback(async (newAccessToken) => {
      const existing = await deps.prisma.integrationConfig.findUnique({
        where: { id: config.id },
      });
      if (existing) {
        const creds = existing.credentials as Record<string, unknown>;
        creds.accessToken = newAccessToken;
        await deps.prisma.integrationConfig.update({
          where: { id: config.id },
          data: { credentials: creds as Prisma.InputJsonValue },
        });
      }
    });
  }

  // Accounts must sync first (contacts and opportunities reference them)
  const accountCount = await syncAccounts(deps, config, provider, credentials);
  const [contactCount, opportunityCount] = await Promise.all([
    syncContacts(deps, config, provider, credentials),
    syncOpportunities(deps, config, provider, credentials),
  ]);

  // Mark sync complete
  await deps.prisma.integrationConfig.update({
    where: { id: config.id },
    data: {
      lastSyncAt: new Date(),
      syncCursor: null,
      status: "ACTIVE",
      lastError: null,
    },
  });
  return accountCount + contactCount + opportunityCount;
}

async function syncAccounts(
  deps: SyncEngineCRMDeps,
  config: IntegrationConfig,
  provider: CRMDataProvider,
  credentials: ProviderCredentials
): Promise<number> {
  let cursor: string | null = null;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const result = await deps.withRetry(
      () => provider.fetchAccounts(credentials, cursor, config.lastSyncAt),
      { attempts: 4, baseDelayMs: 1000 }
    );

    const batchSize = 50;
    for (let i = 0; i < result.data.length; i += batchSize) {
      const batch = result.data.slice(i, i + batchSize);
      await persistAccountBatch(deps, config.organizationId, batch);
      total += batch.length;
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore && !!cursor;
  }
  return total;
}

async function persistAccountBatch(
  deps: SyncEngineCRMDeps,
  organizationId: string,
  accounts: NormalizedAccount[]
): Promise<void> {
  const externalIds = accounts.map((account) => account.externalId);

  // Batch lookup: find all existing accounts by externalId in one query
  const existingAccounts = await deps.prisma.account.findMany({
    where: { organizationId, salesforceId: { in: externalIds } },
  });
  const existingByExternalId = new Map(existingAccounts.map((account) => [account.salesforceId, account]));

  const toUpdate: { account: NormalizedAccount; existingId: string }[] = [];
  const toCreate: NormalizedAccount[] = [];
  const toConflictCheck: NormalizedAccount[] = [];

  for (const account of accounts) {
    const existing = existingByExternalId.get(account.externalId);
    if (existing) {
      toUpdate.push({ account, existingId: existing.id });
    } else {
      toConflictCheck.push(account);
    }
  }

  // For new accounts, check for conflicts individually (requires per-record logic)
  for (const account of toConflictCheck) {
    const normalized = normalizeCompanyName(account.name);
    const potentialConflict = await deps.prisma.account.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedName: normalized },
          ...(account.domain ? [{ domain: account.domain }] : []),
        ],
        salesforceId: { not: account.externalId },
      },
    });

    if (potentialConflict) {
      await deps.queueMergeConflictReview({
        organizationId,
        targetType: "account",
        targetId: potentialConflict.id,
        requestPayload: {
          conflict_type: "ACCOUNT_EXTERNAL_ID_COLLISION",
          existing_account_id: potentialConflict.id,
          existing_salesforce_id: potentialConflict.salesforceId,
          incoming_external_id: account.externalId,
          incoming_name: account.name,
          incoming_domain: account.domain,
        },
      });
    } else {
      toCreate.push(account);
    }
  }

  await deps.prisma.$transaction(async (tx) => {
    // Batch update existing accounts
    await Promise.all(
      toUpdate.map(({ account, existingId }) => {
        const normalized = normalizeCompanyName(account.name);
        return tx.account.update({
          where: { id: existingId },
          data: {
            name: account.name,
            normalizedName: normalized,
            domain: account.domain ?? undefined,
            industry: account.industry ?? undefined,
            employeeCount: account.employeeCount ?? undefined,
            annualRevenue: account.annualRevenue ?? undefined,
          },
        });
      })
    );

    // Batch create new accounts using createMany with skipDuplicates
    if (toCreate.length > 0) {
      await tx.account.createMany({
        data: toCreate.map((account) => ({
          organizationId,
          name: account.name,
          normalizedName: normalizeCompanyName(account.name),
          domain: account.domain,
          salesforceId: account.externalId,
          industry: account.industry,
          employeeCount: account.employeeCount,
          annualRevenue: account.annualRevenue,
        })),
        skipDuplicates: true,
      });
    }
  });
}

async function syncContacts(
  deps: SyncEngineCRMDeps,
  config: IntegrationConfig,
  provider: CRMDataProvider,
  credentials: ProviderCredentials
): Promise<number> {
  let cursor: string | null = null;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const result = await deps.withRetry(
      () => provider.fetchContacts(credentials, cursor, config.lastSyncAt),
      { attempts: 4, baseDelayMs: 1000 }
    );

    const batchSize = 50;
    for (let i = 0; i < result.data.length; i += batchSize) {
      const batch = result.data.slice(i, i + batchSize);
      await persistContactBatch(deps, config.organizationId, batch);
      total += batch.length;
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore && !!cursor;
  }
  return total;
}

async function persistContactBatch(
  deps: SyncEngineCRMDeps,
  organizationId: string,
  contacts: NormalizedContact[]
): Promise<void> {
  // Filter to contacts with valid emails and domains
  const validContacts = contacts
    .filter((contact) => contact.email)
    .map((contact) => ({ contact, domain: extractEmailDomain(contact.email!) }))
    .filter((row): row is { contact: NormalizedContact; domain: string } => !!row.domain);

  if (validContacts.length === 0) return;

  // Batch resolve accounts: collect all external IDs and domains for lookup
  const accountExternalIds = validContacts
    .map((row) => row.contact.accountExternalId)
    .filter((id): id is string => !!id);
  const contactDomains = [...new Set(validContacts.map((row) => row.domain))];

  const [accountsByExternalId, accountsByDomain] = await Promise.all([
    accountExternalIds.length > 0
      ? deps.prisma.account.findMany({
          where: { organizationId, salesforceId: { in: accountExternalIds } },
        })
      : Promise.resolve([]),
    deps.prisma.account.findMany({
      where: { organizationId, domain: { in: contactDomains } },
    }),
  ]);

  const externalIdMap = new Map(accountsByExternalId.map((account) => [account.salesforceId, account]));
  const domainMap = new Map(accountsByDomain.map((account) => [account.domain, account]));

  // Batch collision detection: find all existing contacts by email across org
  const allEmails = validContacts.map((row) => row.contact.email!.toLowerCase());
  const existingContacts = await deps.prisma.contact.findMany({
    where: {
      email: { in: allEmails },
      account: { organizationId },
    },
    select: { id: true, email: true, accountId: true, salesforceId: true },
  });
  const existingContactByEmail = new Map(existingContacts.map((contact) => [contact.email, contact]));

  const toCreate: Array<{
    accountId: string;
    email: string;
    emailDomain: string;
    name: string | null;
    title: string | null;
    phone: string | null;
    salesforceId: string | null;
  }> = [];

  const toUpsert: Array<{
    accountId: string;
    email: string;
    emailDomain: string;
    name: string | null;
    title: string | null;
    phone: string | null;
    externalId: string | null;
  }> = [];

  for (const { contact, domain } of validContacts) {
    // Resolve account
    let account = contact.accountExternalId
      ? externalIdMap.get(contact.accountExternalId) ?? null
      : null;
    if (!account) {
      account = domainMap.get(domain) ?? null;
    }
    if (!account) continue;

    const email = contact.email!.toLowerCase();
    const existingElsewhere = existingContactByEmail.get(email);

    // Check for cross-account collision
    if (existingElsewhere && existingElsewhere.accountId !== account.id) {
      await deps.queueMergeConflictReview({
        organizationId,
        targetType: "contact",
        targetId: existingElsewhere.id,
        requestPayload: {
          conflict_type: "CONTACT_EMAIL_COLLISION",
          existing_contact_id: existingElsewhere.id,
          existing_account_id: existingElsewhere.accountId,
          incoming_account_id: account.id,
          incoming_external_id: contact.externalId,
          email,
        },
      });
      continue;
    }

    // If existing contact belongs to same account, upsert to update
    if (existingElsewhere && existingElsewhere.accountId === account.id) {
      toUpsert.push({
        accountId: account.id,
        email,
        emailDomain: domain,
        name: contact.name,
        title: contact.title,
        phone: contact.phone,
        externalId: contact.externalId,
      });
    } else {
      // New contact — collect for batch createMany
      toCreate.push({
        accountId: account.id,
        email,
        emailDomain: domain,
        name: contact.name,
        title: contact.title,
        phone: contact.phone,
        salesforceId: contact.externalId,
      });
    }
  }

  await deps.prisma.$transaction(async (tx) => {
    // Execute upserts in parallel
    if (toUpsert.length > 0) {
      await Promise.all(
        toUpsert.map((item) =>
          tx.contact.upsert({
            where: {
              accountId_email: { accountId: item.accountId, email: item.email },
            },
            create: {
              accountId: item.accountId,
              email: item.email,
              emailDomain: item.emailDomain,
              name: item.name,
              title: item.title,
              phone: item.phone,
              salesforceId: item.externalId,
            },
            update: {
              name: item.name ?? undefined,
              title: item.title ?? undefined,
              phone: item.phone ?? undefined,
              salesforceId: item.externalId,
            },
          })
        )
      );
    }

    // Batch create new contacts
    if (toCreate.length > 0) {
      await tx.contact.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
  });
}

async function syncOpportunities(
  deps: SyncEngineCRMDeps,
  config: IntegrationConfig,
  provider: CRMDataProvider,
  credentials: ProviderCredentials
): Promise<number> {
  let cursor: string | null = null;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const result = await deps.withRetry(
      () => provider.fetchOpportunities(credentials, cursor, config.lastSyncAt),
      { attempts: 4, baseDelayMs: 1000 }
    );

    const pageConcurrency = 10;
    for (let i = 0; i < result.data.length; i += pageConcurrency) {
      const batch = result.data.slice(i, i + pageConcurrency);
      await Promise.all(
        batch.map((opportunity) =>
          persistOpportunity(deps, config.organizationId, opportunity)
        )
      );
      total += batch.length;
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore && !!cursor;
  }
  return total;
}

async function persistOpportunity(
  deps: SyncEngineCRMDeps,
  organizationId: string,
  opp: NormalizedOpportunity
): Promise<void> {
  if (!opp.accountExternalId) return;

  const account = await deps.prisma.account.findFirst({
    where: { organizationId, salesforceId: opp.accountExternalId },
  });

  if (!account) return;

  const existingOppElsewhere = await deps.prisma.salesforceEvent.findFirst({
    where: {
      opportunityId: opp.externalId,
      account: { organizationId, id: { not: account.id } },
    },
    select: { id: true, accountId: true },
  });
  if (existingOppElsewhere) {
    await deps.queueMergeConflictReview({
      organizationId,
      targetType: "opportunity",
      targetId: existingOppElsewhere.id,
      requestPayload: {
        conflict_type: "OPPORTUNITY_ACCOUNT_COLLISION",
        opportunity_id: opp.externalId,
        existing_account_id: existingOppElsewhere.accountId,
        incoming_account_id: account.id,
      },
    });
    return;
  }

  // Map normalized status to SalesforceEventType
  let eventType:
    | "CLOSED_WON"
    | "CLOSED_LOST"
    | "OPPORTUNITY_STAGE_CHANGE"
    | "OPPORTUNITY_CREATED";

  if (opp.status === "WON") {
    eventType = "CLOSED_WON";
  } else if (opp.status === "LOST") {
    eventType = "CLOSED_LOST";
  } else {
    eventType = "OPPORTUNITY_STAGE_CHANGE";
  }

  // Avoid duplicate events by checking for existing opportunity + stage
  const existing = await deps.prisma.salesforceEvent.findFirst({
    where: {
      accountId: account.id,
      opportunityId: opp.externalId,
      stageName: opp.stage,
    },
  });

  if (existing) return; // Already recorded this stage

  await deps.prisma.salesforceEvent.create({
    data: {
      accountId: account.id,
      eventType,
      stageName: opp.stage,
      opportunityId: opp.externalId,
      amount: opp.amount,
      closeDate: opp.closeDate,
      description: opp.name,
    },
  });
}
