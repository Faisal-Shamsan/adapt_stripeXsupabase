"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TenantConfig, Service } from "@/engine/schema";
import type { PublicResource } from "@/lib/tenant";
import { Button, Chip, Display, Eyebrow, Input, Label, Money, cx } from "@/components/ui";
import { fmtDay, fmtTime, localDate } from "@/renderer/theme";
import { FloorPlanMap, type Spot } from "./FloorPlanMap";

type Slot = { startsAt: string; endsAt: string; candidates: Record<string, PublicResource[]> };
type Session = { id: string; serviceKey: string; startsAt: string; endsAt: string; instructor: string | null; capacity: number; spotsLeft: number; spotKind: string | null; freeSpots: PublicResource[] | null };

type Props = {
  slug: string;
  config: TenantConfig;
  currency: string;
  timezone: string;
  resources: PublicResource[];
  canPay: boolean;
  initialService: string | null;
  initialSession: string | null;
};

type Step = "service" | "when" | "details";

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `request failed (${r.status})`);
  return body;
};

export function BookingFlow(p: Props) {
  const services = p.config.services;
  const [serviceKey, setServiceKey] = useState<string | null>(p.initialService ?? (p.initialSession ? null : services.length === 1 ? services[0]!.key : null));
  const [sessionId, setSessionId] = useState<string | null>(p.initialSession);
  const service = useMemo(() => services.find((s) => s.key === serviceKey) ?? null, [services, serviceKey]);

  const [date, setDate] = useState(() => localDate(new Date(), p.timezone));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [pref, setPref] = useState<string | null>(null); // preferred resource id (list/map)
  const [spot, setSpot] = useState<string | null>(null); // class spot
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClass = service?.capacityType === "class_with_spots" || (!service && !!sessionId);
  const step: Step = !service && !sessionId ? "service" : isClass ? (sessionId ? "details" : "when") : slot ? "details" : "when";

  // Load slots for a non-class service
  useEffect(() => {
    if (!service || service.capacityType === "class_with_spots") return;
    let live = true;
    setSlots(null);
    setSlot(null);
    api<{ slots: Slot[] }>(`/api/public/${p.slug}/availability?service=${service.key}&date=${date}`)
      .then((r) => live && setSlots(r.slots))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [service, date, p.slug]);

  // Load sessions for class services (or when arriving with a session id)
  useEffect(() => {
    if (!isClass) return;
    let live = true;
    api<{ sessions: Session[] }>(`/api/public/${p.slug}/sessions?days=21`)
      .then((r) => {
        if (!live) return;
        setSessions(r.sessions);
        if (sessionId && !serviceKey) {
          const s = r.sessions.find((x) => x.id === sessionId);
          if (s) setServiceKey(s.serviceKey);
        }
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [isClass, p.slug, sessionId, serviceKey]);

  const session = sessions?.find((s) => s.id === sessionId) ?? null;

  const pickableKind = useMemo(() => {
    if (!service || service.capacityType === "class_with_spots") return null;
    // Customer picks among the first required kind that has a label worth choosing (staff, court, room...).
    return service.requires[0]?.kind ?? null;
  }, [service]);

  const dates = useMemo(() => {
    const out: string[] = [];
    const max = p.config.rules.maxAdvanceDays;
    for (let i = 0; i < Math.min(max, 14); i++) out.push(localDate(new Date(Date.now() + i * 86_400_000), p.timezone));
    return out;
  }, [p.config.rules.maxAdvanceDays, p.timezone]);

  const visibleSlots = useMemo(() => {
    if (!slots) return null;
    if (!pref || !pickableKind) return slots;
    return slots.filter((s) => s.candidates[pickableKind]?.some((r) => r.id === pref));
  }, [slots, pref, pickableKind]);

  const candidatesForKind = useMemo(() => {
    if (!slots || !pickableKind) return [];
    const seen = new Map<string, PublicResource>();
    for (const s of slots) for (const r of s.candidates[pickableKind] ?? []) seen.set(r.id, r);
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [slots, pickableKind]);

  const submit = useCallback(async () => {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        service.capacityType === "class_with_spots"
          ? { kind: "class", tenantSlug: p.slug, sessionId, spot, email, name, phone: phone || undefined }
          : { kind: "slot", tenantSlug: p.slug, serviceKey: service.key, startsAt: slot!.startsAt, resourcePrefs: pref ? [pref] : [], email, name, phone: phone || undefined };
      const b = await api<{ bookingId: string; token: string; dueNowCents: number }>("/api/bookings", { method: "POST", body: JSON.stringify(body) });
      const c = await api<{ url: string }>("/api/checkout", { method: "POST", body: JSON.stringify({ bookingId: b.bookingId, token: b.token }) });
      window.location.href = c.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [service, p.slug, sessionId, spot, email, name, phone, slot, pref]);

  const due = service ? (p.config.rules.payment.mode === "deposit" ? Math.round((service.priceCents * p.config.rules.payment.depositPercent) / 100) : service.priceCents) : 0;

  return (
    <div className="pt-6 md:pt-12">
      <Steps current={step} />

      {step === "service" && (
        <section className="rise mt-8">
          <Eyebrow>Step 1</Eyebrow>
          <Display as="h2" className="mt-3 text-4xl md:text-5xl">
            What would you like to book?
          </Display>
          <ul className="mt-8 grid gap-3">
            {services.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => setServiceKey(s.key)} className="tactile glass flex w-full items-center justify-between rounded-2xl px-6 py-5 text-left hover:bg-white/70">
                  <div>
                    <p className="font-display text-2xl">{s.name}</p>
                    <p className="mt-1 text-sm text-stone">
                      {s.durationMin} min{s.capacityType === "class_with_spots" ? " · class" : ""}
                    </p>
                  </div>
                  <span className="font-medium">
                    <Money cents={s.priceCents} currency={p.currency} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "when" && service && !isClass && (
        <section className="rise mt-8 space-y-8">
          <div>
            <Eyebrow>Step 2 · {service.name}</Eyebrow>
            <Display as="h2" className="mt-3 text-4xl md:text-5xl">
              Pick a time
            </Display>
          </div>

          {pickableKind && p.config.ui.resourcePicker !== "auto" && candidatesForKind.length > 1 && (
            <div>
              <Label>{pickableKind === "staff" ? "With" : "Where"}</Label>
              {p.config.ui.resourcePicker === "map" && p.config.ui.floorPlanImage ? (
                <FloorPlanMap
                  image={p.config.ui.floorPlanImage}
                  spots={p.resources
                    .filter((r) => r.kind === pickableKind && r.position)
                    .map((r): Spot => ({ id: r.id, label: r.label, position: r.position!, state: pref === r.id ? "selected" : candidatesForKind.some((c) => c.id === r.id) ? "free" : "taken" }))}
                  onSelect={(id) => setPref(pref === id ? null : id)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Chip active={pref === null} onClick={() => setPref(null)}>
                    Anyone
                  </Chip>
                  {candidatesForKind.map((r) => (
                    <Chip key={r.id} active={pref === r.id} onClick={() => setPref(r.id)}>
                      {r.label}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Day</Label>
            <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
              {dates.map((d) => (
                <Chip key={d} active={d === date} onClick={() => setDate(d)} className="shrink-0">
                  {fmtDay(`${d}T12:00:00Z`, "UTC")}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <Label>Time</Label>
            {visibleSlots === null ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="skeleton h-11 rounded-full" />
                ))}
              </div>
            ) : visibleSlots.length === 0 ? (
              <p className="glass rounded-2xl px-5 py-4 text-sm text-stone">Nothing available that day — try another.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {visibleSlots.map((s) => (
                  <button key={s.startsAt} type="button" onClick={() => setSlot(s)} className="tactile glass h-11 rounded-full text-sm font-medium tabular-nums hover:bg-white/80">
                    {fmtTime(s.startsAt, p.timezone)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="text-sm text-stone hover:text-charcoal" onClick={() => setServiceKey(null)}>
            ← Different service
          </button>
        </section>
      )}

      {step === "when" && isClass && (
        <section className="rise mt-8 space-y-6">
          <div>
            <Eyebrow>Step 2 · {service?.name}</Eyebrow>
            <Display as="h2" className="mt-3 text-4xl md:text-5xl">
              Pick a class
            </Display>
          </div>
          {!sessions ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-2xl" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {sessions
                .filter((s) => s.serviceKey === service?.key && s.spotsLeft > 0)
                .map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSessionId(s.id)} className="tactile glass flex w-full items-center justify-between rounded-2xl px-6 py-4 text-left hover:bg-white/70">
                      <span>
                        <span className="font-display text-2xl">{fmtTime(s.startsAt, p.timezone)}</span>
                        <span className="ml-3 text-sm text-stone">{fmtDay(s.startsAt, p.timezone)}</span>
                        {s.instructor && <span className="ml-3 text-sm text-charcoal-2">with {s.instructor}</span>}
                      </span>
                      <span className="text-sm text-stone">{s.spotsLeft} left</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {step === "details" && service && (
        <section className="rise mt-8 space-y-8">
          <div>
            <Eyebrow>Step 3</Eyebrow>
            <Display as="h2" className="mt-3 text-4xl md:text-5xl">
              Your details
            </Display>
          </div>

          <div className="glass rounded-3xl p-6">
            <p className="font-display text-2xl">{service.name}</p>
            <p className="mt-1 text-charcoal-2">{isClass && session ? fmtLongish(session.startsAt, p.timezone) : slot ? fmtLongish(slot.startsAt, p.timezone) : ""}</p>
            {pref && <p className="mt-1 text-sm text-stone">{p.resources.find((r) => r.id === pref)?.label}</p>}
            <div className="mt-4 flex items-baseline justify-between border-t border-charcoal/10 pt-4">
              <span className="text-sm text-stone">{p.config.rules.payment.mode === "deposit" ? `${p.config.rules.payment.depositPercent}% deposit now` : "Pay now"}</span>
              <span className="font-display text-3xl">
                <Money cents={due} currency={p.currency} />
              </span>
            </div>
          </div>

          {isClass && session?.spotKind && p.config.ui.floorPlanImage && (
            <div>
              <Label>Choose your {session.spotKind}</Label>
              <FloorPlanMap
                image={p.config.ui.floorPlanImage}
                spots={p.resources
                  .filter((r) => r.kind === session.spotKind && r.position)
                  .map((r): Spot => ({ id: r.id, label: r.label, position: r.position!, state: spot === r.id ? "selected" : session.freeSpots?.some((f) => f.id === r.id) ? "free" : "taken" }))}
                onSelect={setSpot}
              />
            </div>
          )}
          {isClass && session?.spotKind && !p.config.ui.floorPlanImage && (
            <div>
              <Label>Choose your {session.spotKind}</Label>
              <div className="flex flex-wrap gap-2">
                {session.freeSpots?.map((r) => (
                  <Chip key={r.id} active={spot === r.id} onClick={() => setSpot(r.id)}>
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </div>
            {error && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
            {!p.canPay && <p className="rounded-2xl bg-brass/10 px-4 py-3 text-sm text-charcoal-2">This business isn&apos;t taking online payments yet.</p>}
            <Button type="submit" size="lg" disabled={busy || !p.canPay || (isClass && !!session?.spotKind && !spot)} className="mt-2">
              {busy ? "One moment…" : "Continue to payment"}
            </Button>
            <p className="text-center text-xs text-stone">Your spot is held for 31 minutes while you pay. Cancel free up to {p.config.rules.cancellationDeadlineHours}h before.</p>
          </form>
          <button
            type="button"
            className="text-sm text-stone hover:text-charcoal"
            onClick={() => {
              setSlot(null);
              setSessionId(null);
              setSpot(null);
            }}
          >
            ← Change time
          </button>
        </section>
      )}
    </div>
  );
}

function fmtLongish(iso: string, tz: string) {
  return `${fmtDay(iso, tz)} · ${fmtTime(iso, tz)}`;
}

function Steps({ current }: { current: Step }) {
  const steps: Step[] = ["service", "when", "details"];
  const labels = { service: "Service", when: "Time", details: "Details" };
  const idx = steps.indexOf(current);
  return (
    <ol className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em]">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cx("transition-colors duration-300", i <= idx ? "text-charcoal" : "text-stone-2")}>{labels[s]}</span>
          {i < steps.length - 1 && <span className={cx("h-px w-8 transition-colors duration-300", i < idx ? "bg-charcoal" : "bg-charcoal/15")} />}
        </li>
      ))}
    </ol>
  );
}

export type { Service };
