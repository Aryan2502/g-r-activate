import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Row = Database["public"]["Functions"]["public_company_info"]["Returns"][number];

/** Public company settings (the only data anon may read). Text columns are nullable in the DB. */
export type PublicCompanyInfo = {
  [K in keyof Row]: Row[K] extends string ? string | null : Row[K];
};

/** Calls public.public_company_info(). Throws on a network/database error; null if no settings row. */
export async function fetchPublicCompanyInfo(): Promise<PublicCompanyInfo | null> {
  const { data, error } = await supabase.rpc("public_company_info");
  if (error) throw error;
  return data[0] ?? null;
}

/** Never throws: logs and returns null so public pages still render. */
export async function loadPublicCompanyInfo(): Promise<PublicCompanyInfo | null> {
  try {
    return await fetchPublicCompanyInfo();
  } catch (error) {
    console.error("public_company_info failed", error);
    return null;
  }
}

export const publicCompanyInfoQueryOptions = () =>
  queryOptions({
    queryKey: ["public-company-info"],
    queryFn: fetchPublicCompanyInfo,
    staleTime: 5 * 60_000,
  });
