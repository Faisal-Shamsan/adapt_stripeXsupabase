"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Chip, cx, Money } from "@/components/ui";
import { browserSupabase } from "@/lib/supabase/browser";

export type Assumption = { topic: string; value: string; alternatives: string[] };
export type ChatMessage = { role: "user" | "assistant"; text: string; kind?: string; chips?: string[]; images?: number; assumptions?: Assumption[] };

type Tenant = {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  configVersion: number;
  hasConfig: boolean;
  stripe: { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean };
};

type Tab = "chat" | "bookings" | "history";

const STARTERS = ["I run a hair salon with three stylists", "Padel club, 4 courts, open 7am–10pm", "Spin studio with 12 bikes and two instructors", "Spa with two treatment rooms"];

export function Dashboard({ tenant: initialTenant, ownerEmail, initialChat, connect }: { tenant: Tenant; ownerEmail: string; initialChat: ChatMessage[]; connect: "return" | "error" | null }) {
  const [tenant, setTenant] = useState(initialTenant);
  const [tab, setTab] = useState<Tab>("chat");
  const [previewKey, setPreviewKey] = useState(0);
  const refreshPreview = useCallback(() => setPreviewKey((k) => k + 1), []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="glass-strong z-10 flex items-center justify-between gap-4 border-b border-white/60 px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/new" className="font-display text-xl font-semibold">
            Adapt
          </Link>
          <span className="h-5 w-px bg-charcoal/15" />
          <span className="text-sm text-charcoal-2">{tenant.name}</span>
          <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em]", tenant.published ? "bg-success/10 text-success" : "bg-charcoal/5 text-stone")}>{tenant.published ? "Live" : "Draft"}</span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {(["chat", "bookings", "history"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx("tactile rounded-full px-3.5 py-1.5 capitalize", tab === t ? "bg-charcoal text-ivory" : "text-charcoal-2 hover:bg-charcoal/5")}>
              {t}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <StripeButton tenant={tenant} />
          <PublishButton tenant={tenant} onChange={(published) => setTenant({ ...tenant, published })} />
          <form action="/auth/sign-out" method="post">
            <button className="ml-2 text-xs text-stone hover:text-charcoal" title={ownerEmail}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      {connect === "return" && tenant.stripe.chargesEnabled && (
        <p className="bg-success/10 px-5 py-2 text-center text-sm text-success">Payments are on — your customers can book and pay.</p>
      )}
      {connect === "return" && !tenant.stripe.chargesEnabled && (
        <p className="bg-brass/10 px-5 py-2 text-center text-sm text-charcoal-2">Thanks — Stripe is checking your details. Payments switch on automatically when they&apos;re approved.</p>
      )}
      {connect === "error" && (
        <p className="bg-danger/10 px-5 py-2 text-center text-sm text-danger">We couldn&apos;t confirm your Stripe status just now — use &ldquo;Finish Stripe setup&rdquo; to try again.</p>
      )}

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(380px,2fr)_3fr]">
        <section className="flex min-h-0 flex-col border-r border-charcoal/8">
          {tab === "chat" && <Chat tenant={tenant} initial={initialChat} onApplied={(v) => { setTenant((t) => ({ ...t, configVersion: v, hasConfig: true })); refreshPreview(); }} />}
          {tab === "bookings" && <Bookings tenant={tenant} />}
          {tab === "history" && <History tenant={tenant} onRolledBack={(v) => { setTenant((t) => ({ ...t, configVersion: v })); refreshPreview(); }} />}
        </section>
        <section className="relative hidden min-h-0 bg-ivory-2/60 md:block">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
            <span className="glass-strong rounded-full px-3 py-1 text-xs text-charcoal-2">Live preview · v{tenant.configVersion}</span>
            {tenant.published && (
              <a href={`/${tenant.slug}`} target="_blank" className="glass-strong tactile rounded-full px-3 py-1 text-xs text-charcoal hover:bg-white">
                Open /{tenant.slug} ↗
              </a>
            )}
          </div>
          <iframe key={previewKey} src={`/preview/${tenant.id}`} title="Live preview" className="h-full w-full border-0" />
        </section>
      </div>
    </div>
  );
}

