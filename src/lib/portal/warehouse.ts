import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { portalKeys, type ServiceType } from "@/lib/portal/orders";

/**
 * "Uw persoonlijk US-verzendadres" (SPEC §35.8, §36): the US warehouse
 * address G&R configures, personalised with the customer's name, GR code and
 * the service ("GR67 Air Naam" / "GR67 Ocean Naam"). Nothing is hardcoded;
 * until an active address exists the card says so.
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

/** What the customer writes behind the code for each service (SPEC §36). */
export const SERVICE_WORD: Record<ServiceType, string> = { air: "Air", sea: "Ocean" };

/**
 * Replaces {FULL_NAME}, {GR_CODE} and {SERVICE} (Air or Ocean; any number of
 * times, case-sensitive as in the column defaults) and tidies the whitespace
 * a missing value leaves. Other {PLACEHOLDERS} stay visible so a typo in the
 * settings gets noticed.
 */
export function fillAddressTemplate(
  template: string,
  person: AddressPerson,
  service?: ServiceType,
): string {
  return template
    .replaceAll("{FULL_NAME}", person.fullName.trim())
    .replaceAll("{GR_CODE}", person.customerCode.trim())
    .replaceAll("{SERVICE}", service ? SERVICE_WORD[service] : "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The services an address shows a name line for. A name template with
 * {SERVICE} serves every enabled service that has no active address of its
 * own: one US address for Air and Ocean is the usual case. The address's own
 * service comes first. Without {SERVICE} there is one name line.
 */
export function addressServices(
  address: Pick<WarehouseAddress, "id" | "service_type" | "recipient_name_template">,
  enabled: readonly ServiceType[],
  activeAddresses: readonly Pick<WarehouseAddress, "id" | "service_type">[],
): ServiceType[] {
  if (!address.recipient_name_template.includes("{SERVICE}")) return [address.service_type];
  const others = enabled.filter(
    (service) =>
      service !== address.service_type &&
      !activeAddresses.some((a) => a.id !== address.id && a.service_type === service),
  );
  return [address.service_type, ...others];
}

export type AddressField =
  "recipient" | "line1" | "line2" | "city" | "state" | "zip" | "country" | "phone";

export interface PersonalAddressLine {
  field: AddressField;
  value: string;
  /** On a name line per service (template with {SERVICE}): which one. */
  service?: ServiceType;
}

/**
 * The address as the customer types it into a web shop, field by field
 * (empty fields left out); a name line per service when the template has
 * {SERVICE}.
 */
export function personalAddressLines(
  address: WarehouseAddress,
  person: AddressPerson,
  services: readonly ServiceType[] = [address.service_type],
): PersonalAddressLine[] {
  const perService = address.recipient_name_template.includes("{SERVICE}");
  const names: PersonalAddressLine[] = perService
    ? services.map((service) => ({
        field: "recipient",
        service,
        value: fillAddressTemplate(address.recipient_name_template, person, service),
      }))
    : [{ field: "recipient", value: fillAddressTemplate(address.recipient_name_template, person) }];
  const lines: PersonalAddressLine[] = [
    ...names,
    { field: "line1", value: address.address_line1.trim() },
    {
      field: "line2",
      value: fillAddressTemplate(address.address_line2_template, person, services[0]),
    },
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
 * order: name, street, line 2, "City, ST ZIP", country, phone; for one
 * service when the name says Air or Ocean.
 */
export function fullAddressText(
  address: WarehouseAddress,
  person: AddressPerson,
  service: ServiceType = address.service_type,
): string {
  const recipient = fillAddressTemplate(address.recipient_name_template, person, service);
  const line2 = fillAddressTemplate(address.address_line2_template, person, service);
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
