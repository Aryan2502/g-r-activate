import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { portalKeys } from "@/lib/portal/orders";

/**
 * "Uw persoonlijk US-verzendadres" (SPEC §35.8): the US warehouse address
 * G&R configures, personalised with the customer's name and GR code. Nothing
 * is hardcoded; until an active address exists the card says so.
 */

export type WarehouseAddress = Pick<
  Database["public"]["Tables"]["warehouse_addresses"]["Row"],
  | "id"
  | "label"
  | "service_type"
  | "recipient_name_template"
  | "address_line1"
  | "address_line2_template"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "phone"
>;

/** Active addresses (customers only see active rows under RLS). */
export const warehouseAddressesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: portalKeys.warehouse(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WarehouseAddress[]> => {
      const { data, error } = await supabase
        .from("warehouse_addresses")
        .select(
          "id, label, service_type, recipient_name_template, address_line1, address_line2_template, city, state, zip, country, phone",
        )
        .eq("is_active", true)
        .order("service_type")
        .order("label");
      if (error) throw error;
      return data;
    },
  });

export interface AddressPerson {
  fullName: string;
  customerCode: string;
}

/**
 * Replaces {FULL_NAME} and {GR_CODE} (any number of times, case-sensitive as
 * in the column defaults) and tidies the whitespace a missing value leaves.
 * Other {PLACEHOLDERS} stay visible so a typo in the settings gets noticed.
 */
export function fillAddressTemplate(template: string, person: AddressPerson): string {
  return template
    .replaceAll("{FULL_NAME}", person.fullName.trim())
    .replaceAll("{GR_CODE}", person.customerCode.trim())
    .replace(/\s+/g, " ")
    .trim();
}

export type AddressField =
  "recipient" | "line1" | "line2" | "city" | "state" | "zip" | "country" | "phone";

export interface PersonalAddressLine {
  field: AddressField;
  value: string;
}

/** The address as the customer types it into a web shop, field by field (empty fields left out). */
export function personalAddressLines(
  address: WarehouseAddress,
  person: AddressPerson,
): PersonalAddressLine[] {
  const lines: PersonalAddressLine[] = [
    { field: "recipient", value: fillAddressTemplate(address.recipient_name_template, person) },
    { field: "line1", value: address.address_line1.trim() },
    { field: "line2", value: fillAddressTemplate(address.address_line2_template, person) },
    { field: "city", value: address.city.trim() },
    { field: "state", value: address.state.trim() },
    { field: "zip", value: address.zip.trim() },
    { field: "country", value: address.country.trim() },
    { field: "phone", value: address.phone?.trim() ?? "" },
  ];
  return lines.filter((line) => line.value !== "");
}

/**
 * The whole address as one block for "Kopieer volledig adres", in US postal
 * order: name, street, line 2, "City, ST ZIP", country, phone.
 */
export function fullAddressText(address: WarehouseAddress, person: AddressPerson): string {
  const recipient = fillAddressTemplate(address.recipient_name_template, person);
  const line2 = fillAddressTemplate(address.address_line2_template, person);
  const cityLine = [
    address.city.trim(),
    [address.state.trim(), address.zip.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return [
    recipient,
    address.address_line1.trim(),
    line2,
    cityLine,
    address.country.trim(),
    address.phone?.trim() ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
