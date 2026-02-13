/**
 * Auth Routes — WorkOS Authentication
 *
 * Handles Google SSO and email/password authentication via WorkOS UserManagement.
 * On first login, creates a local Organization (with 14-day free trial) and User
 * record, linking them to the WorkOS user. Subsequent logins look up the existing
 * records.
 *
 * All routes under /api/auth/* are public (no JWT required).
 *
 *   GET  /api/auth/login          — Returns WorkOS authorization URL
 *   GET  /api/auth/callback       — OAuth/SSO callback, exchanges code for tokens
 *   POST /api/auth/signup         — Email/password registration
 *   POST /api/auth/login/password — Email/password login
 *   POST /api/auth/logout         — Client-side token invalidation acknowledgement
 */

import { Router } from "express";
import type { WorkOS, User as WorkOSUser } from "@workos-inc/node";
import { z } from "zod";
import type { PrismaClient, User } from "@prisma/client";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
});

const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── First-Login Provisioning ───────────────────────────────────────────────

/**
 * Finds an existing local User by workosUserId or email, or creates a new
 * Organization + User on first login. The first user in an organization is
 * assigned the OWNER role; subsequent users from the same email domain join
 * as MEMBER.
 */
async function findOrCreateUser(
  prisma: PrismaClient,
  workosUser: WorkOSUser,
  organizationName?: string
): Promise<User> {
  // 1. Already linked — fast path
  const byWorkosId = await prisma.user.findUnique({
    where: { workosUserId: workosUser.id },
  });
  if (byWorkosId) return byWorkosId;

  // 2. Pre-provisioned by email but not yet linked to WorkOS
  const byEmail = await prisma.user.findUnique({
    where: { email: workosUser.email },
  });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        workosUserId: workosUser.id,
        name:
          buildDisplayName(workosUser.firstName, workosUser.lastName) ??
          byEmail.name,
      },
    });
  }

  // 3. Brand-new user — find or create organization
  const emailDomain = workosUser.email.split("@")[1];

  // Check for an existing org whose members share this email domain
  const existingOrgUser = await prisma.user.findFirst({
    where: { email: { endsWith: `@${emailDomain}` } },
    select: { organizationId: true },
  });

  let orgId: string;
  let isFirstUser: boolean;

  if (existingOrgUser) {
    orgId = existingOrgUser.organizationId;
    isFirstUser = false;
  } else {
    const org = await prisma.organization.create({
      data: {
        name: organizationName ?? emailDomain,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    orgId = org.id;
    isFirstUser = true;
  }

  return prisma.user.create({
    data: {
      email: workosUser.email,
      name: buildDisplayName(workosUser.firstName, workosUser.lastName),
      workosUserId: workosUser.id,
      organizationId: orgId,
      role: isFirstUser ? "OWNER" : "MEMBER",
    },
  });
}

function buildDisplayName(
  firstName: string | null,
  lastName: string | null
): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Shape returned to the client after successful auth. */
function formatUserResponse(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    role: user.role,
  };
}

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createAuthRoutes(
  prisma: PrismaClient,
  workos: WorkOS
): Router {
  const router = Router();
  const clientId = process.env.WORKOS_CLIENT_ID ?? "";
  const redirectUri = process.env.WORKOS_REDIRECT_URI ?? "";

  // GET /login — return a WorkOS authorization URL.
  // Pass ?provider=google to go directly to Google SSO.
  // Omit provider to use the AuthKit hosted login page.
  router.get("/login", (req, res) => {
    const providerParam =
      typeof req.query.provider === "string" ? req.query.provider : undefined;

    const url = workos.userManagement.getAuthorizationUrl({
      clientId,
      redirectUri,
      provider: providerParam === "google" ? "GoogleOAuth" : undefined,
      screenHint:
        req.query.screen === "sign-up" ? "sign-up" : undefined,
    });

    res.json({ authorizationUrl: url });
  });

  // GET /callback — exchange authorization code for tokens, provision user.
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;

    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    try {
      const authResult = await workos.userManagement.authenticateWithCode({
        clientId,
        code,
      });

      const user = await findOrCreateUser(prisma, authResult.user);

      res.json({
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      res.status(401).json({ error: message });
    }
  });

  // POST /signup — email/password registration.
  router.post("/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, name, organizationName } = parsed.data;

    try {
      // Create user in WorkOS
      const workosUser = await workos.userManagement.createUser({
        email,
        password,
        firstName: name,
      });

      // Authenticate to obtain tokens
      const authResult =
        await workos.userManagement.authenticateWithPassword({
          clientId,
          email,
          password,
        });

      // Provision local Organization + User
      const user = await findOrCreateUser(
        prisma,
        workosUser,
        organizationName
      );

      res.status(201).json({
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      res.status(400).json({ error: message });
    }
  });

  // POST /login/password — email/password login.
  router.post("/login/password", async (req, res) => {
    const parsed = passwordLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const authResult =
        await workos.userManagement.authenticateWithPassword({
          clientId,
          email,
          password,
        });

      const user = await findOrCreateUser(prisma, authResult.user);

      res.json({
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid email or password";
      res.status(401).json({ error: message });
    }
  });

  // POST /logout — acknowledge token discard.
  // WorkOS access tokens are stateless JWTs; the client discards them.
  router.post("/logout", (_req, res) => {
    res.json({ success: true });
  });

  return router;
}
