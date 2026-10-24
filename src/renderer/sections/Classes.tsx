import Link from "next/link";
import type { TenantConfig } from "@/engine/schema";
import { Display, Eyebrow, Money } from "@/components/ui";
import { fmtDay, fmtTime } from "../theme";

export type SessionView = {
  id: string;
  serviceKey: string;
  startsAt: string;
  endsAt: string;
  instructor: string | null;
  capacity: number;
  spotsLeft: number;
  spotKind: string | null;
};

export function Classes({ config, slug, currency, timezone, sessions }: { config: TenantConfig; slug: string; currency: string; timezone: string; sessions: SessionView[] }) {
  const byKey = new Map(config.services.map((s) => [s.key, s]));
  const upcoming = sessions.slice(0, 12);
  const days = new Map<string, SessionView[]>();
  for (const s of upcoming) {
    const d = fmtDay(s.startsAt, timezone);
    days.set(d, [...(days.get(d) ?? []), s]);
  }
  return (
    <section id="classes">
      <Eyebrow>Timetable</Eyebrow>
      <Display as="h2" className="mt-3 text-4xl md:text-5xl">
        Upcoming classes
      </Display>
      {upcoming.length === 0 ? (
        <p className="glass mt-10 rounded-3xl p-8 text-stone">No classes scheduled in the next two weeks.</p>
      ) : (
        <div className="mt-10 space-y-8">
          {[...days.entries()].map(([day, list]) => (
            <div key={day}>
              <p className="mb-3 text-sm font-medium text-stone">{day}</p>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {list.map((s) => {
                  const svc = byKey.get(s.serviceKey);
                  const full = s.spotsLeft <= 0;
                  return (
                    <li key={s.id}>
                      <Link
                        href={full ? "#" : `/${slug}/book?session=${s.id}`}
                        aria-disabled={full}
                        className={`tactile glass flex items-center justify-between gap-4 rounded-2xl px-5 py-4 ${full ? "pointer-events-none opacity-50" : "hover:bg-white/70"}`}
                      >
                        <div>
                          <p className="font-display text-2xl leading-none">{fmtTime(s.startsAt, timezone)}</p>
                          <p className="mt-1.5 text-sm text-charcoal-2">
                            {svc?.name ?? s.serviceKey}
                            {s.instructor && <span className="text-stone"> · {s.instructor}</span>}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          {svc && (
                            <p className="font-medium">
                              <Money cents={svc.priceCents} currency={currency} />
                            </p>
                          )}
                          <p className={`mt-1 text-xs ${full ? "text-danger" : s.spotsLeft <= 3 ? "text-brass" : "text-stone"}`}>{full ? "Full" : `${s.spotsLeft} left`}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
