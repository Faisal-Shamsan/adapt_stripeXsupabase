/**
 * Next imports every route/page module while building ("Collecting page data"). None of them may read
 * secrets at import time, or production builds fail without runtime env vars. This imports each module
 * with the environment stripped and asserts nothing throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../src/app");
const SECRETS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_APP_URL", "NEBIUS_API_KEY", "ANTHROPIC_API_KEY"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // layouts are excluded only because next/font needs Next's compiler; they read no env.
    else if (/^(route|page|error)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const modules = walk(APP);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SECRETS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});
afterEach(() => {
  for (const k of SECRETS) if (saved[k] !== undefined) process.env[k] = saved[k];
});

describe("app modules import without environment", () => {
  expect(modules.length).toBeGreaterThan(10);
  for (const file of modules) {
    it(path.relative(APP, file).replace(/\\/g, "/"), async () => {
      await expect(import(/* @vite-ignore */ file)).resolves.toBeDefined();
    });
  }
});
