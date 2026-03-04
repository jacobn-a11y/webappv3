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
import type { PrismaClient, User, UserRole } from "@prisma/client";
import { generateSessionToken, hashSessionToken } from "../lib/session-token.js";
import {
  decodeSecurityPolicy,
  type SecurityPolicyBoundary,
} from "../types/json-boundaries.js";
import { sendSuccess, sendCreated, sendBadRequest, sendUnauthorized, sendNotFound, sendConflict } from "./_shared/responses.js";

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

const inviteAcceptSchema = z.object({
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

// ─── First-Login Provisioning ───────────────────────────────────────────────

/**
 * Finds an existing local User by workosUserId or email, or creates a new
 * Organization + User on first login. The first user in an organization is
 * assigned the OWNER role. Org assignment must be explicit for invited users.
 */
interface UserProvisioningOptions {
  organizationName?: string;
  organizationId?: string;
  role?: UserRole;
}

async function findOrCreateUser(
  prisma: PrismaClient,
  workosUser: WorkOSUser,
  options?: UserProvisioningOptions
): Promise<User> {
  const targetOrgId = options?.organizationId;
  const targetRole = options?.role;

  // 1. Already linked — fast path
  const byWorkosId = await prisma.user.findUnique({
    where: { workosUserId: workosUser.id },
  });
  if (byWorkosId) {
    if (targetOrgId && byWorkosId.organizationId !== targetOrgId) {
      throw new Error("This account belongs to a different organization.");
    }
    return byWorkosId;
  }

  // 2. Pre-provisioned by email but not yet linked to WorkOS
  const byEmail = await prisma.user.findUnique({
    where: { email: workosUser.email },
  });
  if (byEmail) {
    if (targetOrgId && byEmail.organizationId !== targetOrgId) {
      throw new Error(
        "This email already belongs to another organization. Use an invite-specific email."
      );
    }

    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        workosUserId: workosUser.id,
        name:
          buildDisplayName(workosUser.firstName, workosUser.lastName) ??
          byEmail.name,
        role: targetRole ?? byEmail.role,
      },
    });
  }

  // 3. Brand-new user — create inside explicit org, or create their own org
  const emailDomain = workosUser.email.split("@")[1];

  let orgId = targetOrgId;
  let role: UserRole = targetRole ?? "MEMBER";

  if (!orgId) {
    const organizationName = options?.organizationName;
    const org = await prisma.organization.create({
      data: {
        name: organizationName ?? emailDomain,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    orgId = org.id;
    role = "OWNER";
  } else {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      throw new Error("Invitation organization no longer exists.");
    }
  }

  return prisma.user.create({
    data: {
      email: workosUser.email,
      name: buildDisplayName(workosUser.firstName, workosUser.lastName),
      workosUserId: workosUser.id,
      organizationId: orgId,
      role,
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

function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

async function readOrgSecurityPolicy(
  prisma: PrismaClient,
  organizationId: string
): Promise<SecurityPolicyBoundary> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { securityPolicy: true },
  });
  return decodeSecurityPolicy(settings?.securityPolicy);
}

async function enforcePasswordAuthAllowed(
  prisma: PrismaClient,
  email: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { organizationId: true },
  });
  if (!user) return;
  const policy = await readOrgSecurityPolicy(prisma, user.organizationId);
  if (policy.sso_enforced) {
    throw new Error(
      "SSO is enforced for your organization. Use SSO login instead of password authentication."
    );
  }
}

async function enforceSsoDomainMapping(
  prisma: PrismaClient,
  user: User
): Promise<void> {
  const policy = await readOrgSecurityPolicy(prisma, user.organizationId);
  const allowed = (policy.allowed_sso_domains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return;
  const domain = emailDomain(user.email);
  if (!allowed.includes(domain)) {
    throw new Error("SSO domain is not allowed for this organization.");
  }
}

async function createSessionForUser(
  prisma: PrismaClient,
  user: User,
  reqMeta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<{ token: string; expiresAt: Date }> {
  const policy = await readOrgSecurityPolicy(prisma, user.organizationId);
  const maxHours = Math.max(1, policy.max_session_age_hours ?? 24 * 30);
  const expiresAt = new Date(Date.now() + maxHours * 60 * 60 * 1000);
  const token = generateSessionToken();
  await prisma.userSession.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      sessionToken: token.hash,
      ipAddress: reqMeta.ipAddress ?? null,
      userAgent: reqMeta.userAgent ?? null,
      expiresAt,
    },
  });
  return { token: token.raw, expiresAt };
}

function readSessionTokenHeader(header: string | string[] | undefined): string | null {
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return trimmed;
}

