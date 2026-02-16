import { WorkOS } from "@workos-inc/node";
import { NextRequest, NextResponse } from "next/server";

function getWorkOS() {
  return new WorkOS(process.env.WORKOS_API_KEY!);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=no_code", request.url)
    );
  }

  try {
    const workos = getWorkOS();
    const clientId = process.env.WORKOS_CLIENT_ID!;

    const { user, accessToken } =
      await workos.userManagement.authenticateWithCode({
        code,
        clientId,
      });

    // Set session cookie with the access token
    const response = NextResponse.redirect(new URL("/", request.url));

    response.cookies.set("wos-session", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    // If user belongs to organizations, set the first one as default
    const memberships =
      await workos.userManagement.listOrganizationMemberships({
        userId: user.id,
      });

    if (memberships.data.length > 0) {
      response.cookies.set("wos-org", memberships.data[0].organizationId, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("WorkOS auth callback error:", error);
    return NextResponse.redirect(
      new URL("/login?error=auth_failed", request.url)
    );
  }
}
