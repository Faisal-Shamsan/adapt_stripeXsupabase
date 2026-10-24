import { describe, expect, it } from "vitest";
import { chargeFor, platformFee } from "@/engine/pricing";

describe("chargeFor", () => {
  it("full payment charges the whole price", () => {
    expect(chargeFor({ priceCents: 4200 }, { payment: { mode: "full" } })).toEqual({ totalCents: 4200, dueNowCents: 4200, depositCents: 0 });
  });

  it("deposit rounds to the nearest penny", () => {
    expect(chargeFor({ priceCents: 4201 }, { payment: { mode: "deposit", depositPercent: 25 } })).toEqual({
      totalCents: 4201,
      dueNowCents: 1050,
      depositCents: 1050,
    });
  });
});

describe("platformFee", () => {
  const schedule = { bps: 300, fixedCents: 25 };

  it("is floor(amount * bps) + fixed", () => {
    expect(platformFee(10000, schedule)).toBe(325);
    expect(platformFee(1050, schedule)).toBe(31 + 25); // floor(31.5) + 25
    expect(platformFee(33, schedule)).toBe(0 + 25);
  });

  it("never exceeds the amount", () => {
    expect(platformFee(10, schedule)).toBe(10);
    expect(platformFee(25, schedule)).toBe(25);
  });

  it("is zero for a zero amount", () => {
    expect(platformFee(0, schedule)).toBe(0);
  });
});
