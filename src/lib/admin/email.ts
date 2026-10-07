/**
 * Whether the app sends e-mails yet (SPEC §35.12). The P8 hooks in
 * src/server/order-notifications.ts receive every "Klant e-mailen" choice,
 * but send nothing until P8 adds Resend. Until then the staff dialogs and
 * toasts say "E-mail is nog niet geconfigureerd" instead of letting staff
 * assume the customer was told (SPEC §29: no silent failures).
 *
 * P8: replace with the real provider status (e.g. from a server function that
 * checks RESEND_API_KEY), so the notice disappears once e-mail works.
 */
export const EMAIL_SENDING_CONFIGURED: boolean = false;
