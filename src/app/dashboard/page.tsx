import { redirect } from "next/navigation";

/** Bare /dashboard has no tenant; the business list lives on /new. */
export default function DashboardIndex() {
  redirect("/new");
}
