import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define public paths. In our app, '/login' handles both login and registration.
  const isPublicPath = path === "/login";

  const session = await getSession(request);

  if (isPublicPath && session) {
    // Authenticated user trying to access login page: redirect to home dashboard
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }

  if (!isPublicPath && !session) {
    // Unauthenticated user trying to access protected page: redirect to login
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  return NextResponse.next();
}

// Middleware matching configuration
export const config = {
  matcher: [
    /*
     * Match all page routes except:
     * - api routes (/api/...)
     * - static files (_next/static, _next/image)
     * - favicon.ico, and common image asset extensions
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.webp).*)",
  ],
};
