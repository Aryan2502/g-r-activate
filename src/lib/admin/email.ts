import { queryOptions } from "@tanstack/react-query";

import { adminKeys } from "@/lib/admin/keys";
import { fetchEmailStatus } from "@/lib/server-fns/system.functions";

/**
 * Whether the server can send e-mail (SPEC §35.12): RESEND_API_KEY and
 * EMAIL_FROM are set. The status dialog warns beforehand that the customer
 * will not be e-mailed; after every action the server reports what actually
 * happened per e-mail (lib/email/outcome.ts). A boolean only (emailStatusFn).
 */
export const emailStatusQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.emailStatus(userId),
    queryFn: fetchEmailStatus,
    staleTime: 5 * 60_000,
  });
