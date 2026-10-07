import { queryOptions } from "@tanstack/react-query";

import { adminKeys } from "@/lib/admin/keys";
import type { SystemStatus } from "@/lib/admin/system-status";
import { fetchSystemStatus } from "@/lib/server-fns/system.functions";

/** systemStatusFn (admins): configuration booleans and the last reminder run. */
export const systemStatusQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.systemStatus(userId),
    staleTime: 5 * 60_000,
    queryFn: (): Promise<SystemStatus> => fetchSystemStatus(),
  });
