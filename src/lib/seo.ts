/** Keeps the portal, admin and auth pages out of search results (SPEC §35.2). */
export const NOINDEX_META = { name: "robots", content: "noindex, nofollow" } as const;
