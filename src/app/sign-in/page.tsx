"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/browser";
import { Button, Display, Eyebrow, Input, Label } from "@/components/ui";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/new";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(params.get("error") ? "error" : "idle");
  const [message, setMessage] = useState<string | null>(
    params.get("error") ? `That link didn't work (${params.get("error")}). Request a new one and open it in this same browser.` : null,
  );

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await browserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else setState("sent");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Link href="/" className="font-display mb-12 text-2xl font-semibold">
        Adapt
      </Link>
      <Eyebrow className="rise">Owners</Eyebrow>
      <Display className="rise rise-1 mt-4 text-5xl">Sign in with a link</Display>
      <p className="rise rise-2 mt-4 text-stone">No password. We&apos;ll email you a one-time sign-in link.</p>
      {state === "sent" ? (
        <div className="rise glass mt-10 rounded-3xl p-6">
          <p className="font-display text-2xl">Check your inbox</p>
          <p className="mt-2 text-sm text-stone">
            We sent a link to <span className="text-charcoal">{email}</span>. Open it on this device.
          </p>
        </div>
      ) : (
        <form onSubmit={send} className="rise rise-3 mt-10 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
          </div>
          {message && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{message}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a link"}
          </Button>
        </form>
      )}
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
