import { WorkOS } from "@workos-inc/node";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

function getWorkOS() {
  return new WorkOS(process.env.WORKOS_API_KEY!);
}

export function getAuthorizationUrl(screen?: "sign-up") {
  const workos = getWorkOS();
  const clientId = process.env.WORKOS_CLIENT_ID!;
  return workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
    clientId,
    ...(screen ? { screenHint: screen } : {}),
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("wos-session")?.value;
  if (!sessionToken) return null;

  try {
    const workos = getWorkOS();
    const user = await workos.userManagement.getUser(sessionToken);
    const orgs = await workos.userManagement.listOrganizationMemberships({
      userId: user.id,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePictureUrl: user.profilePictureUrl,
      },
      organizationMemberships: orgs.data,
    };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
