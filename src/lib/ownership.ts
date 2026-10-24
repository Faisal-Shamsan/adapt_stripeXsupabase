import { admin } from "./supabase/admin";
import { currentUser } from "./supabase/server";
import { HttpError } from "./errors";

export type Owner = { id: string; email: string };

export type OwnedTenant = {
  id: string;
  slug: string;
  name: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

/** Signed-in user must own the tenant. Throws 401/403/404; never returns a tenant the user does not own. */
export async function requireOwner(tenantId: string): Promise<{ owner: Owner; tenant: OwnedTenant }> {
  const owner = await currentUser();
  if (!owner) throw new HttpError(401, "sign in required");
  const { data, error } = await admin()
    .from("tenants")
    .select("id, slug, name, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new HttpError(500, "internal error");
  if (!data) throw new HttpError(404, "tenant not found");
  if (data.owner_id !== owner.id) throw new HttpError(403, "not your tenant");
  const { owner_id: _omit, ...tenant } = data;
  void _omit;
  return { owner, tenant };
}
