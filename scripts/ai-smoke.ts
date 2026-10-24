// Live round-trip against Anthropic: bootstrap a config from one sentence, then make a change.
import { config } from "dotenv";
config({ path: ".env.local" });

import { anthropicCallModel } from "../src/ai/model";
import { runTurn, type HistoryMessage } from "../src/ai/turn";

async function main() {
  const t0 = Date.now();
  const first = await runTurn(
    { config: null, history: [], message: "I run Harbourside Padel in Bristol: 4 courts, open 7am to 10pm every day, £32 per hour, people book online and pay in full." },
    anthropicCallModel,
  );
  console.log(`turn 1 (${Date.now() - t0}ms):`, first.type, first.type === "patch" ? `${first.summary} [attempts=${first.attempts}]` : JSON.stringify(first).slice(0, 300));
  if (first.type !== "patch") return;
  console.log("  services:", first.config.services.map((s) => `${s.key} ${s.capacityType} ${s.durationMin}min £${s.priceCents / 100}`));
  console.log("  resources:", first.config.resources.map((r) => `${r.key}:${r.kind}`).join(", "));
  console.log("  hours mon:", JSON.stringify(first.config.schedules.business.mon), "tz:", first.config.business.timezone, "payment:", JSON.stringify(first.config.rules.payment));

  const history: HistoryMessage[] = [
    { role: "user", text: "I run Harbourside Padel in Bristol: 4 courts, open 7am to 10pm every day, £32 per hour." },
    { role: "assistant", text: `Applied change: ${first.summary}` },
  ];
  const t1 = Date.now();
  const second = await runTurn({ config: first.config, history, message: "Court 1 and 2 are indoor. Add a 90 minute option for £45 and take a 50% deposit." }, anthropicCallModel);
  console.log(`turn 2 (${Date.now() - t1}ms):`, second.type, second.type === "patch" ? `${second.summary} [attempts=${second.attempts}]` : JSON.stringify(second).slice(0, 300));
  if (second.type === "patch") {
    console.log("  services:", second.config.services.map((s) => `${s.key} ${s.durationMin}min £${s.priceCents / 100}`));
    console.log("  labels:", second.config.resources.map((r) => r.label).join(" | "), "payment:", JSON.stringify(second.config.rules.payment));
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
