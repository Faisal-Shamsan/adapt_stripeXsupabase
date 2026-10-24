import { cache } from "react";
import { admin } from "./supabase/admin";
import { TenantConfig } from "@/engine/schema";
import { HttpError } from "./errors";

export type PublicTenant = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  chargesEnabled: boolean;
  config: TenantConfig;
};

export type PublicResource = { id: string; key: string; kind: string; label: string; position: { x: number; y: number } | null };

/** Published tenant by slug with its validated config. Cached per request. */
export const loadPublicTenant = cache(async (slug: string): Promise<PublicTenant | null> => {
  const { data, error } = await admin()
    .from("tenants")
    .select("id, slug, name, timezone, currency, charges_enabled, config, published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new HttpError(500, "internal error");
  if (!data || !data.published || !data.config) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    timezone: data.timezone,
    currency: data.currency,
    chargesEnabled: data.charges_enabled,
    config: TenantConfig.parse(data.config),
  };
});

export const loadActiveResources = cache(async (tenantId: string): Promise<PublicResource[]> => {
  const { data, error } = await admin().from("resources").select("id, key, kind, label, position").eq("tenant_id", tenantId).eq("active", true).order("key");
  if (error) throw new HttpError(500, "internal error");
  return data as PublicResource[];
});
