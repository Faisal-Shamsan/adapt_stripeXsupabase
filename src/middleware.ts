import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

let warned = false;

/**
 * Refresh the Supabase session on every request. Token refresh writes cookies, which Next only allows here or in
 * Route Handlers — never during a Server Component render. Without this, owners are silently signed out when the
 * access token expires (~1h).
 *
 * If the Supabase environment is missing we pass the request through instead of failing the whole site: public
 * pages keep working and owner routes surface a readable error from env().
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!warned) {
      warned = true;
      console.error("middleware: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set; skipping session refresh. See /api/health.");
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value } of all) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of all) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates with the auth server and triggers the refresh when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/webhooks|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
