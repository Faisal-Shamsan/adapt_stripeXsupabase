import type { TenantConfig } from "@/engine/schema";
import { applyConfigPatch, type JsonPatch } from "@/engine/patch";
import type { ConfigIssue } from "@/engine/schema";
import { systemPrompt } from "./system-prompt";
import { APPLY_PATCH, ASK_OWNER, ApplyPatchInput, AskOwnerInput, type Assumption } from "./tools";
import type { CallModel, ImageInput, ModelMessage, ToolUseBlock } from "./model";

export const HISTORY_LIMIT = 6;
export const MAX_ATTEMPTS = 2;

/** Stored chat history, already reduced to text. */
export type HistoryMessage = { role: "user" | "assistant"; text: string };

export type TurnInput = {
  config: TenantConfig | null;
  history: HistoryMessage[];
  message: string;
  images?: ImageInput[];
};

export type TurnResult =
  | { type: "ask"; question: string; chips: string[] }
  | { type: "patch"; config: TenantConfig; patch: JsonPatch; summary: string; assumptions: Assumption[]; attempts: number }
  | { type: "message"; text: string }
  | { type: "invalid"; errors: ConfigIssue[]; attempts: number };

function userContent(message: string, images: ImageInput[] | undefined): ModelMessage["content"] {
  const blocks: ModelMessage["content"] = (images ?? []).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.dataBase64 },
  }));
  blocks.push({ type: "text", text: message });
  return blocks;
}

const toolUses = (content: Array<{ type: string }>): ToolUseBlock[] => content.filter((b): b is ToolUseBlock => b.type === "tool_use");
const textOf = (content: Array<{ type: string }>): string =>
  content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * One owner turn. Sends system prompt (with current config) + the last HISTORY_LIMIT messages + this message.
 * apply_patch is applied and validated server-side; on failure the errors go back to the model exactly once.
 */
export async function runTurn(input: TurnInput, callModel: CallModel): Promise<TurnResult> {
  const system = systemPrompt(input.config);
  const history: ModelMessage[] = input.history.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: [{ type: "text", text: m.text }] }));
  const messages: ModelMessage[] = [...history, { role: "user", content: userContent(input.message, input.images) }];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callModel({ system, messages });
    const uses = toolUses(res.content);
    const tool = uses[0];

    if (!tool) {
      const text = textOf(res.content);
      return { type: "message", text: text || "I didn't catch that — could you say a bit more about your business?" };
    }

    if (tool.name === ASK_OWNER) {
      const parsed = AskOwnerInput.safeParse(tool.input);
      if (parsed.success) return { type: "ask", question: parsed.data.question, chips: parsed.data.chips };
      return { type: "message", text: textOf(res.content) || "Could you tell me a bit more?" };
    }

    if (tool.name !== APPLY_PATCH) {
      return { type: "message", text: textOf(res.content) || "Let's try that another way — what would you like to set up?" };
    }

    const parsed = ApplyPatchInput.safeParse(tool.input);
    const result = parsed.success
      ? applyConfigPatch(input.config, parsed.data.patch)
      : ({ ok: false, stage: "patch", errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } as const);

    if (result.ok) {
      return {
        type: "patch",
        config: result.config,
        patch: parsed.success ? (parsed.data.patch as JsonPatch) : [],
        summary: parsed.success ? parsed.data.summary : "",
        assumptions: parsed.success ? parsed.data.assumptions : [],
        attempts: attempt,
      };
    }

    if (attempt === MAX_ATTEMPTS) return { type: "invalid", errors: result.errors, attempts: attempt };

    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: tool.id,
          is_error: true,
          content: JSON.stringify({ stage: result.stage, errors: result.errors, instruction: "Fix exactly these and call apply_patch again." }),
        },
      ],
    });
  }

  return { type: "invalid", errors: [], attempts: MAX_ATTEMPTS };
}
