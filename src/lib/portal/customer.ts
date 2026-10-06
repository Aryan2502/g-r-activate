import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];

const COLUMNS =
  "id, customer_code, full_name, account_type, company_name, kkf_number, contact_person, email, phone, address, district" as const;

export type PortalCustomer = Pick<
  CustomerRow,
  | "id"
  | "customer_code"
  | "full_name"
  | "account_type"
  | "company_name"
  | "kkf_number"
  | "contact_person"
  | "email"
  | "phone"
  | "address"
  | "district"
>;

export const customerQueryKey = (userId: string) => ["portal", userId, "customer"] as const;

/**
 * The signed-in customer's own record. RLS only shows it while it is ACTIVE and
 * linked to this login (current_customer_id()), so null means: not created yet,
 * waiting for an invitation (email conflict), or disabled.
 */
export const customerQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: customerQueryKey(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<PortalCustomer | null> => {
      const { data, error } = await supabase
        .from("customers")
        .select(COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

/** First word of the name, for "Welkom, Maria". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/, 1)[0] ?? fullName;
}
