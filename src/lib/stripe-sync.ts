import { admin } from "./supabase/admin";
import { accountFlags, retrieveConnectedAccount, type AccountFlags } from "./stripe";

const STALE_MS = 60_000;

type Row = { stripe_account_id: string | null; charges_enabled: boolean; stripe_synced_at: string | null };

/**
 * If a tenant has a connected account whose flags still say "not ready", confirm with Stripe at most once a minute
 * and persist the result. The webhook is the primary path; this covers delivery lag and local development.
 * Returns the fresh flags when a sync happened, otherwise null.
 */
export async function maybeSyncStripe(tenantId: string, row: Row): Promise<AccountFlags | null> {
  if (!row.stripe_account_id || row.charges_enabled) return null;
  if (row.stripe_synced_at && Date.now() - new Date(row.stripe_synced_at).getTime() < STALE_MS) return null;
  try {
    const flags = accountFlags(await retrieveConnectedAccount(row.stripe_account_id));
    await admin().rpc("sync_stripe_account", {
      p_account_id: row.stripe_account_id,
      p_charges: flags.chargesEnabled,
      p_payouts: flags.payoutsEnabled,
      p_details: flags.detailsSubmitted,
    });
    return flags;
  } catch (e) {
    console.error("stripe lazy sync failed", tenantId, e);
    return null;
  }
}
