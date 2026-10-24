import type { Rules, Service } from "./schema";

export type Charge = { totalCents: number; dueNowCents: number; depositCents: number };

/** Amount the customer pays at checkout. Always derived from stored config, never from the client. */
export function chargeFor(service: Pick<Service, "priceCents">, rules: Pick<Rules, "payment">): Charge {
  const total = service.priceCents;
  if (rules.payment.mode === "full") return { totalCents: total, dueNowCents: total, depositCents: 0 };
  const deposit = Math.round((total * rules.payment.depositPercent) / 100);
  return { totalCents: total, dueNowCents: deposit, depositCents: deposit };
}

export type FeeSchedule = { bps: number; fixedCents: number };

/**
 * Platform application fee on a direct charge. The platform pays Stripe's processing fees
 * (controller.fees.payer = "application"), so the fee has a fixed component.
 * fee = floor(amount * bps / 10000) + fixed, capped at the amount.
 */
export function platformFee(amountCents: number, schedule: FeeSchedule): number {
  if (amountCents <= 0) return 0;
  const fee = Math.floor((amountCents * schedule.bps) / 10_000) + schedule.fixedCents;
  return Math.min(fee, amountCents);
}
