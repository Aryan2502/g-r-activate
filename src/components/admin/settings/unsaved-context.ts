import { createContext, useContext, useEffect } from "react";

/**
 * /admin/instellingen has many small forms, each with its own "Opslaan"
 * (only that section's columns are written). Every form reports here whether
 * it has unsaved edits; UnsavedChangesProvider (unsaved.tsx) lists them and
 * asks before the page is left.
 */

export interface UnsavedEntry {
  label: string;
  /** The section heading's id, for "go there" links. */
  anchor: string;
}

export type RegisterUnsaved = (key: string, entry: UnsavedEntry | null) => void;

export const UnsavedContext = createContext<RegisterUnsaved | null>(null);

/**
 * Reports a form's unsaved edits to the page. `key` is unique per form;
 * several forms may share a section label (the three bank accounts).
 */
export function useUnsavedChanges(key: string, entry: UnsavedEntry, dirty: boolean) {
  const register = useContext(UnsavedContext);
  const { label, anchor } = entry;
  useEffect(() => {
    register?.(key, dirty ? { label, anchor } : null);
  }, [register, key, dirty, label, anchor]);
  useEffect(() => () => register?.(key, null), [register, key]);
}
