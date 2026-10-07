import "@tanstack/react-start/server-only";

/**
 * Invitation tokens (SPEC §35.6): 32 random bytes, base64url, shown once in
 * the link; the database stores only the lowercase hex SHA-256
 * (invitations.token_hash). Web Crypto, so no node:crypto import is needed.
 * Load with `await import("@/server/invitation-tokens")` inside a handler.
 */

export interface InvitationToken {
  /** Goes into the link, never into the database or a log. */
  token: string;
  /** What invitations.token_hash stores and get/redeem_invitation look up. */
  tokenHash: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lowercase hex SHA-256 of the token text, as the migrations expect. */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createInvitationToken(): Promise<InvitationToken> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64url(bytes);
  return { token, tokenHash: await hashInvitationToken(token) };
}
