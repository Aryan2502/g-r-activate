/**
 * The navigation item to highlight for a path: an exact item matches only its
 * own path, other items also match their sub-paths, and the most specific
 * match wins (so /portal/orders/nieuw highlights "Order aanmelden", not
 * "Orders", while /portal/orders/<id> highlights "Orders").
 */
export function activeNavPath(
  items: readonly { to: string; exact?: boolean }[],
  pathname: string,
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: string | null = null;
  for (const item of items) {
    const matches = item.exact
      ? path === item.to
      : path === item.to || path.startsWith(`${item.to}/`);
    if (matches && (best === null || item.to.length > best.length)) best = item.to;
  }
  return best;
}
