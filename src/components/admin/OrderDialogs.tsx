import { useState, type ReactNode } from "react";

import { ReceiveDialog, type ReceiveDialogOptions } from "@/components/admin/ReceiveDialog";
import { StatusChangeDialog } from "@/components/admin/StatusChangeDialog";
import type { ReceiveTarget, StatusTarget } from "@/lib/admin/orders";
import {
  firstActiveStatus,
  type AdminStatusMap,
  type OperationalSettings,
  type StatusRow,
} from "@/lib/admin/statuses";
import type { StatusStage } from "@/lib/portal/orders";

/** Replaces the status dialog's title and intro (e.g. a whole shipment). */
export interface StatusDialogHeading {
  title: string;
  description: string;
}

/** Where focus goes when a dialog closes, instead of where it came from (e.g. the scan field). */
export interface DialogFocusOptions {
  returnFocus?: () => HTMLElement | null;
}

type DialogState =
  | {
      kind: "status";
      orders: StatusTarget[];
      initialStatus: string | null;
      heading: StatusDialogHeading | null;
      options: DialogFocusOptions | null;
    }
  | { kind: "receive"; order: ReceiveTarget; options: ReceiveDialogOptions | null }
  | null;

export interface OrderDialogs {
  /** "Status wijzigen" for one order or a selection, optionally with a status preselected. */
  changeStatus: (
    orders: StatusTarget[],
    initialStatus?: string | null,
    heading?: StatusDialogHeading | null,
    options?: DialogFocusOptions,
  ) => void;
  /** "Status wijzigen" with the first active status of a stage preselected. */
  changeStatusTo: (orders: StatusTarget[], stage: StatusStage) => void;
  /** "Ontvangen in US-magazijn" / "Gewicht corrigeren" / "Gewicht invullen". */
  receive: (order: ReceiveTarget, options?: ReceiveDialogOptions) => void;
  /** "Afgeven aan klant": the status dialog with the first active completed status. */
  pickup: (orders: StatusTarget[], options?: DialogFocusOptions) => void;
  /** Render once on the page. */
  element: ReactNode;
}

/**
 * The order dialogs of a page (status change, receive, pickup), opened from
 * row menus, bulk selections, the order page and the shipment page ("Status
 * voor hele zending wijzigen", with its own heading).
 */
export function useOrderDialogs({
  userId,
  statuses,
  settings,
}: {
  userId: string;
  statuses: AdminStatusMap;
  settings: OperationalSettings;
}): OrderDialogs {
  const [state, setState] = useState<DialogState>(null);
  const [open, setOpen] = useState(false);

  const changeStatus = (
    orders: StatusTarget[],
    initialStatus: string | null = null,
    heading: StatusDialogHeading | null = null,
    options: DialogFocusOptions | null = null,
  ) => {
    setState({ kind: "status", orders, initialStatus, heading, options });
    setOpen(true);
  };
  const preset = (stage: StatusStage): StatusRow | null =>
    firstActiveStatus(statuses, stage, { deliveryAvailable: settings.delivery_available });

  return {
    changeStatus,
    changeStatusTo: (orders, stage) => changeStatus(orders, preset(stage)?.code ?? null),
    pickup: (orders, options) =>
      changeStatus(orders, preset("completed")?.code ?? null, null, options ?? null),
    receive: (order, options) => {
      setState({ kind: "receive", order, options: options ?? null });
      setOpen(true);
    },
    element: (
      <>
        <StatusChangeDialog
          userId={userId}
          orders={state?.kind === "status" ? state.orders : []}
          statuses={statuses}
          settings={settings}
          initialStatus={state?.kind === "status" ? state.initialStatus : null}
          heading={state?.kind === "status" ? state.heading : null}
          returnFocus={state?.kind === "status" ? state.options?.returnFocus : undefined}
          open={open && state?.kind === "status"}
          onOpenChange={setOpen}
        />
        <ReceiveDialog
          userId={userId}
          order={state?.kind === "receive" ? state.order : null}
          options={state?.kind === "receive" ? state.options : null}
          statuses={statuses}
          open={open && state?.kind === "receive"}
          onOpenChange={setOpen}
        />
      </>
    ),
  };
}
