import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Sign up - StoryEngine" };

export default async function SignupPage() {
  const cookieStore = await cookies();
  if (cookieStore.get("wos-session")?.value) {
    redirect("/");
  }

  const authUrl = getWorkOSAuthUrl();

  return <SignupForm authUrl={authUrl} />;
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
    screen_hint: "sign-up",
  });

  return `${baseUrl}?${params.toString()}`;
}
