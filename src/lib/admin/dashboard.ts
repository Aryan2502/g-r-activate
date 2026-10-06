import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type CustomerStatus = Database["public"]["Enums"]["customer_status"];
type StaffTask = Pick<
  Database["public"]["Tables"]["staff_tasks"]["Row"],
  "id" | "kind" | "body" | "created_at"
>;

export const staffProfileQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["admin", userId, "profile"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.display_name?.trim() || null;
    },
  });

async function countCustomers(status: CustomerStatus): Promise<number> {
  const { count, error } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw error;
  return count ?? 0;
}

/** Customers per status (RLS: staff see all customers). */
export const customerCountsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["admin", userId, "customer-counts"],
    staleTime: 30_000,
    queryFn: async () => {
      const [active, invited, disabled] = await Promise.all([
        countCustomers("active"),
        countCustomers("invited"),
        countCustomers("disabled"),
      ]);
      return { active, invited, disabled, total: active + invited + disabled };
    },
  });

export const OPEN_TASKS_SHOWN = 5;

/** The newest open staff tasks plus the total number open. */
export const openTasksQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["admin", userId, "open-tasks"],
    staleTime: 30_000,
    queryFn: async (): Promise<{ tasks: StaffTask[]; total: number }> => {
      const { data, error, count } = await supabase
        .from("staff_tasks")
        .select("id, kind, body, created_at", { count: "exact" })
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(OPEN_TASKS_SHOWN);
      if (error) throw error;
      return { tasks: data, total: count ?? data.length };
    },
  });
