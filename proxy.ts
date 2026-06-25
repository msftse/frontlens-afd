import { NextResponse, type NextRequest } from "next/server";

import { authEnabled } from "@/lib/auth/enabled";

/**
 * Next.js 16 renamed `middleware` → `proxy` (nodejs runtime). This is a
 * lightweight gate: when Entra ID auth is enabled, unauthenticated requests to
 * app pages are redirected to sign-in. Full session validation happens in the
 * BFF route handler (`/api/query`) via `auth()`. No-op when auth is disabled.
 */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  // Always allow the auth endpoints themselves.
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  // Auth.js may split large session cookies into `<name>.0`, `<name>.1`, ...
  // so match the base name or any chunk, not just an exact name.
  const signedIn = req.cookies
    .getAll()
    .some(({ name }) => SESSION_COOKIES.some((base) => name === base || name.startsWith(`${base}.`)));
  if (signedIn) return NextResponse.next();

  // Unauthenticated API calls get 401; pages redirect to sign-in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL("/api/auth/signin", req.url);
  url.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except static assets and the world map JSON.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|world-countries.json|.*\\.svg$).*)"],
};
