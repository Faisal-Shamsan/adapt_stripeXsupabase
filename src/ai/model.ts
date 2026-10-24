import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { TOOLS } from "./tools";

export type ImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; dataBase64: string };

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: ImageInput["mediaType"]; data: string } };

export type ModelMessage = { role: "user" | "assistant"; content: Array<TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock> };

export type ModelRequest = { system: string; messages: ModelMessage[] };
export type ModelResponse = { content: Array<TextBlock | ToolUseBlock>; stopReason: string | null };

/** The only seam between the turn logic and the network. Tests supply a scripted implementation. */
export type CallModel = (req: ModelRequest) => Promise<ModelResponse>;

let client: Anthropic | null = null;

export const anthropicCallModel: CallModel = async (req) => {
  if (!client) {
    const key = env().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
    client = new Anthropic({ apiKey: key });
  }
  const res = await client.messages.create({
    model: env().ANTHROPIC_MODEL,
    max_tokens: 8192,
    system: req.system,
    tools: TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: "auto" },
    messages: req.messages as Anthropic.MessageParam[],
  });
  const content = res.content.flatMap((b): Array<TextBlock | ToolUseBlock> => {
    if (b.type === "text") return [{ type: "text", text: b.text }];
    if (b.type === "tool_use") return [{ type: "tool_use", id: b.id, name: b.name, input: b.input }];
    return [];
  });
  return { content, stopReason: res.stop_reason };
};
