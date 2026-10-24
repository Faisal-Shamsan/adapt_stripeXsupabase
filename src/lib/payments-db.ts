import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcData } from "./errors";
import type { AccountFlags } from "./stripe";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show" | "refunded";

/** The payment-related database operations, all backed by SECURITY DEFINER functions. */
export interface PaymentsDb {
  recordEvent(eventId: string, type: string): Promise<boolean>;
  forgetEvent(eventId: string): Promise<void>;
  confirmBooking(bookingId: string, paymentIntent: string | null, checkoutSession: string | null): Promise<BookingStatus>;
  releaseBooking(bookingId: string): Promise<boolean>;
  markRefunded(bookingId: string, refundId: string): Promise<void>;
  syncAccount(accountId: string, flags: AccountFlags): Promise<string | null>;
}

export function paymentsDb(sb: SupabaseClient): PaymentsDb {
  return {
    recordEvent: async (eventId, type) => rpcData<boolean>(await sb.rpc("record_stripe_event", { p_event_id: eventId, p_type: type })),
    forgetEvent: async (eventId) => void rpcData(await sb.rpc("forget_stripe_event", { p_event_id: eventId })),
    confirmBooking: async (bookingId, pi, cs) =>
      rpcData<BookingStatus>(await sb.rpc("confirm_booking", { p_booking: bookingId, p_payment_intent: pi, p_checkout_session: cs })),
    releaseBooking: async (bookingId) => rpcData<boolean>(await sb.rpc("release_booking", { p_booking: bookingId })),
    markRefunded: async (bookingId, refundId) => void rpcData(await sb.rpc("mark_refunded", { p_booking: bookingId, p_refund_id: refundId })),
    syncAccount: async (accountId, f) =>
      rpcData<string | null>(
        await sb.rpc("sync_stripe_account", { p_account_id: accountId, p_charges: f.chargesEnabled, p_payouts: f.payoutsEnabled, p_details: f.detailsSubmitted }),
      ),
  };
}
