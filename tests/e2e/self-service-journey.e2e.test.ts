import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { requestServer } from "../helpers/request-server.js";
import type { Plan, UserRole } from "@prisma/client";
import { createAuthRoutes } from "../../src/api/auth-routes.js";
import { createSessionAuth } from "../../src/middleware/session-auth.js";
import { createSetupRoutes } from "../../src/api/setup-routes.js";
import { requireAuth } from "../../src/middleware/auth.js";
import {
  createCheckoutHandler,
  createPortalHandler,
  createStripeWebhookHandler,
  createTrialGate,
} from "../../src/middleware/billing.js";
import { createOrgSettingsRoutes } from "../../src/api/org-settings-routes.js";

interface OrgRecord {
  id: string;
  name: string;
  plan: Plan;
  stripeCustomerId: string | null;
  trialEndsAt: Date | null;
  billingChannel: "SELF_SERVE" | "SALES_LED";
}

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  workosUserId: string | null;
  organizationId: string;
  role: UserRole;
}

interface SessionRecord {
  id: string;
  organizationId: string;
  userId: string;
  sessionToken: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface InviteRecord {
  id: string;
  organizationId: string;
  email: string;
  role: UserRole;
  invitedById: string;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

interface SubscriptionRecord {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  createdAt: Date;
}

function createHarness() {
  const organizations = new Map<string, OrgRecord>();
  const usersById = new Map<string, UserRecord>();
  const usersByEmail = new Map<string, UserRecord>();
  const sessionsByHashedToken = new Map<string, SessionRecord>();
  const setupWizards = new Map<string, any>();
  const subscriptionsByStripeId = new Map<string, SubscriptionRecord>();
  const invitesByToken = new Map<string, InviteRecord>();
  const inviteIndexByOrgEmail = new Map<string, InviteRecord>();
  const workosByEmail = new Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }>();

  let orgSeq = 1;
  let userSeq = 1;
  let sessionSeq = 1;
  let inviteSeq = 1;
  let workosSeq = 1;
  let stripeCustomerSeq = 1;
  let stripeCheckoutSeq = 1;
  let stripePortalSeq = 1;
  let stripeSubSeq = 1;
  const stripeSubscriptionsById = new Map<string, any>();
  let nextStripeWebhookEvent: any = null;

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return usersById.get(where.id) ?? null;
        if (where?.email) return usersByEmail.get(where.email) ?? null;
        if (where?.workosUserId) {
          for (const user of usersById.values()) {
            if (user.workosUserId === where.workosUserId) return user;
          }
          return null;
        }
        return null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const email = where?.email;
        const organizationId = where?.organizationId;
        if (email && organizationId) {
          const candidate = usersByEmail.get(email);
          if (candidate && candidate.organizationId === organizationId) return candidate;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const user: UserRecord = {
          id: `usr_${userSeq++}`,
          email: data.email,
          name: data.name ?? null,
          workosUserId: data.workosUserId ?? null,
          organizationId: data.organizationId,
          role: data.role,
        };
        usersById.set(user.id, user);
        usersByEmail.set(user.email, user);
        return user;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = usersById.get(where.id);
        if (!existing) throw new Error("user_not_found");
        const updated: UserRecord = {
          ...existing,
          name: data.name ?? existing.name,
          workosUserId: data.workosUserId ?? existing.workosUserId,
          role: data.role ?? existing.role,
        };
        usersById.set(updated.id, updated);
        usersByEmail.set(updated.email, updated);
        return updated;
      }),
    },
    organization: {
      create: vi.fn(async ({ data }: any) => {
        const org: OrgRecord = {
          id: `org_${orgSeq++}`,
          name: data.name,
          plan: data.plan ?? "FREE_TRIAL",
          stripeCustomerId: data.stripeCustomerId ?? null,
          trialEndsAt: data.trialEndsAt ?? null,
          billingChannel: data.billingChannel ?? "SELF_SERVE",
        };
        organizations.set(org.id, org);
        return org;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return organizations.get(where.id) ?? null;
        if (where?.stripeCustomerId) {
          for (const org of organizations.values()) {
            if (org.stripeCustomerId === where.stripeCustomerId) return org;
          }
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const org = organizations.get(where.id);
        if (!org) throw new Error("organization_not_found");
        const updated: OrgRecord = {
          ...org,
          name: data.name ?? org.name,
          plan: data.plan ?? org.plan,
          stripeCustomerId: data.stripeCustomerId ?? org.stripeCustomerId,
          trialEndsAt:
            data.trialEndsAt !== undefined ? data.trialEndsAt : org.trialEndsAt,
          billingChannel: data.billingChannel ?? org.billingChannel,
        };
        organizations.set(updated.id, updated);
        return updated;
      }),
    },
    orgSettings: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => create),
    },
    userSession: {
      create: vi.fn(async ({ data }: any) => {
        const session: SessionRecord = {
          id: `sess_${sessionSeq++}`,
          organizationId: data.organizationId,
          userId: data.userId,
          sessionToken: data.sessionToken,
          expiresAt: data.expiresAt,
          revokedAt: null,
        };
        sessionsByHashedToken.set(session.sessionToken, session);
        return session;
      }),
      findFirst: vi.fn(async ({ where, include, select }: any) => {
        const session = sessionsByHashedToken.get(where.sessionToken);
        if (!session) return null;
        if (where.revokedAt === null && session.revokedAt !== null) return null;
        const user = usersById.get(session.userId);
        if (!user) return null;

        if (include?.user) {
          return { ...session, user };
        }
        if (select) {
          const selected: Record<string, unknown> = {};
          if (select.id) selected.id = session.id;
          if (select.createdAt) {
            selected.createdAt = new Date(Date.now() - 5 * 60 * 1000);
          }
          if (select.expiresAt) selected.expiresAt = session.expiresAt;
          if (select.user) {
            selected.user = {
              id: user.id,
              organizationId: user.organizationId,
              role: user.role,
            };
          }
          return selected;
        }
        return session;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.sessionToken) {
          const session = sessionsByHashedToken.get(where.sessionToken);
          if (session) {
            session.revokedAt = data.revokedAt ?? session.revokedAt;
          }
        }
        if (where.id) {
          for (const session of sessionsByHashedToken.values()) {
            if (session.id === where.id) {
              session.revokedAt = data.revokedAt ?? session.revokedAt;
            }
          }
        }
        return { count: 1 };
      }),
    },
    setupWizard: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = where.organizationId;
        const existing = setupWizards.get(key);
        if (existing) return existing;
        const created = {
          id: `wiz_${key}`,
          organizationId: key,
          currentStep: "RECORDING_PROVIDER",
          completedAt: null,
          recordingProvider: null,
          mergeLinkedAccountId: null,
          crmProvider: null,
          crmMergeLinkedAccountId: null,
          syncedAccountCount: 0,
          unresolvedCount: 0,
          syncReviewedAt: null,
          selectedPlan: null,
          permissionsConfiguredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        setupWizards.set(key, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const wizard = setupWizards.get(where.organizationId);
        if (!wizard) throw new Error("wizard_not_found");
        const updated = { ...wizard, ...data, updatedAt: new Date() };
        setupWizards.set(where.organizationId, updated);
        return updated;
      }),
    },
    roleProfile: {
      count: vi.fn(async () => 0),
      upsert: vi.fn(async ({ create }: any) => create),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    story: {
      count: vi.fn(async () => 0),
    },
    landingPage: {
      count: vi.fn(async () => 0),
    },
    integrationConfig: {
      count: vi.fn(async () => 0),
    },
    call: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { duration: 0 }, _count: { id: 0 } })),
    },
    subscription: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (!where?.stripeSubscriptionId) return null;
        return subscriptionsByStripeId.get(where.stripeSubscriptionId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any = {}) => {
        const list = Array.from(subscriptionsByStripeId.values()).filter((sub) => {
          if (where?.organizationId && sub.organizationId !== where.organizationId) {
            return false;
          }
          if (where?.status && sub.status !== where.status) {
            return false;
          }
          if (
            where?.stripeSubscriptionId?.not &&
            sub.stripeSubscriptionId === where.stripeSubscriptionId.not
          ) {
            return false;
          }
          return true;
        });
        if (list.length === 0) return null;
        list.sort((a, b) => {
          const byPeriod = b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime();
          if (byPeriod !== 0) return byPeriod;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        return list[0];
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = subscriptionsByStripeId.get(where.stripeSubscriptionId);
        if (existing) {
          const next: SubscriptionRecord = {
            ...existing,
            ...update,
          };
          subscriptionsByStripeId.set(existing.stripeSubscriptionId, next);
          return next;
        }
        const created: SubscriptionRecord = {
          id: create.id ?? `sub_local_${stripeSubSeq++}`,
          organizationId: create.organizationId,
          stripeSubscriptionId: create.stripeSubscriptionId,
          status: create.status,
          currentPeriodStart: create.currentPeriodStart,
          currentPeriodEnd: create.currentPeriodEnd,
          canceledAt: create.canceledAt ?? null,
          createdAt: new Date(),
        };
        subscriptionsByStripeId.set(created.stripeSubscriptionId, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = subscriptionsByStripeId.get(where.stripeSubscriptionId);
        if (!existing) throw new Error("subscription_not_found");
        const updated: SubscriptionRecord = {
          ...existing,
          ...data,
        };
        subscriptionsByStripeId.set(existing.stripeSubscriptionId, updated);
        return updated;
      }),
    },
    orgInvite: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = `${where.organizationId_email.organizationId}:${where.organizationId_email.email}`;
        const existing = inviteIndexByOrgEmail.get(key);
        if (existing) {
          const next: InviteRecord = {
            ...existing,
            ...update,
          };
          invitesByToken.delete(existing.token);
          invitesByToken.set(next.token, next);
          inviteIndexByOrgEmail.set(key, next);
          return next;
        }
        const created: InviteRecord = {
          id: `inv_${inviteSeq++}`,
          organizationId: create.organizationId,
          email: create.email,
          role: create.role,
          invitedById: create.invitedById,
          token: create.token,
          expiresAt: create.expiresAt,
          acceptedAt: null,
        };
        invitesByToken.set(created.token, created);
        inviteIndexByOrgEmail.set(key, created);
        return created;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const invite = invitesByToken.get(where.token) ?? null;
        if (!invite) return null;
        if (include?.organization) {
          const org = organizations.get(invite.organizationId);
          return {
            ...invite,
            organization: {
              id: org?.id ?? invite.organizationId,
              name: org?.name ?? "Workspace",
            },
          };
        }
        return invite;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        let target: InviteRecord | null = null;
        for (const invite of invitesByToken.values()) {
          if (invite.id === where.id) {
            target = invite;
            break;
          }
        }
        if (!target) throw new Error("invite_not_found");
        const updated = {
          ...target,
          acceptedAt: data.acceptedAt ?? target.acceptedAt,
        };
        invitesByToken.set(updated.token, updated);
        inviteIndexByOrgEmail.set(
          `${updated.organizationId}:${updated.email}`,
          updated
        );
        return updated;
      }),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const invite of invitesByToken.values()) {
          if (
            invite.id === where.id &&
            invite.organizationId === where.organizationId
          ) {
            return invite;
          }
        }
        return null;
      }),
      delete: vi.fn(async ({ where }: any) => {
        for (const invite of invitesByToken.values()) {
          if (invite.id === where.id) {
            invitesByToken.delete(invite.token);
            inviteIndexByOrgEmail.delete(`${invite.organizationId}:${invite.email}`);
            break;
          }
        }
        return { id: where.id };
      }),
    },
    userPermission: {
      findUnique: vi.fn(async () => null),
    },
  } as any;

  const workos = {
    userManagement: {
      getAuthorizationUrl: vi.fn(() => "https://auth.example.com"),
      createUser: vi.fn(async ({ email, firstName }: any) => {
        const existing = workosByEmail.get(email);
        if (existing) return existing;
        const created = {
          id: `wos_${workosSeq++}`,
          email,
          firstName: firstName ?? null,
          lastName: null,
        };
        workosByEmail.set(email, created);
        return created;
      }),
      authenticateWithPassword: vi.fn(async ({ email }: any) => {
        let workosUser = workosByEmail.get(email);
        if (!workosUser) {
          workosUser = {
            id: `wos_${workosSeq++}`,
            email,
            firstName: null,
            lastName: null,
          };
          workosByEmail.set(email, workosUser);
        }
        return {
          accessToken: `access_${email}`,
          refreshToken: `refresh_${email}`,
          user: workosUser,
        };
      }),
      authenticateWithCode: vi.fn(),
    },
  } as any;

  const stripe = {
    customers: {
      create: vi.fn(async () => ({ id: `cus_${stripeCustomerSeq++}` })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          url: `https://checkout.example.com/session/${stripeCheckoutSeq++}`,
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({
          url: `https://billing.example.com/session/${stripePortalSeq++}`,
        })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async (subscriptionId: string) => {
        const subscription = stripeSubscriptionsById.get(subscriptionId);
        if (!subscription) {
          throw new Error("stripe_subscription_not_found");
        }
        return subscription;
      }),
    },
    webhooks: {
      constructEvent: vi.fn(() => {
        if (!nextStripeWebhookEvent) {
          throw new Error("stripe_webhook_event_not_set");
        }
        return nextStripeWebhookEvent;
      }),
    },
    __setSubscription: (subscriptionId: string, data?: Partial<any>) => {
      const now = Math.floor(Date.now() / 1000);
      stripeSubscriptionsById.set(subscriptionId, {
        id: subscriptionId,
        status: "active",
        current_period_start: now,
        current_period_end: now + 30 * 24 * 60 * 60,
        metadata: {},
        customer: "cus_1",
        items: {
          data: [{ price: { id: "price_starter" } }],
        },
        ...data,
      });
    },
    __setWebhookEvent: (event: any) => {
      nextStripeWebhookEvent = event;
    },
  } as any;

  return { prisma, workos, stripe };
}