async function findActiveSession(
  prisma: PrismaClient,
  rawToken: string
): Promise<{ user: User; expiresAt: Date; sessionId: string } | null> {
  const now = new Date();
  const hashed = hashSessionToken(rawToken);
  const session = await prisma.userSession.findFirst({
    where: {
      sessionToken: hashed,
      revokedAt: null,
    },
    include: {
      user: true,
    },
  });

  if (!session) return null;
  if (session.expiresAt <= now) {
    await prisma.userSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }

  await prisma.userSession.updateMany({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });
  return { user: session.user, expiresAt: session.expiresAt, sessionId: session.id };
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

    sendSuccess(res, { authorizationUrl: url });
  });

  // GET /callback — exchange authorization code for tokens, provision user.
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;

    if (!code) {
      sendBadRequest(res, "Missing authorization code");
      return;
    }

    try {
      const authResult = await workos.userManagement.authenticateWithCode({
        clientId,
        code,
      });

      const user = await findOrCreateUser(prisma, authResult.user);
      await enforceSsoDomainMapping(prisma, user);
      const session = await createSessionForUser(prisma, user, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      sendSuccess(res, {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      sendUnauthorized(res, message);
    }
  });

  // POST /signup — email/password registration.
  router.post("/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "Validation failed", parsed.error.flatten().fieldErrors);
      return;
    }

    const { email, password, name, organizationName } = parsed.data;

    try {
      await enforcePasswordAuthAllowed(prisma, email);

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
      const user = await findOrCreateUser(prisma, workosUser, {
        organizationName,
      });
      const session = await createSessionForUser(prisma, user, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      sendCreated(res, {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Registration failed";
      sendBadRequest(res, message);
    }
  });

  // POST /login/password — email/password login.
  router.post("/login/password", async (req, res) => {
    const parsed = passwordLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "Validation failed", parsed.error.flatten().fieldErrors);
      return;
    }

    const { email, password } = parsed.data;

    try {
      await enforcePasswordAuthAllowed(prisma, email);

      const authResult =
        await workos.userManagement.authenticateWithPassword({
          clientId,
          email,
          password,
        });

      const user = await findOrCreateUser(prisma, authResult.user);
      const session = await createSessionForUser(prisma, user, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      sendSuccess(res, {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid email or password";
      sendUnauthorized(res, message);
    }
  });

  // GET /me — returns the currently authenticated user from session token.
  router.get("/me", async (req, res) => {
    const rawToken = readSessionTokenHeader(req.headers["x-session-token"]);
    if (!rawToken) {
      sendUnauthorized(res, "authentication_required");
      return;
    }

    const session = await findActiveSession(prisma, rawToken);
    if (!session) {
      sendUnauthorized(res, "invalid_session");
      return;
    }

    sendSuccess(res, {
      user: formatUserResponse(session.user),
      sessionExpiresAt: session.expiresAt.toISOString(),
    });
  });

  // PATCH /me — update current user profile fields.
  router.patch("/me", async (req, res) => {
    const rawToken = readSessionTokenHeader(req.headers["x-session-token"]);
    if (!rawToken) {
      sendUnauthorized(res, "authentication_required");
      return;
    }
    const session = await findActiveSession(prisma, rawToken);
    if (!session) {
      sendUnauthorized(res, "invalid_session");
      return;
    }
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "validation_error", parsed.error.flatten().fieldErrors);
      return;
    }
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name: parsed.data.name },
    });
    sendSuccess(res, { user: formatUserResponse(user) });
  });

  // GET /invites/:token — fetch invite details for acceptance UI.
  router.get("/invites/:token", async (req, res) => {
    const token = (req.params.token as string) || "";
    const invite = await prisma.orgInvite.findUnique({
      where: { token },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    if (!invite) {
      sendNotFound(res, "invite_not_found");
      return;
    }

    if (invite.acceptedAt) {
      sendConflict(res, "invite_already_accepted");
      return;
    }

    if (invite.expiresAt <= new Date()) {
      res.status(410).json({ error: "invite_expired" });
      return;
    }

    sendSuccess(res, {
      invite: {
        email: invite.email,
        role: invite.role,
        organizationId: invite.organization.id,
        organizationName: invite.organization.name,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
  });

  // POST /invites/:token/accept — self-service invite acceptance.
  router.post("/invites/:token/accept", async (req, res) => {
    const token = (req.params.token as string) || "";
    const parsed = inviteAcceptSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "Validation failed", parsed.error.flatten().fieldErrors);
      return;
    }

    const invite = await prisma.orgInvite.findUnique({
      where: { token },
    });

    if (!invite) {
      sendNotFound(res, "invite_not_found");
      return;
    }
    if (invite.acceptedAt) {
      sendConflict(res, "invite_already_accepted");
      return;
    }
    if (invite.expiresAt <= new Date()) {
      res.status(410).json({ error: "invite_expired" });
      return;
    }

    const { password, name } = parsed.data;

    try {
      await enforcePasswordAuthAllowed(prisma, invite.email);
      try {
        await workos.userManagement.createUser({
          email: invite.email,
          password,
          firstName: name,
        });
      } catch {
        // If user already exists in WorkOS, authentication below validates ownership.
      }

      const authResult =
        await workos.userManagement.authenticateWithPassword({
          clientId,
          email: invite.email,
          password,
        });

      const user = await findOrCreateUser(prisma, authResult.user, {
        organizationId: invite.organizationId,
        role: invite.role,
      });

      await prisma.orgInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      const session = await createSessionForUser(prisma, user, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      sendCreated(res, {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        user: formatUserResponse(user),
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to accept invite";
      sendBadRequest(res, message);
    }
  });

  // POST /logout — acknowledge token discard.
  // WorkOS access tokens are stateless JWTs; the client discards them.
  router.post("/logout", async (req, res) => {
    const rawToken = readSessionTokenHeader(req.headers["x-session-token"]);
    if (rawToken) {
      const hashed = hashSessionToken(rawToken);
      await prisma.userSession.updateMany({
        where: { sessionToken: hashed, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    sendSuccess(res, { success: true });
  });

  return router;
}
