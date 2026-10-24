import type { Rules, Service } from "./schema";

export type Charge = { totalCents: number; dueNowCents: number; depositCents: number };

/** Amount the customer pays at checkout. Always derived from stored config, never from the client. */
export function chargeFor(service: Pick<Service, "priceCents">, rules: Pick<Rules, "payment">): Charge {
  const total = service.priceCents;
  if (rules.payment.mode === "full") return { totalCents: total, dueNowCents: total, depositCents: 0 };
  const deposit = Math.round((total * rules.payment.depositPercent) / 100);
  return { totalCents: total, dueNowCents: deposit, depositCents: deposit };
}

export function platformFee(amountCents: number, feeBps: number): number {
  return Math.round((amountCents * feeBps) / 10_000);
}
