import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { postLoginPath } from "@/lib/auth/redirect";
import { roleQueryOptions } from "@/lib/auth/roles";
import { paths } from "@/lib/paths";

/** After signing in: staff to /admin, customers to /portal, honouring a safe `redirect`. */
export function useGoToArea() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (userId: string, redirect?: unknown) => {
      let target = paths.portal;
      try {
        const role = await queryClient.fetchQuery(roleQueryOptions(userId));
        target = postLoginPath(role, redirect);
      } catch (error) {
        // The area guard checks the role again and shows its own error state.
        console.error("role lookup failed", error);
      }
      await navigate({ href: target, replace: true });
    },
    [queryClient, navigate],
  );
}
