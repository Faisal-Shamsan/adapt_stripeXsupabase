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
  it("applies basis points", () => {
    expect(platformFee(10000, 250)).toBe(250);
    expect(platformFee(1050, 250)).toBe(26);
    expect(platformFee(0, 250)).toBe(0);
  });
});