/* ---------------- Chat ---------------- */

function Chat({ tenant, initial, onApplied }: { tenant: Tenant; initial: ChatMessage[]; onApplied: (version: number) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ mediaType: string; dataBase64: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; soft: boolean } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const lastChips = messages.at(-1)?.role === "assistant" ? (messages.at(-1)?.chips ?? []) : [];

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sentImages = images;
    setMessages((m) => [...m, { role: "user", text: message, images: sentImages.length || undefined }]);
    setText("");
    setImages([]);
    const payload = { tenantId: tenant.id, message, images: sentImages.map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 })) };
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await r.json()) as {
        type?: string;
        question?: string;
        chips?: string[];
        summary?: string;
        assumptions?: Assumption[];
        text?: string;
        version?: number;
        error?: string;
        code?: string;
      };
      if (!r.ok) {
        // Give the prompt back so it can be resent as-is.
        setMessages((m) => m.slice(0, -1));
        setText(message);
        setImages(sentImages);
        setError({ message: body.error ?? "Something went wrong", soft: body.code === "MODEL_UNAVAILABLE" || r.status === 429 });
        return;
      }
      if (body.type === "patch") {
        setMessages((m) => [...m, { role: "assistant", text: body.summary ?? "Done.", kind: "patch", assumptions: body.assumptions ?? [] }]);
        if (body.version) onApplied(body.version);
      } else if (body.type === "ask") {
        setMessages((m) => [...m, { role: "assistant", text: body.question ?? "", kind: "ask", chips: body.chips }]);
      } else if (body.type === "invalid") {
        setMessages((m) => [...m, { role: "assistant", text: "I couldn't make that into a valid setup. Could you say it differently or add detail?", kind: "invalid" }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: body.text ?? "", kind: "message" }]);
      }
    } catch (e) {
      setMessages((m) => m.slice(0, -1));
      setText(message);
      setImages(sentImages);
      setError({ message: (e as Error).message, soft: true });
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next = await Promise.all(
      Array.from(files)
        .slice(0, 4 - images.length)
        .filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type) && f.size <= 5 * 1024 * 1024)
        .map(
          (f) =>
            new Promise<{ mediaType: string; dataBase64: string; name: string }>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ mediaType: f.type, dataBase64: (reader.result as string).split(",")[1] ?? "", name: f.name });
              reader.readAsDataURL(f);
            }),
        ),
    );
    setImages((cur) => [...cur, ...next]);
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.length === 0 && (
          <div className="rise pt-10">
            <p className="font-display text-3xl">Tell me about {tenant.name}.</p>
            <p className="mt-2 text-sm text-stone">What you offer, your prices, when you&apos;re open, who works there. You can also drop in a photo of your price list or floor plan.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <Chip key={s} onClick={() => void send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx("rise flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div className={cx("max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed", m.role === "user" ? "bg-charcoal text-ivory" : "glass text-charcoal")}>
              {m.kind === "patch" && <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-success">Applied</span>}
              {m.text}
              {m.images ? <span className="mt-1 block text-xs opacity-60">{m.images} image(s)</span> : null}
            </div>
            {m.assumptions && m.assumptions.length > 0 && (
              <Assumptions
                items={m.assumptions}
                disabled={busy}
                onSend={(t) => void send(t)}
                onPrefill={(t) => {
                  setText(t);
                  composer.current?.focus();
                }}
              />
            )}
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="glass flex items-center gap-1.5 rounded-3xl px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className={cx("rise flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm", error.soft ? "bg-brass/10 text-charcoal-2" : "bg-danger/10 text-danger")}>
            <span>{error.message}</span>
            {text.trim() && (
              <button type="button" onClick={() => void send(text)} className="shrink-0 font-medium underline-offset-4 hover:underline">
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t border-charcoal/8 p-4">
        {lastChips.length > 0 && !busy && (
          <div className="mb-3 flex flex-wrap gap-2">
            {lastChips.map((c) => (
              <Chip key={c} onClick={() => void send(c)}>
                {c}
              </Chip>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <span key={i} className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:${img.mediaType};base64,${img.dataBase64}`} alt="" className="h-6 w-6 rounded-full object-cover" />
                {img.name}
                <button onClick={() => setImages(images.filter((_, j) => j !== i))} className="text-stone hover:text-charcoal">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="glass-strong flex items-end gap-2 rounded-3xl p-2"
        >
          <button type="button" onClick={() => fileInput.current?.click()} className="tactile grid h-10 w-10 shrink-0 place-items-center rounded-full text-stone hover:bg-charcoal/5 hover:text-charcoal" title="Attach a photo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="m21 16-5-4-8 7" />
            </svg>
          </button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          <textarea
            ref={composer}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={1}
            placeholder={tenant.hasConfig ? "Change something… e.g. “add Sunday classes”" : "Describe your business…"}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-stone-2"
          />
          <Button type="submit" size="sm" disabled={busy || (!text.trim() && images.length === 0)} className="h-10 rounded-full px-4">
            Send
          </Button>
        </form>
      </div>
    </>
  );
}

/**
 * "What I assumed": every default the model filled in, as one-tap corrections.
 * Tap a chip → its alternatives appear and send a ready-made change; with no alternatives the composer is pre-filled.
 */
function Assumptions({ items, disabled, onSend, onPrefill }: { items: Assumption[]; disabled: boolean; onSend: (text: string) => void; onPrefill: (text: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const topicWord = (t: string) => t.trim().toLowerCase();
  return (
    <div className="mt-2 max-w-[85%]">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-stone">What I assumed — tap to change</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((a, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (a.alternatives.length) setOpen(open === i ? null : i);
              else onPrefill(`Change the ${topicWord(a.topic)} from ${a.value} to `);
            }}
            className={cx(
              "tactile glass flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-xs hover:bg-white/80 disabled:opacity-50",
              open === i && "bg-white ring-2 ring-accent/30",
            )}
          >
            <span className="text-stone">{a.topic}</span>
            <span className="font-medium text-charcoal">{a.value}</span>
          </button>
        ))}
      </div>
      {open !== null && items[open] && (
        <div className="rise mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-stone">Instead:</span>
          {items[open].alternatives.map((alt) => (
            <Chip
              key={alt}
              className="h-8 text-xs"
              disabled={disabled}
              onClick={() => {
                setOpen(null);
                onSend(`Change the ${topicWord(items[open]!.topic)} to ${alt}`);
              }}
            >
              {alt}
            </Chip>
          ))}
          <button
            type="button"
            className="text-xs text-stone underline-offset-4 hover:underline"
            onClick={() => {
              setOpen(null);
              onPrefill(`Change the ${topicWord(items[open]!.topic)} from ${items[open]!.value} to `);
            }}
          >
            something else…
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Bookings ---------------- */

type OwnerBooking = { id: string; service_key: string; status: string; source: string; starts_at: string; ends_at: string; amount_cents: number; currency: string; customer_name: string; customer_email: string; resources: string[] | null };

function Bookings({ tenant }: { tenant: Tenant }) {
  const [rows, setRows] = useState<OwnerBooking[] | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/tenants/${tenant.id}/bookings`);
    if (r.ok) setRows(((await r.json()) as { bookings: OwnerBooking[] }).bookings);
  }, [tenant.id]);

  useEffect(() => {
    void load();
    // Realtime: owner is subscribed under RLS; any change on this tenant's bookings refreshes the list.
    const sb = browserSupabase();
    const ch = sb
      .channel(`bookings-${tenant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `tenant_id=eq.${tenant.id}` }, () => void load())
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [tenant.id, load]);

  const tone: Record<string, string> = { pending: "text-brass", confirmed: "text-success", cancelled: "text-stone", refunded: "text-stone", completed: "text-charcoal", no_show: "text-danger" };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="font-display text-3xl">Bookings</p>
        <span className="text-xs text-stone">updates live</span>
      </div>
      {rows === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <p className="glass rounded-2xl px-5 py-6 text-sm text-stone">No bookings yet. Share /{tenant.slug} once you&apos;re live.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => (
            <li key={b.id} className="glass rise rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {b.customer_name} <span className="text-stone">· {b.service_key.replace(/-/g, " ")}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-charcoal-2">
                    {new Date(b.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {b.resources?.length ? <span className="text-stone"> · {b.resources.join(", ")}</span> : null}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">
                    <Money cents={b.amount_cents} currency={b.currency} />
                  </p>
                  <p className={cx("mt-0.5 text-xs capitalize", tone[b.status])}>
                    {b.status.replace("_", " ")}
                    {b.source !== "online" && <span className="text-stone"> · {b.source.replace("_", "-")}</span>}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- History ---------------- */

type Version = { version: number; source: string; prompt: string | null; created_at: string };

function History({ tenant, onRolledBack }: { tenant: Tenant; onRolledBack: (version: number) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/tenants/${tenant.id}/versions`);
    if (r.ok) setVersions(((await r.json()) as { versions: Version[] }).versions);
  }, [tenant.id]);
  useEffect(() => {
    void load();
  }, [load, tenant.configVersion]);

  async function rollback(v: number) {
    if (!confirm(`Restore version ${v}? This creates a new version — nothing is lost.`)) return;
    setBusy(v);
    const r = await fetch(`/api/tenants/${tenant.id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: v }) });
    if (r.ok) onRolledBack(((await r.json()) as { version: number }).version);
    setBusy(null);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <p className="font-display mb-4 text-3xl">History</p>
      {versions === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-2xl" />)}</div>
      ) : versions.length === 0 ? (
        <p className="glass rounded-2xl px-5 py-6 text-sm text-stone">Every change you make appears here and can be restored.</p>
      ) : (
        <ol className="space-y-2">
          {versions.map((v) => (
            <li key={v.version} className="glass rise flex items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">v{v.version}</span>
                  <span className="ml-2 rounded-full bg-charcoal/5 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-stone">{v.source}</span>
                </p>
                <p className="mt-0.5 truncate text-sm text-charcoal-2">{v.prompt ?? "—"}</p>
                <p className="mt-0.5 text-xs text-stone">{new Date(v.created_at).toLocaleString("en-GB")}</p>
              </div>
              {v.version !== tenant.configVersion && (
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void rollback(v.version)}>
                  {busy === v.version ? "Restoring…" : "Restore"}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------------- Header actions ---------------- */

function PublishButton({ tenant, onChange }: { tenant: Tenant; onChange: (published: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/tenants/${tenant.id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: !tenant.published }) });
    const body = (await r.json()) as { published?: boolean; error?: string };
    if (r.ok) onChange(!!body.published);
    else setErr(body.error ?? "failed");
    setBusy(false);
  }
  return (
    <div className="relative">
      <Button size="sm" variant={tenant.published ? "ghost" : "primary"} disabled={busy || !tenant.hasConfig} onClick={() => void toggle()} title={!tenant.hasConfig ? "Describe your business first" : undefined}>
        {busy ? "…" : tenant.published ? "Unpublish" : "Publish"}
      </Button>
      {err && <p className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs text-danger">{err}</p>}
    </div>
  );
}

function StripeButton({ tenant }: { tenant: Tenant }) {
  const s = tenant.stripe;
  if (s.chargesEnabled && s.detailsSubmitted) {
    return (
      <a href={`/api/connect/payouts?tenant=${tenant.id}`} className="tactile glass rounded-full px-4 py-2 text-sm text-charcoal hover:bg-white/80">
        View payouts
      </a>
    );
  }
  return (
    <a href={`/api/connect/onboard?tenant=${tenant.id}`} className="tactile glass rounded-full px-4 py-2 text-sm text-charcoal hover:bg-white/80">
      {s.connected ? "Finish Stripe setup" : "Connect Stripe"}
    </a>
  );
}
