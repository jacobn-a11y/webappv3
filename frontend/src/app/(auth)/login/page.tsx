import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in - StoryEngine" };

export default async function LoginPage() {
  const cookieStore = await cookies();
  if (cookieStore.get("wos-session")?.value) {
    redirect("/");
  }

  const authUrl = getWorkOSAuthUrl();

  return <LoginForm authUrl={authUrl} />;
}

function getWorkOSAuthUrl() {
  const clientId = process.env.WORKOS_CLIENT_ID ?? "";
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/callback`;
  const baseUrl = "https://api.workos.com/user_management/authorize";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    provider: "authkit",
  });

  return `${baseUrl}?${params.toString()}`;
}
