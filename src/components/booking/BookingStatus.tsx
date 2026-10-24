"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BookingView } from "@/lib/bookings";
import { Button, Display, Eyebrow, Money } from "@/components/ui";
import { fmtLong } from "@/renderer/theme";

const STATUS_COPY: Record<BookingView["status"], { title: string; body: string; tone: string }> = {
  pending: { title: "Confirming your payment…", body: "This usually takes a few seconds.", tone: "text-brass" },
  confirmed: { title: "You're booked.", body: "We've saved your spot. A calendar file is below.", tone: "text-success" },
  completed: { title: "Thanks for coming.", body: "We hope to see you again.", tone: "text-charcoal" },
  cancelled: { title: "Booking cancelled.", body: "This slot has been released.", tone: "text-stone" },
  no_show: { title: "Marked as no-show.", body: "Get in touch if that's not right.", tone: "text-stone" },
  refunded: { title: "Refunded.", body: "Your payment is on its way back to you.", tone: "text-success" },
};

export function BookingStatus({ initial, token, timezone, slug, justPaid }: { initial: BookingView; token: string; timezone: string; slug: string; justPaid: boolean }) {
  const [b, setB] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After Stripe redirects back, the webhook may land a moment later: poll while pending.
  useEffect(() => {
    if (b.status !== "pending") return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const r = await fetch(`/api/bookings/${b.id}?token=${token}`);
      if (r.ok) {
        const next = (await r.json()) as BookingView;
        setB(next);
        if (next.status !== "pending") clearInterval(t);
      }
      if (tries > 40) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [b.status, b.id, token]);

  const start = new Date(b.starts_at);
  const deadline = new Date(start.getTime() - b.cancellation_deadline_hours * 3_600_000);
  const canCancel = (b.status === "confirmed" || b.status === "pending") && start.getTime() > Date.now();
  const freeCancel = Date.now() <= deadline.getTime();
  const copy = STATUS_COPY[b.status];

  async function cancel() {
    if (!confirm(freeCancel ? "Cancel this booking? You'll be refunded in full." : "Cancel this booking? It's past the free-cancellation deadline, so no refund will be issued.")) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/bookings/${b.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const body = (await r.json()) as { status?: string; error?: string };
    if (!r.ok) setError(body.error ?? "Could not cancel");
    else setB({ ...b, status: body.status === "refunded" ? "refunded" : "cancelled" });
    setBusy(false);
  }

  return (
    <div className="rise space-y-6">
      <div>
        <Eyebrow className={copy.tone}>{b.status.replace("_", " ")}</Eyebrow>
        <Display className="mt-3 text-5xl md:text-6xl">{copy.title}</Display>
        <p className="mt-3 text-stone">{justPaid && b.status === "pending" ? "Payment received — finalising your booking." : copy.body}</p>
      </div>

      <div className="glass rounded-3xl p-6 md:p-8">
        <p className="font-display text-3xl capitalize">{b.service_key.replace(/-/g, " ")}</p>
        <p className="mt-2 text-lg text-charcoal-2">{fmtLong(b.starts_at, timezone)}</p>
        {b.resources?.length ? <p className="mt-1 text-stone">{b.resources.join(" · ")}</p> : null}
        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-6 text-sm">
          <div>
            <dt className="text-stone">Booked for</dt>
            <dd className="mt-0.5">{b.customer_name}</dd>
          </div>
          <div>
            <dt className="text-stone">Email</dt>
            <dd className="mt-0.5 break-all">{b.customer_email}</dd>
          </div>
          <div>
            <dt className="text-stone">Total</dt>
            <dd className="mt-0.5">
              <Money cents={b.amount_cents} currency={b.currency} />
            </dd>
          </div>
          {b.deposit_cents > 0 && (
            <div>
              <dt className="text-stone">Paid now</dt>
              <dd className="mt-0.5">
                <Money cents={b.deposit_cents} currency={b.currency} />
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {(b.status === "confirmed" || b.status === "pending") && (
          <a href={`/api/bookings/${b.id}/ics?token=${token}`}>
            <Button variant="ghost">Add to calendar</Button>
          </a>
        )}
        {canCancel && (
          <Button variant="quiet" disabled={busy} onClick={() => void cancel()}>
            {busy ? "Cancelling…" : freeCancel ? "Cancel (free)" : "Cancel (no refund)"}
          </Button>
        )}
        <Link href={`/${slug}`} className="ml-auto text-sm text-stone hover:text-charcoal">
          Back to site
        </Link>
      </div>
      {canCancel && <p className="text-xs text-stone">Free cancellation until {fmtLong(deadline.toISOString(), timezone)}.</p>}
      {error && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      <p className="text-xs text-stone-2">Keep this page&apos;s link — it&apos;s how you manage your booking.</p>
    </div>
  );
}
