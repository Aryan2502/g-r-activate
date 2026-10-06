import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { bootAuthCallback } from "@/lib/auth/callback";
import { safeRedirect } from "@/lib/auth/redirect";
import { currentSession, isSigningOut } from "@/lib/auth/session";
import { paths } from "@/lib/paths";

function inProtectedArea(pathname: string): boolean {
  return [paths.portal, paths.admin].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

/**
 * App-wide reaction to Supabase auth events:
 * - a different (or no) user → clear every cached query (SPEC §35.2);
 * - signed out while in /portal or /admin (expired session, other tab) → /login;
 * - a recovery link that landed outside /auth/confirm (e.g. on the Site URL
 *   when the redirect was not allow-listed) → /auth/set-password.
 */
export function AuthSync() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let lastUserId: string | null | undefined;
    let recoveryHandled = false;

    const goToSetPassword = () => {
      const pathname = router.state.location.pathname;
      if (recoveryHandled || pathname.startsWith("/auth/")) return;
      recoveryHandled = true;
      void router.navigate({ href: paths.setPassword, replace: true });
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      // signOut() clears the cache itself, after leaving the page.
      if (lastUserId !== undefined && userId !== lastUserId && !isSigningOut()) queryClient.clear();
      lastUserId = userId;

      if (event === "PASSWORD_RECOVERY") {
        goToSetPassword();
      } else if (event === "SIGNED_OUT" && !isSigningOut()) {
        const location = router.state.location;
        if (inProtectedArea(location.pathname)) {
          const back = safeRedirect(location.href);
          void router.navigate({
            href: back ? `${paths.login}?${new URLSearchParams({ redirect: back })}` : paths.login,
            replace: true,
          });
        }
      }
    });

    // The PASSWORD_RECOVERY event may fire before this listener exists.
    if (bootAuthCallback?.type === "recovery" && bootAuthCallback.hasSession) {
      void currentSession().then((session) => {
        if (session) goToSetPassword();
      });
    }

    return () => data.subscription.unsubscribe();
  }, [queryClient, router]);

  return null;
}
