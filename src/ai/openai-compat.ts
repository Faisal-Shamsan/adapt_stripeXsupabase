import { TOOLS } from "./tools";
import type { CallModel, ModelMessage, ModelRequest, ModelResponse, TextBlock, ToolUseBlock } from "./model";

/**
 * OpenAI-compatible chat.completions adapter (used for Nebius Token Factory). Translates our block-based
 * messages to OpenAI shape and back; tool calls become ToolUseBlocks with parsed JSON arguments.
 */
export type OpenAICompatConfig = { baseUrl: string; apiKey: string; model: string };

type OAContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
type OAMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: OAContent }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAI(req: ModelRequest): OAMessage[] {
  const out: OAMessage[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) out.push(...convert(m));
  return out;
}

function convert(m: ModelMessage): OAMessage[] {
  if (m.role === "assistant") {
    const text = m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n");
    const calls = m.content
      .filter((b): b is ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
    return [{ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }];
  }
  // user: tool results must be separate `tool` messages; text/images form a normal user message
  const out: OAMessage[] = [];
  const parts: Exclude<OAContent, string> = [];
  for (const b of m.content) {
    if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
    else if (b.type === "text") parts.push({ type: "text", text: b.text });
    else if (b.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
  }
  if (parts.length) out.push({ role: "user", content: parts });
  return out;
}

type OAResponse = {
  choices: Array<{
    finish_reason: string | null;
    message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  }>;
  error?: { message: string };
};

export function openAICompatCallModel(cfg: OpenAICompatConfig): CallModel {
  return async (req) => {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: toOpenAI(req),
        tools: TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
    const body = (await res.json()) as OAResponse;
    if (!res.ok) throw new Error(`model request failed (${res.status}): ${body.error?.message ?? "unknown error"}`);
    const choice = body.choices[0];
    if (!choice) throw new Error("model returned no choices");

    const content: ModelResponse["content"] = [];
    if (choice.message.content) content.push({ type: "text", text: choice.message.content });
    for (const c of choice.message.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = { __unparseable: c.function.arguments };
      }
      content.push({ type: "tool_use", id: c.id, name: c.function.name, input });
    }
    return { content, stopReason: choice.finish_reason };
  };
}
