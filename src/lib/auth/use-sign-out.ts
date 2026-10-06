import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { signOut } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { paths } from "@/lib/paths";

/** "Uitloggen": signs out, clears every cached query and returns to /login. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function run() {
    setSigningOut(true);
    const { error } = await signOut(queryClient, () =>
      navigate({ href: paths.login, replace: true }),
    );
    if (error) {
      setSigningOut(false);
      console.error("signOut failed", error);
      toast.error(t("auth.signOut.failed"));
      return;
    }
    toast.success(t("auth.signOut.success"));
  }

  return { signOut: () => void run(), signingOut };
}
