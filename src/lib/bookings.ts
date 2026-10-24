import { admin } from "./supabase/admin";
import { HttpError, rpcData } from "./errors";

/** Grid resolution for non-class slots. Must match between availability listing and booking creation. */
export const SLOT_STEP_MIN = 15;

export type BookingView = {
  id: string;
  tenant_slug: string;
  tenant_name: string;
  service_key: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show" | "refunded";
  starts_at: string;
  ends_at: string;
  amount_cents: number;
  deposit_cents: number;
  currency: string;
  customer_email: string;
  customer_name: string;
  cancellation_deadline_hours: number;
  resources: string[] | null;
};

export async function loadBookingByToken(id: string, token: string): Promise<BookingView> {
  const rows = rpcData<BookingView[]>(await admin().rpc("booking_by_token", { p_booking: id, p_token: token }));
  const b = rows[0];
  if (!b) throw new HttpError(404, "booking not found");
  return b;
}
