import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const PUBLIC_PREFIXES = [
  "/api/auth",
  "/login",
  "/_next",
  "/favicon",
];

export function middleware(request: NextRequest) {
  if (process.env.AUTH_DISABLED === "1") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Better Auth uses __Secure- prefix on HTTPS, plain name on HTTP
  const sessionCookie =
    request.cookies.get("__Secure-better-auth.session_token")?.value ||
    request.cookies.get("better-auth.session_token")?.value;
  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
