import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  createCheckoutHandler,
  createPortalHandler,
  createStripeWebhookHandler,
} from "../src/middleware/billing.js";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    organizationId: "org-1",
    userRole: "ADMIN",
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("billing handlers", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.BILLING_ENABLED = "true";
    process.env.FRONTEND_URL = "http://localhost:5173";
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
    delete process.env.FRONTEND_URL;
    delete process.env.STRIPE_STARTER_PRICE_ID;
    delete process.env.STRIPE_PROFESSIONAL_PRICE_ID;
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("rejects non-self-serve enterprise checkout when no enterprise price is configured", async () => {
    const prisma = {} as any;
    const stripe = {} as any;
    const handler = createCheckoutHandler(prisma, stripe);

    const req = mockReq({
      body: { plan: "ENTERPRISE" },
    });
    const res = mockRes();

    await handler(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "plan_not_self_serve",
      })
    );
  });

  it("creates checkout session with frontend billing return routes", async () => {
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";

    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "org-1",
          name: "Acme",
          stripeCustomerId: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const stripe = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: "cus_123" }),
      },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.test" }),
        },
      },
    } as any;

    const handler = createCheckoutHandler(prisma, stripe);
    const req = mockReq({
      body: { plan: "STARTER" },
    });
    const res = mockRes();

    await handler(req as any, res);

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "http://localhost:5173/admin/billing?success=true&plan=STARTER",
        cancel_url: "http://localhost:5173/admin/billing?canceled=true",
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      checkoutUrl: "https://checkout.stripe.test",
    });
  });

  it("rejects checkout for non-admin roles", async () => {
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
    const handler = createCheckoutHandler({} as any, {} as any);
    const req = mockReq({
      userRole: "MEMBER",
      body: { plan: "STARTER" },
    });
    const res = mockRes();

    await handler(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "permission_denied" })
    );
  });

  it("creates portal session with frontend billing return route", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          id: "org-1",
          stripeCustomerId: "cus_123",
        }),
      },
    } as any;

    const stripe = {
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            url: "https://portal.stripe.test",
          }),
        },
      },
    } as any;

    const handler = createPortalHandler(prisma, stripe);
    const req = mockReq();
    const res = mockRes();

    await handler(req as any, res);

    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "http://localhost:5173/admin/billing",
    });
    expect(res.json).toHaveBeenCalledWith({
      portalUrl: "https://portal.stripe.test",
    });
  });

  it("rejects portal for non-admin roles", async () => {
    const handler = createPortalHandler({} as any, {} as any);
    const req = mockReq({ userRole: "VIEWER" });
    const res = mockRes();

    await handler(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "permission_denied" })
    );
  });

  it("returns 500 so Stripe retries when webhook processing fails", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";

    const prisma = {
      subscription: {
        upsert: vi.fn().mockRejectedValue(new Error("db_write_failed")),
      },
    } as any;

    const stripe = {
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          data: {
            object: {
              subscription: "sub_123",
              metadata: {
                organizationId: "org-1",
              },
            },
          },
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_123",
          status: "active",
          current_period_start: 1700000000,
          current_period_end: 1702600000,
          items: {
            data: [{ price: { id: "price_starter" } }],
          },
          metadata: {
            organizationId: "org-1",
          },
        }),
      },
    } as any;

    const handler = createStripeWebhookHandler(prisma, stripe);
    const req = mockReq({
      headers: { "stripe-signature": "sig" },
      body: Buffer.from("{}"),
    });
    const res = mockRes();

    await handler(req as any, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "webhook_processing_failed",
    });
  });
});
