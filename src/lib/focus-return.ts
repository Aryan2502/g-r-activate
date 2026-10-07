/**
 * Where keyboard focus goes when a dialog closes (WCAG 2.4.3, P4 review).
 * Radix returns focus to a DialogTrigger, but most staff dialogs are opened
 * from a menu item, a row action or code and have none, so focus fell to
 * <body> and the next Tab started again at the top of the page.
 *
 * The dialog primitives (components/ui/dialog.tsx, alert-dialog.tsx) call
 * focusReturnTarget() while the dialog content first renders, i.e. before the
 * DOM changes, and restoreFocus() from onCloseAutoFocus.
 */

/** The element that had focus when the dialog opened, or the menu button behind a menu item. */
export function focusReturnTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  // A menu item disappears with its menu: go back to the button that opened it.
  const menu = active.closest<HTMLElement>('[role="menu"]');
  if (menu?.id) {
    const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`);
    if (trigger) return trigger;
  }
  return active;
}

/**
 * onCloseAutoFocus: focus the remembered element if it is still on the page;
 * if the action removed it (e.g. "Ontvangen" after receiving), the page's
 * heading, so the keyboard user stays on the page. A handler that already
 * called preventDefault() has decided itself.
 */
export function restoreFocus(target: HTMLElement | null, event: Event): void {
  if (event.defaultPrevented || typeof document === "undefined") return;
  // A button the action just disabled (e.g. "Opnieuw versturen" for a
  // minute) cannot take focus: then the heading, as for a removed one.
  if (target?.isConnected && !target.matches(":disabled")) {
    event.preventDefault();
    target.focus();
    return;
  }
  if (target === null) return; // Nothing was focused: Radix's own default (its trigger, if any).
  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading) {
    event.preventDefault();
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus();
  }
}
