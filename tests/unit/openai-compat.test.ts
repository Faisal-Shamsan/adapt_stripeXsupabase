import { afterEach, describe, expect, it, vi } from "vitest";
import { openAICompatCallModel } from "@/ai/openai-compat";
import { ModelError } from "@/ai/errors";

const cfg = { baseUrl: "https://example.test/v1/", apiKey: "k", model: "m", retryDelayMs: 0 };
const req = { system: "sys", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }] };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) => new Response("<html><h1>Bad gateway</h1></html>", { status, headers: { "content-type": "text/html" } });
const ok = (message: unknown) => json(200, { choices: [{ finish_reason: "stop", message }] });

function stubFetch(responses: Array<Response | Error>) {
  const calls: unknown[] = [];
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    if (!next) throw new Error("fetch called more than scripted");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("openAICompatCallModel", () => {
  it("retries once after an HTML 502 and succeeds", async () => {
    const { fn } = stubFetch([html(502), ok({ content: "hello", tool_calls: [] })]);
    const res = await openAICompatCallModel(cfg)(req);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(res.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("does not retry a 400 and reports the provider message", async () => {
    const { fn } = stubFetch([json(400, { error: { message: "model not found" } })]);
    const err = await openAICompatCallModel(cfg)(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err as ModelError).toMatchObject({ status: 400, retryable: false, detail: "model not found" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("treats a non-JSON 200 as retryable and gives up after two attempts", async () => {
    const { fn } = stubFetch([html(200), html(200)]);
    const err = await openAICompatCallModel(cfg)(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).retryable).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("network failure is retryable", async () => {
    const { fn } = stubFetch([new Error("ECONNRESET"), ok({ content: null, tool_calls: [{ id: "c1", function: { name: "ask_owner", arguments: '{"question":"Days?","chips":["Mon"]}' } }] })]);
    const res = await openAICompatCallModel(cfg)(req);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(res.content).toEqual([{ type: "tool_use", id: "c1", name: "ask_owner", input: { question: "Days?", chips: ["Mon"] } }]);
  });

  it("keeps malformed tool arguments instead of crashing", async () => {
    stubFetch([ok({ content: null, tool_calls: [{ id: "c2", function: { name: "apply_patch", arguments: "{not json" } }] })]);
    const res = await openAICompatCallModel(cfg)(req);
    expect(res.content[0]).toMatchObject({ type: "tool_use", name: "apply_patch", input: { __unparseable: "{not json" } });
  });

  it("sends system, tools and base64 images in OpenAI shape", async () => {
    const { calls } = stubFetch([ok({ content: "ok" })]);
    await openAICompatCallModel(cfg)({
      system: "S",
      messages: [
        { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }, { type: "text", text: "see" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "apply_patch", input: { patch: [] } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"errors\":[]}", is_error: true }] },
      ],
    });
    const body = calls[0] as { messages: Array<Record<string, unknown>>; tools: Array<{ function: { name: string } }> };
    expect(body.tools.map((t) => t.function.name)).toEqual(["ask_owner", "apply_patch"]);
    expect(body.messages[0]).toEqual({ role: "system", content: "S" });
    expect(body.messages[1]).toEqual({ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }, { type: "text", text: "see" }] });
    expect(body.messages[2]).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "t1", function: { name: "apply_patch", arguments: '{"patch":[]}' } }] });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "t1", content: '{"errors":[]}' });
  });
});
