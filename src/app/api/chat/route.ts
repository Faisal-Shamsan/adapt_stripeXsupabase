import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";
import { callModel } from "@/ai/model";
import { runTurn, type HistoryMessage, type TurnResult } from "@/ai/turn";
import { TenantConfig } from "@/engine/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const AI_TURNS_PER_HOUR = 30;

const Body = z.object({
  tenantId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  images: z
    .array(
      z.object({
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        dataBase64: z.string().min(1).max(7_000_000), // ~5 MB decoded
      }),
    )
    .max(4)
    .default([]),
});

type StoredContent = { text: string; images?: number; kind?: TurnResult["type"]; summary?: string; version?: number };

function historyText(role: string, content: StoredContent): HistoryMessage {
  if (role === "user") return { role: "user", text: content.images ? `${content.text}\n[${content.images} image(s) attached]` : content.text };
  return { role: "assistant", text: content.summary ? `Applied change: ${content.summary}` : content.text };
}

/** Owner chat turn. AI runs only here, only for the tenant owner, rate-limited; patches land via apply_config. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const { owner, tenant } = await requireOwner(body.tenantId);
    const sb = admin();

    const allowed = rpcData<boolean>(await sb.rpc("consume_ai_turn", { p_tenant: tenant.id, p_limit: AI_TURNS_PER_HOUR }));
    if (!allowed) throw new HttpError(429, "too many changes in the last hour — try again shortly");

    const { data: row, error } = await sb.from("tenants").select("config").eq("id", tenant.id).single();
    if (error) throw new HttpError(500, "internal error");
    const current = row.config ? TenantConfig.parse(row.config) : null;

    const recent = rpcData<{ role: string; content: StoredContent }[]>(await sb.rpc("recent_chat", { p_tenant: tenant.id, p_limit: 6 }));
    const history = recent.map((m) => historyText(m.role, m.content));

    rpcData(await sb.rpc("append_chat", { p_tenant: tenant.id, p_role: "user", p_content: { text: body.message, images: body.images.length || undefined } }));

    const result = await runTurn({ config: current, history, message: body.message, images: body.images }, callModel());

    let version: number | undefined;
    if (result.type === "patch") {
      version = rpcData<number>(
        await sb.rpc("apply_config", { p_tenant: tenant.id, p_owner: owner.id, p_config: result.config, p_source: "ai", p_prompt: body.message }),
      );
    }

    const assistant: StoredContent =
      result.type === "patch"
        ? { text: result.summary, kind: "patch", summary: result.summary, version }
        : result.type === "ask"
          ? { text: result.question, kind: "ask" }
          : result.type === "invalid"
            ? { text: "I couldn't produce a valid configuration for that — could you rephrase or give me more detail?", kind: "invalid" }
            : { text: result.text, kind: "message" };
    rpcData(await sb.rpc("append_chat", { p_tenant: tenant.id, p_role: "assistant", p_content: assistant }));

    return NextResponse.json(result.type === "patch" ? { ...result, version } : result);
  } catch (e) {
    return toResponse(e);
  }
}
