import { useState } from "react";

/**
 * A one-time link (an invitation or a password-reset link) is shown once:
 * only its hash is stored, so a dialog closed by a stray click or Escape
 * loses it, and getting another one rotates the token (and uses one of the
 * day's sends). Until the link was copied or shared, every way of closing
 * the dialog (outside click, Escape, the X, "Sluiten") asks first.
 */
export interface LinkGuard {
  /** Spread on DialogContent. */
  contentProps: {
    onInteractOutside?: (event: Event) => void;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
  };
  /** A link is on screen that was not copied or shared yet. */
  guarded: boolean;
  /** Copied or shared: closing no longer asks. */
  markShared: () => void;
  /** For the dialog's onOpenChange(false) and its close button. */
  requestClose: () => void;
  asking: boolean;
  confirmClose: () => void;
  keepOpen: () => void;
}

/** `link`: the link on screen now (null while none is shown); `close`: really close. */
export function useLinkGuard(link: string | null, close: () => void): LinkGuard {
  const [sharedLink, setSharedLink] = useState<string | null>(null);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const guarded = link !== null && sharedLink !== link;
  const asking = guarded && askingFor === link;
  const ask = () => setAskingFor(link);

  return {
    contentProps: guarded
      ? {
          onInteractOutside: (event) => {
            event.preventDefault();
            ask();
          },
          onEscapeKeyDown: (event) => {
            event.preventDefault();
            ask();
          },
        }
      : {},
    guarded,
    markShared: () => {
      setSharedLink(link);
      setAskingFor(null);
    },
    requestClose: () => {
      if (guarded) {
        ask();
        return;
      }
      setAskingFor(null);
      close();
    },
    asking,
    confirmClose: () => {
      setAskingFor(null);
      close();
    },
    keepOpen: () => setAskingFor(null),
  };
}
