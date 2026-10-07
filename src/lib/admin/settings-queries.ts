import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { adminKeys } from "@/lib/admin/keys";
import {
  BANK_ACCOUNT_COLUMNS,
  firstIssuedInvoice,
  loadCompanySettings,
  loadInvoiceCounter,
  type BankAccount,
  type CompanySettings,
  type ServiceRate,
  type WarehouseAddressRow,
} from "@/lib/admin/settings";

/**
 * Reads of /admin/instellingen and the dashboard's setup checklist, with the
 * signed-in user's client (staff read everything here except the invoice
 * counter, which RLS keeps for admins). Writes are in settings.ts.
 */

export const companySettingsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.companySettings(userId),
    staleTime: 60_000,
    queryFn: (): Promise<CompanySettings> => loadCompanySettings(supabase),
  });

/** Every bank account row, the active one per currency first. */
export const bankAccountsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.bankAccounts(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<BankAccount[]> => {
      const { data, error } = await supabase
        .from("company_bank_accounts")
        .select(BANK_ACCOUNT_COLUMNS)
        .order("is_active", { ascending: false })
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

/** Every US address, also the switched-off ones (customers see only active ones). */
export const warehouseAddressesAdminQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.warehouseAddresses(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<WarehouseAddressRow[]> => {
      const { data, error } = await supabase
        .from("warehouse_addresses")
        .select("*")
        .order("is_active", { ascending: false })
        .order("service_type")
        .order("label");
      if (error) throw error;
      return data;
    },
  });

export const serviceRatesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.serviceRates(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<ServiceRate[]> => {
      const { data, error } = await supabase
        .from("service_rates")
        .select("*")
        .order("service_type");
      if (error) throw error;
      return data;
    },
  });

/** This year's invoice counter (admins only) and whether a number was handed out already. */
export const invoiceCounterQueryOptions = (userId: string, year: number) =>
  queryOptions({
    queryKey: adminKeys.invoiceCounter(userId, year),
    staleTime: 30_000,
    queryFn: async () => {
      const [lastNumber, firstIssued] = await Promise.all([
        loadInvoiceCounter(supabase, year),
        firstIssuedInvoice(supabase, year),
      ]);
      return { lastNumber, firstIssued };
    },
  });
