import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const PG_TO_HTTP: Record<string, number> = {
  "42501": 403,
  P0002: 404,
  "22023": 422,
  "23505": 409,
  "23P01": 409,
  AD001: 409, // class full
  AD002: 409, // slot unavailable / booking window
  AD003: 422, // spot required or invalid
  AD004: 409, // booking not in a state that allows this
  AD005: 409, // tenant cannot take payments yet
};

type PgLike = { code?: string; message?: string; details?: string; hint?: string };

/** Map a Postgres / PostgREST error (from supabase-js rpc) to an HttpError. Unknown codes become 500. */
export function fromPg(e: PgLike): HttpError {
  const code = e.code ?? "";
  const status = PG_TO_HTTP[code] ?? 500;
  return new HttpError(status, status === 500 ? "internal error" : (e.message ?? "error"), code);
}

export function toResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: "invalid request", issues: e.issues }, { status: 400 });
  if (typeof e === "object" && e !== null && "code" in e) return toResponse(fromPg(e as PgLike));
  console.error(e);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

/** Unwrap a supabase-js rpc result, throwing an HttpError on failure. */
export function rpcData<T>(r: { data: T | null; error: PgLike | null }): T {
  if (r.error) throw fromPg(r.error);
  return r.data as T;
}
