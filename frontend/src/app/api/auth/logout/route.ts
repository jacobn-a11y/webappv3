import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const response = NextResponse.redirect(
    new URL("/login", request.url)
  );

  response.cookies.set("wos-session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  response.cookies.set("wos-org", "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
