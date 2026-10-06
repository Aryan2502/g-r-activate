const SURINAME_COUNTRY_CODE = "597";

/**
 * International digits without '+' (SPEC §35.12: wa.me links). Bare 6–7 digit
 * input is a local Surinamese number and gets 597; input starting with '+' or
 * '00' is already international. A 597 number needs exactly 6–7 local digits.
 * Returns null when unusable.
 */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!international && digits.length >= 6 && digits.length <= 7) {
    digits = SURINAME_COUNTRY_CODE + digits;
  }
  if (digits.startsWith(SURINAME_COUNTRY_CODE)) {
    const local = digits.length - SURINAME_COUNTRY_CODE.length;
    return local === 6 || local === 7 ? digits : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function telHref(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

/** '5978897500' → '+597 889 7500'; other inputs are returned trimmed, unchanged. */
export function formatPhone(phone: string): string {
  const digits = phoneDigits(phone);
  if (digits?.startsWith(SURINAME_COUNTRY_CODE)) {
    const local = digits.slice(SURINAME_COUNTRY_CODE.length);
    return `+597 ${local.slice(0, 3)} ${local.slice(3)}`;
  }
  return phone.trim();
}
