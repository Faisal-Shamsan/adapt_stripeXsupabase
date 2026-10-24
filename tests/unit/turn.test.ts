/**
 * runTurn with recorded model outputs. No network: `script()` returns a CallModel that replays responses in order
 * and records every request so we can assert exactly what the model was sent.
 */
import { describe, expect, it } from "vitest";
import type { CallModel, ModelRequest, ModelResponse, ToolUseBlock } from "@/ai/model";
import { HISTORY_LIMIT, runTurn, type HistoryMessage } from "@/ai/turn";
import { TenantConfig } from "@/engine/schema";
import { presets } from "@/engine/presets";

const padel = TenantConfig.parse(presets.padel);

function script(responses: ModelResponse[]) {
  const requests: ModelRequest[] = [];
  const call: CallModel = async (req) => {
    requests.push(structuredClone(req));
    const next = responses.shift();
    if (!next) throw new Error("model called more times than scripted");
    return next;
  };
  return { call, requests };
}

const toolUse = (name: string, input: unknown, id = "toolu_1"): ToolUseBlock => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text" as const, text: t });
const reply = (...content: ModelResponse["content"]): ModelResponse => ({ content, stopReason: "tool_use" });

describe("runTurn: tool handling", () => {
  it("ask_owner returns the question and chips", async () => {
    const { call, requests } = script([reply(toolUse("ask_owner", { question: "Which days are you open?", chips: ["Mon-Fri", "Every day"] }))]);
    const r = await runTurn({ config: null, history: [], message: "I run a barber shop" }, call);
    expect(r).toEqual({ type: "ask", question: "Which days are you open?", chips: ["Mon-Fri", "Every day"] });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toContain("null (nothing configured yet");
  });

  it("apply_patch with a valid patch returns the new validated config on the first attempt", async () => {
    const { call } = script([
      reply(text("Adding a fifth court."), toolUse("apply_patch", { patch: [{ op: "add", path: "/resources/-", value: { key: "court-5", kind: "court", label: "Court 5" } }], summary: "Added Court 5." })),
    ]);
    const r = await runTurn({ config: padel, history: [], message: "add a fifth court" }, call);
    expect(r).toMatchObject({ type: "patch", summary: "Added Court 5.", attempts: 1 });
    if (r.type === "patch") expect(r.config.resources.map((x) => x.key)).toContain("court-5");
  });

  it("bootstraps a full config from null via root replace", async () => {
    const { call } = script([reply(toolUse("apply_patch", { patch: [{ op: "replace", path: "", value: presets.spa }], summary: "Set up Stillwater Spa." }))]);
    const r = await runTurn({ config: null, history: [], message: "spa with two rooms" }, call);
    expect(r).toMatchObject({ type: "patch", attempts: 1 });
    if (r.type === "patch") expect(r.config.services[0]!.capacityType).toBe("combination");
  });

  it("feeds validation errors back once and accepts the corrected patch", async () => {
    const { call, requests } = script([
      // 1st attempt: capacity 20 bikes but only 12 exist
      reply(toolUse("apply_patch", { patch: [{ op: "replace", path: "/services/0/capacity", value: 20 }], summary: "Bigger class." }, "toolu_a")),
      // 2nd attempt: corrected
      reply(toolUse("apply_patch", { patch: [{ op: "replace", path: "/services/0/capacity", value: 12 }], summary: "Class capacity set to 12." }, "toolu_b")),
    ]);
    const gym = TenantConfig.parse(presets.gym);
    const r = await runTurn({ config: gym, history: [], message: "make spin 45 a 20 person class" }, call);
    expect(r).toMatchObject({ type: "patch", attempts: 2, summary: "Class capacity set to 12." });

    expect(requests).toHaveLength(2);
    const second = requests[1]!.messages;
    expect(second.at(-2)!.role).toBe("assistant");
    const toolResult = second.at(-1)!.content[0]!;
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_a", is_error: true });
    const payload = JSON.parse((toolResult as { content: string }).content);
    expect(payload.stage).toBe("validate");
    expect(payload.errors[0]).toMatchObject({ path: "services.0.capacity", message: expect.stringMatching(/exceeds 12/) });
  });

  it("gives up after the second invalid patch and leaves the config untouched", async () => {
    const { call, requests } = script([
      reply(toolUse("apply_patch", { patch: [{ op: "remove", path: "/resources/0" }, { op: "remove", path: "/resources/0" }, { op: "remove", path: "/resources/0" }, { op: "remove", path: "/resources/0" }], summary: "Removed courts." })),
      reply(toolUse("apply_patch", { patch: [{ op: "replace", path: "/business/timezone", value: "Mars/Olympus" }], summary: "Changed tz." })),
    ]);
    const r = await runTurn({ config: padel, history: [], message: "nonsense" }, call);
    expect(r).toMatchObject({ type: "invalid", attempts: 2 });
    if (r.type === "invalid") expect(r.errors[0]!.path).toBe("business.timezone");
    expect(requests).toHaveLength(2);
    expect(padel.resources).toHaveLength(4);
  });

  it("malformed tool input is treated as an invalid patch and retried", async () => {
    const { call } = script([
      reply(toolUse("apply_patch", { patch: "not an array", summary: "x" })),
      reply(toolUse("apply_patch", { patch: [{ op: "replace", path: "/business/tagline", value: "Game on." }], summary: "New tagline." })),
    ]);
    const r = await runTurn({ config: padel, history: [], message: "tagline: Game on." }, call);
    expect(r).toMatchObject({ type: "patch", attempts: 2 });
  });

  it("plain text replies pass through as a message", async () => {
    const { call } = script([{ content: [text("Happy to help — what kind of business is it?")], stopReason: "end_turn" }]);
    const r = await runTurn({ config: null, history: [], message: "hi" }, call);
    expect(r).toEqual({ type: "message", text: "Happy to help — what kind of business is it?" });
  });

  it("unknown tools never reach the config", async () => {
    const { call } = script([reply(toolUse("run_sql", { sql: "drop table tenants" }))]);
    const r = await runTurn({ config: padel, history: [], message: "x" }, call);
    expect(r.type).toBe("message");
  });
});

describe("runTurn: what the model is sent", () => {
  it("includes the current config in the system prompt and only the last 6 history messages", async () => {
    const history: HistoryMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
    const { call, requests } = script([{ content: [text("ok")], stopReason: "end_turn" }]);
    await runTurn({ config: padel, history, message: "latest" }, call);
    const req = requests[0]!;
    expect(req.system).toContain('"name":"Harbourside Padel"');
    expect(req.messages).toHaveLength(HISTORY_LIMIT + 1);
    expect(req.messages.map((m) => (m.content[0] as { text: string }).text)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9", "latest"]);
  });

  it("attaches images as base64 blocks before the text", async () => {
    const { call, requests } = script([{ content: [text("ok")], stopReason: "end_turn" }]);
    await runTurn({ config: null, history: [], message: "here is my price list", images: [{ mediaType: "image/png", dataBase64: "aGVsbG8=" }] }, call);
    const content = requests[0]!.messages[0]!.content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } });
    expect(content[1]).toEqual({ type: "text", text: "here is my price list" });
  });
});
