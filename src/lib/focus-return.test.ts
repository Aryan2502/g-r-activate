import { afterEach, describe, expect, it } from "vitest";

import { focusReturnTarget, restoreFocus } from "./focus-return";

afterEach(() => {
  document.body.innerHTML = "";
});

const closeEvent = () => new Event("focusOutside", { cancelable: true });

describe("focus return for dialogs without a trigger (WCAG 2.4.3)", () => {
  it("remembers the focused button, and the menu button behind a menu item", () => {
    document.body.innerHTML = `
      <button id="plain">Status wijzigen</button>
      <button id="menu-button" aria-controls="menu-1">…</button>
      <div role="menu" id="menu-1"><div role="menuitem" tabindex="-1" id="item">Ontvangen</div></div>`;
    document.getElementById("plain")!.focus();
    expect(focusReturnTarget()?.id).toBe("plain");
    document.getElementById("item")!.focus();
    expect(focusReturnTarget()?.id).toBe("menu-button");
  });

  it("nothing focused: no target, and Radix's own default stays in charge", () => {
    expect(focusReturnTarget()).toBeNull();
    const event = closeEvent();
    restoreFocus(null, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("focuses the remembered element; if the action removed it, the page heading", () => {
    document.body.innerHTML = `<main><h1>Order ORD-2026-00001</h1><button id="b">Ontvangen</button></main>`;
    const button = document.getElementById("b")!;
    const first = closeEvent();
    restoreFocus(button, first);
    expect(first.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button);

    button.remove();
    const second = closeEvent();
    restoreFocus(button, second);
    expect(second.defaultPrevented).toBe(true);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("a button the action disabled cannot take focus: the page heading instead", () => {
    document.body.innerHTML = `<main><h1>Hugo Hoek</h1><button id="r" disabled>Opnieuw versturen</button></main>`;
    const event = closeEvent();
    restoreFocus(document.getElementById("r"), event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("leaves a handler that already chose (e.g. back to the scan field) alone", () => {
    document.body.innerHTML = `<button id="b">x</button><input id="scan" />`;
    const event = closeEvent();
    event.preventDefault();
    document.getElementById("scan")!.focus();
    restoreFocus(document.getElementById("b"), event);
    expect(document.activeElement?.id).toBe("scan");
  });
});
