import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/** Anon-key client bound to the request cookies: used only to identify the signed-in owner. */
export async function serverSupabase() {
  const store = await cookies();
  return createServerClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value, options } of all) store.set(name, value, options);
      },
    },
  });
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const sb = await serverSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}
