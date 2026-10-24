import { z } from "zod";

export const ASK_OWNER = "ask_owner";
export const APPLY_PATCH = "apply_patch";

export const AskOwnerInput = z.object({
  question: z.string().min(1).max(600),
  chips: z.array(z.string().min(1).max(60)).max(6).default([]),
});
export type AskOwnerInput = z.infer<typeof AskOwnerInput>;

export const Assumption = z.object({
  topic: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(80),
  alternatives: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
});
export type Assumption = z.infer<typeof Assumption>;

export const ApplyPatchInput = z.object({
  patch: z.array(z.record(z.unknown())).min(1).max(200),
  summary: z.string().min(1).max(300),
  assumptions: z.array(Assumption).max(8).default([]),
});
export type ApplyPatchInput = z.infer<typeof ApplyPatchInput>;

/** Anthropic tool definitions. The model has exactly these two tools, nothing else. */
export const TOOLS = [
  {
    name: ASK_OWNER,
    description:
      "Ask the owner one short question when information needed for the config is missing or ambiguous. Offer quick-reply chips when the answer is a choice. Never ask about things you can reasonably default.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One clear question, plain language, no jargon." },
        chips: { type: "array", items: { type: "string" }, maxItems: 6, description: "Optional quick replies, 1-4 words each." },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: APPLY_PATCH,
    description:
      "Change the business configuration with an RFC 6902 JSON Patch against the current config. When no config exists yet, use a single {op:'replace', path:'', value:<full config>}. The server validates the result and returns errors you must fix.",
    input_schema: {
      type: "object",
      properties: {
        patch: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["add", "remove", "replace", "move", "copy", "test"] },
              path: { type: "string" },
              from: { type: "string" },
              value: {},
            },
            required: ["op", "path"],
          },
        },
        summary: { type: "string", description: "One sentence for the owner describing what changed." },
        assumptions: {
          type: "array",
          maxItems: 8,
          description:
            "Every default you filled in that the owner did NOT state (timezone, currency, payment mode, notice, cancellation, hours you guessed, style...). Omit anything the owner said explicitly. The owner sees these as one-tap correction chips.",
          items: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Short label, e.g. 'Timezone', 'Deposit', 'Cancellation'." },
              value: { type: "string", description: "What you chose, in plain words, e.g. 'Europe/London', 'Pay in full', '24 hours'." },
              alternatives: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 likely alternatives, phrased as values, e.g. ['Europe/Berlin', 'Europe/Paris']." },
            },
            required: ["topic", "value"],
          },
        },
      },
      required: ["patch", "summary"],
      additionalProperties: false,
    },
  },
] as const;
