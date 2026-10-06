import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "authenticated"; session: Session }
  | { status: "unauthenticated"; session: null };

function toState(session: Session | null): SessionState {
  return session
    ? { status: "authenticated", session }
    : { status: "unauthenticated", session: null };
}

/** The current Supabase session, kept up to date via onAuthStateChange. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading", session: null });

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(toState(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(toState(session));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/** Resolves the stored session (null when signed out or unreadable). */
export async function currentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session;
}

let signingOut = false;

/** True while signOut() runs, so the global listener leaves navigation to the caller. */
export function isSigningOut(): boolean {
  return signingOut;
}

/**
 * Signs out on this device and drops every cached query (SPEC §35.2), so the
 * next user never sees the previous user's data. `leave` runs between the two
 * (e.g. navigating away), so mounted pages do not refetch as a visitor.
 */
export async function signOut(
  queryClient: QueryClient,
  leave?: () => Promise<void>,
): Promise<{ error: unknown }> {
  signingOut = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { error };
    await leave?.();
    queryClient.clear();
    return { error: null };
  } finally {
    signingOut = false;
  }
}
