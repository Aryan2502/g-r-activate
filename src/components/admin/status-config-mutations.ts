import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import { setStatusActive } from "@/lib/admin/status-config";
import type { StatusRow } from "@/lib/admin/statuses";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";

/** After any status write: the list, every status lookup and the stage-based counts. */
export async function refreshStatuses(queryClient: QueryClient, userId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminKeys.statuses(userId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.orders(userId) }),
  ]);
}

/** "Activeren" on /admin/statussen: no questions asked (admins only; RLS decides). */
export function useActivateStatus(userId: string) {
  const t = useT();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (row: StatusRow) => setStatusActive(supabase, row.code, true),
    onSuccess: async (_, row) => {
      toast.success(t("admin.statuses.activated", { label: row.label_nl }));
      await refreshStatuses(queryClient, userId);
    },
    onError: (e) => toast.error(`${t("admin.statuses.toggleFailed")} ${errorMessage(e)}`),
  });
}
