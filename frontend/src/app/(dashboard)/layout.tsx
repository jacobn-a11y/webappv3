import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { SessionProvider, type SessionData } from "@/lib/auth-context";

async function getSessionData(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("wos-session")?.value;
  if (!sessionToken) return null;

  // In production, validate the session token with WorkOS.
  // For now, decode from a JWT or call the WorkOS API.
  // This is a placeholder that expects the API layer to set session data.
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/auth/me`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionData();
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("wos-org")?.value ?? null;

  const sessionWithOrg: SessionData = {
    ...session,
    currentOrgId,
  };

  return (
    <SessionProvider session={sessionWithOrg}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
