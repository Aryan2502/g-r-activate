import { toast } from "sonner";

import { t } from "@/lib/i18n";

/** Copies text and confirms with a toast; never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("toast.copied"));
    return true;
  } catch {
    toast.error(t("toast.copyFailed"));
    return false;
  }
}
