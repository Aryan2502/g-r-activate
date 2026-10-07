import { useEffect, useId } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { OrderFieldsInputs } from "@/components/portal/OrderFieldsInputs";
import { LoadError, Section } from "@/components/portal/Section";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, toAppError } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import {
  orderFieldsFromOrder,
  orderFieldsSchema,
  toOrderColumns,
  type OrderFieldsInput,
  type OrderFieldsOutput,
} from "@/lib/portal/order-fields";
import { lockedByRoot } from "@/lib/portal/order-schema";
import {
  enabledServiceTypesQueryOptions,
  orderGroupQueryOptions,
  orderQueryOptions,
  portalKeys,
  type OrderDetail,
} from "@/lib/portal/orders";

/**
 * "Gegevens wijzigen" (SPEC §35.7): the customer changes the fields they
 * entered while the order is still in the 'registered' stage. The update runs
 * with the customer's own client; orders_guard_update rejects other columns
 * and later stages, and the column grants do the same.
 *
 * One purchase has one order type, store and vendor order number: on an
 * extra package they are the root order's, and on a root order with packages
 * they hold for every package, so both show them read-only (as "Extra pakket
 * aanmelden" does). The database does not check this yet (PROGRESS.md).
 */
export function OrderEditForm({
  userId,
  customerId,
  order,
  onDone,
}: {
  userId: string;
  customerId: string;
  order: OrderDetail;
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const serviceTypes = useQuery(enabledServiceTypesQueryOptions(userId));
  const isPackage = Boolean(order.parent_order_id);
  const root = useQuery({
    ...orderQueryOptions(userId, customerId, order.parent_order_id ?? ""),
    enabled: isPackage,
  });
  const group = useQuery({
    ...orderGroupQueryOptions(userId, customerId, order.id),
    enabled: !isPackage,
  });
  const lockSource = isPackage ? root.data : group.data && group.data.length > 1 ? order : null;
  const locked = lockSource ? { orderType: true, ...lockedByRoot(lockSource) } : undefined;
  const lockedHint = isPackage
    ? root.data
      ? t("portal.orderForm.fields.lockedHint", { reference: root.data.reference })
      : undefined
    : t("portal.orderForm.fields.groupLockedHint");
  const lookup = isPackage ? root : group;
  const form = useForm<OrderFieldsInput, unknown, OrderFieldsOutput>({
    resolver: zodResolver(orderFieldsSchema),
    defaultValues: orderFieldsFromOrder(order),
  });

  // The form opens below the header: bring it into view.
  useEffect(() => {
    document.getElementById("order-edit-title")?.scrollIntoView({ block: "start" });
  }, []);

  const save = useMutation({
    mutationFn: async (values: OrderFieldsOutput) => {
      const { error } = await supabase
        .from("orders")
        .update(toOrderColumns(values))
        .eq("id", order.id)
        // A row hidden by RLS updates nothing; .single() turns that into an error.
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      // Refetch first, so closing the form shows the saved values.
      await queryClient.invalidateQueries({ queryKey: portalKeys.orders(userId) });
      toast.success(t("toast.saved"));
      onDone();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      // The order moved on in the meantime (55000): show its current state.
      if (toAppError(error).kind === "state") {
        void queryClient.invalidateQueries({ queryKey: portalKeys.orders(userId) });
      }
    },
  });

  return (
    <Section
      title={t("portal.order.edit.title")}
      icon={Pencil}
      id="order-edit"
      description={t("portal.order.edit.intro")}
    >
      {serviceTypes.isError || lookup.isError ? (
        <LoadError
          title={t("portal.order.loadFailed")}
          error={serviceTypes.error ?? lookup.error}
          onRetry={() => {
            if (serviceTypes.isError) void serviceTypes.refetch();
            if (lookup.isError) void lookup.refetch();
          }}
        />
      ) : serviceTypes.isPending || lookup.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) =>
              save.mutateAsync(values).catch(() => undefined),
            )}
          >
            <OrderFieldsInputs
              form={form}
              serviceTypes={serviceTypes.data}
              idPrefix={id}
              locked={locked}
              lockedHint={lockedHint}
              serviceTypeLockedHint={
                order.shipment_id ? t("portal.orderForm.fields.serviceTypeLockedHint") : undefined
              }
            />
            <div className="mt-8 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
                {t("portal.order.edit.cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                {save.isPending ? t("portal.order.edit.saving") : t("portal.order.edit.save")}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </Section>
  );
}
