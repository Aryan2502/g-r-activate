import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import type { AuthContext } from "@/lib/auth/guards";
import { customerQueryOptions, type PortalCustomer } from "@/lib/portal/customer";

const portalRoute = getRouteApi("/portal");

/** For pages inside /portal: the layout renders them only once the record has loaded. */
export function usePortalCustomer(): { auth: AuthContext; customer: PortalCustomer } {
  const { auth } = portalRoute.useRouteContext();
  const { data } = useQuery(customerQueryOptions(auth.userId));
  if (!data) throw new Error("usePortalCustomer() used outside the portal layout");
  return { auth, customer: data };
}
