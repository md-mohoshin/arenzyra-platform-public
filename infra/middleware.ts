import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "arenzyra-auth-token";

function isAuthenticated(request: NextRequest) {
  const cookieToken = request.cookies.get(AUTH_COOKIE)?.value;
  const headerToken = request.headers.get("authorization");
  return Boolean(cookieToken?.trim() || headerToken?.trim());
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Redirect super-admin root to the organizations hub so it never 404s.
  if (pathname === "/super-admin") {
    const target = new URL("/super-admin/organizations", request.url);
    return NextResponse.redirect(target);
  }

  // Guard only the root path; leave other routes (login, api, assets) untouched.
  if (pathname !== "/") {
    return NextResponse.next();
  }

  const authenticated = isAuthenticated(request);

  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const dashboardUrl = new URL("/dashboard", request.url);
  return NextResponse.redirect(dashboardUrl);
}

export const config = {
  matcher: ["/", "/super-admin"],
};
