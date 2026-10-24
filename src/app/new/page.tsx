import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { NewBusinessForm } from "@/components/owner/NewBusinessForm";
import { Display, Eyebrow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPage() {
  const user = await currentUser();
  if (!user) redirect("/auth/start?next=/new");

  const { data } = await admin().from("tenants").select("id, slug, name, published").eq("owner_id", user.id).order("created_at");
  const existing = data ?? [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <Link href="/" className="font-display mb-12 text-2xl font-semibold">
        Adapt
      </Link>
      <Eyebrow className="rise">New business</Eyebrow>
      <Display className="rise rise-1 mt-4 text-5xl">What&apos;s it called?</Display>
      <p className="rise rise-2 mt-4 text-stone">Just the name for now — you&apos;ll describe everything else in a conversation.</p>
      <div className="rise rise-3 mt-10">
        <NewBusinessForm />
      </div>
      {existing.length > 0 && (
        <div className="rise rise-4 mt-16">
          <Eyebrow>Your businesses</Eyebrow>
          <ul className="mt-4 space-y-2">
            {existing.map((t) => (
              <li key={t.id}>
                <Link href={`/dashboard/${t.id}`} className="tactile glass flex items-center justify-between rounded-2xl px-5 py-4 hover:bg-white/70">
                  <span className="font-display text-xl">{t.name}</span>
                  <span className="text-xs uppercase tracking-[0.14em] text-stone">{t.published ? "Live" : "Draft"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