describe("self-service user journey", () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.RESEND_API_KEY = "";
  });

  it("supports signup -> setup plan -> checkout -> portal -> invite accept -> protected access", async () => {
    const { prisma, workos, stripe } = createHarness();

    const app = express();
    app.post(
      "/api/webhooks/stripe",
      express.raw({ type: "application/json" }),
      createStripeWebhookHandler(prisma, stripe)
    );
    app.use(express.json());
    app.use("/api/auth", createAuthRoutes(prisma, workos));
    app.use(createSessionAuth(prisma));
    app.use("/api/setup", createSetupRoutes(prisma, stripe));
    app.use(requireAuth);
    const trialGate = createTrialGate(prisma, stripe);
    app.post("/api/billing/checkout", createCheckoutHandler(prisma, stripe));
    app.post("/api/billing/portal", createPortalHandler(prisma, stripe));
    app.get("/api/trial-gated", trialGate, (_req, res) => {
      res.json({ ok: true });
    });
    app.use("/api/settings/org", trialGate, createOrgSettingsRoutes(prisma));
    app.get("/api/protected", (_req, res) => {
      res.json({ ok: true });
    });

    const { request, close } = await requestServer(app);
    try {
      const signup = await request.post("/api/auth/signup").send({
      email: "owner@acme.com",
      password: "secret123",
      name: "Owner User",
      organizationName: "Acme Cloud",
    });
      expect(signup.status).toBe(201);
      expect(signup.body.user.role).toBe("OWNER");
      expect(signup.body.sessionToken).toBeTruthy();
      const ownerSessionToken = signup.body.sessionToken as string;

      const me = await request
        .get("/api/auth/me")
        .set("x-session-token", ownerSessionToken);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe("owner@acme.com");

      const setupStatus = await request
        .get("/api/setup/status")
        .set("x-session-token", ownerSessionToken);
      expect(setupStatus.status).toBe(200);

      const setupPlan = await request
        .post("/api/setup/step/plan")
        .set("x-session-token", ownerSessionToken)
        .send({ plan: "STARTER" });
      expect(setupPlan.status).toBe(200);
      expect(setupPlan.body.checkoutUrl).toContain("https://checkout.example.com/session/");

      const checkout = await request
        .post("/api/billing/checkout")
        .set("x-session-token", ownerSessionToken)
        .send({ plan: "STARTER" });
      expect(checkout.status).toBe(200);
      expect(checkout.body.checkoutUrl).toContain("https://checkout.example.com/session/");

      const portal = await request
        .post("/api/billing/portal")
        .set("x-session-token", ownerSessionToken);
      expect(portal.status).toBe(200);
      expect(portal.body.portalUrl).toContain("https://billing.example.com/session/");

      const organizationId = signup.body.user.organizationId as string;
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          plan: "FREE_TRIAL",
          trialEndsAt: new Date(Date.now() - 60_000),
        },
      });

      const gatedBeforeWebhook = await request
        .get("/api/trial-gated")
        .set("x-session-token", ownerSessionToken);
      expect(gatedBeforeWebhook.status).toBe(402);
      expect(gatedBeforeWebhook.body.error).toBe("trial_expired");

      const stripeSubscriptionId = "sub_self_service_1";
    stripe.__setSubscription(stripeSubscriptionId, {
      metadata: { organizationId },
      items: { data: [{ price: { id: "price_starter" } }] },
    });
    stripe.__setWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          subscription: stripeSubscriptionId,
          metadata: { organizationId },
        },
      },
    });

      const webhook = await request
        .post("/api/webhooks/stripe")
        .set("stripe-signature", "test_signature")
        .set("content-type", "application/json")
        .send("{}");
      expect(webhook.status).toBe(200);

      const orgAfterWebhook = await prisma.organization.findUnique({
        where: { id: organizationId },
      });
      expect(orgAfterWebhook?.plan).toBe("STARTER");
      expect(orgAfterWebhook?.trialEndsAt).toBeNull();

      const localSubscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId },
      });
      expect(localSubscription?.status).toBe("ACTIVE");

      const gatedAfterWebhook = await request
        .get("/api/trial-gated")
        .set("x-session-token", ownerSessionToken);
      expect(gatedAfterWebhook.status).toBe(200);
      expect(gatedAfterWebhook.body.ok).toBe(true);

      const invite = await request
        .post("/api/settings/org/invites")
        .set("x-session-token", ownerSessionToken)
        .send({ email: "new.user@acme.com", role: "MEMBER" });
      expect(invite.status).toBe(201);
      expect(invite.body.invite.invite_url).toContain("http://localhost:5173/invite/");
      const inviteToken = (invite.body.invite.invite_url as string).split("/invite/")[1];
      expect(inviteToken).toBeTruthy();

      const inviteDetails = await request.get(`/api/auth/invites/${inviteToken}`);
      expect(inviteDetails.status).toBe(200);
      expect(inviteDetails.body.invite.email).toBe("new.user@acme.com");

      const accept = await request
        .post(`/api/auth/invites/${inviteToken}/accept`)
        .send({ password: "newuserpass", name: "New User" });
      expect(accept.status).toBe(201);
      expect(accept.body.user.organizationId).toBe(signup.body.user.organizationId);
      expect(accept.body.sessionToken).toBeTruthy();

      const invitedProtected = await request
        .get("/api/protected")
        .set("x-session-token", accept.body.sessionToken as string);
      expect(invitedProtected.status).toBe(200);
      expect(invitedProtected.body.ok).toBe(true);
    } finally {
      close();
    }
  });
});
