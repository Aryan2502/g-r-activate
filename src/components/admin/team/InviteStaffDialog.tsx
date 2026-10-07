import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import { Problem } from "@/components/admin/customers/CustomerActionDialogs";
import { TextField } from "@/components/admin/customers/CustomerFormFields";
import {
  fieldErrorsOf,
  focusFirstError,
  useFormValues,
} from "@/components/admin/customers/form-state";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { RolePicker } from "@/components/admin/team/RolePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { invitationShareText } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import {
  inviteStaffSchema,
  memberName,
  type AppRole,
  type StaffInviteConflict,
} from "@/lib/admin/team";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitInviteStaff, type InviteStaffResponse } from "@/lib/server-fns/team.functions";

const FIELDS = ["email", "role", "fullName", "phone"] as const;
type Field = (typeof FIELDS)[number];
type Invited = Extract<InviteStaffResponse, { status: "invited" }>;

/**
 * "Medewerker uitnodigen" (SPEC §35.4, §35.6): e-mail and role; inviteStaffFn
 * writes the staff invitation with the admin's own client and returns the
 * link, ALWAYS with "Kopieer uitnodigingslink" and "Deel via WhatsApp". A
 * team member, an open invitation or a customer's address is explained
 * instead. No e-mail goes out until P8, and the panel says so.
 */
export function InviteStaffDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const form = useFormValues<Field>({ email: "", role: "staff", fullName: "", phone: "+597 " });
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<StaffInviteConflict | null>(null);
  const [invited, setInvited] = useState<{
    result: Invited;
    fullName: string | null;
    phone: string | null;
  } | null>(null);

  const invite = useMutation({
    mutationFn: submitInviteStaff,
    onSuccess: async (result, input) => {
      if (result.status === "conflict") {
        setConflict(result.conflict);
        return;
      }
      const parsed = inviteStaffSchema.safeParse(input);
      setInvited({
        result,
        fullName: parsed.success ? parsed.data.fullName : null,
        phone: parsed.success ? parsed.data.phone : null,
      });
      toast.success(t("admin.team.invite.created", { email: result.email }));
      await queryClient.invalidateQueries({ queryKey: adminKeys.team(userId) });
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(`${t("admin.team.invite.failed")} ${errorMessage(e)}`);
    },
  });

  const finish = () => {
    onOpenChange(false);
    form.setErrors({});
    setProblem(null);
    setConflict(null);
    setInvited(null);
    for (const field of FIELDS)
      form.set(field, field === "role" ? "staff" : field === "phone" ? "+597 " : "");
  };
  // The link is shown once: closing before it was copied or shared asks first.
  const guard = useLinkGuard(invited?.result.link ?? null, finish);
  const close = (next: boolean) => {
    if (invite.isPending) return;
    if (next) onOpenChange(true);
    else guard.requestClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setConflict(null);
    const parsed = inviteStaffSchema.safeParse(form.values);
    if (!parsed.success) {
      const errors = fieldErrorsOf<Field>(parsed.error);
      form.setErrors(errors);
      focusFirstError(id, FIELDS, errors);
      return;
    }
    invite.mutate({ ...form.values, role: parsed.data.role });
  };

  const role = (form.values.role === "admin" ? "admin" : "staff") satisfies AppRole;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
        {...guard.contentProps}
      >
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {invited
              ? t("admin.team.invite.linkTitle", { email: invited.result.email })
              : t("admin.team.invite.title")}
          </DialogTitle>
          <DialogDescription>
            {invited
              ? t("admin.team.invite.linkIntro", {
                  role: t(`admin.roles.${invited.result.role}`).toLowerCase(),
                })
              : t("admin.team.invite.intro")}
          </DialogDescription>
        </DialogHeader>

        {invited ? (
          <>
            <ShareLinkPanel
              link={invited.result.link}
              label={t("admin.invitations.linkLabel")}
              copyLabel={t("admin.invitations.copy")}
              shareText={invitationShareText({
                kind: "staff",
                fullName: invited.fullName,
                customerCode: null,
                email: invited.result.email,
                link: invited.result.link,
              })}
              phone={invited.phone}
              emailed={invited.result.emailed}
              linkSource={invited.result.linkSource}
              notes={[
                t("admin.invitations.linkOnce"),
                t("admin.invitations.linkValid", {
                  date: formatDateTime(invited.result.expiresAt),
                }),
              ]}
              onShared={guard.markShared}
            />
            <UnsharedLinkPrompt guard={guard} />
            <DialogFooter>
              <Button onClick={() => close(false)}>{t("admin.team.invite.done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
            <TextField
              idPrefix={id}
              field="email"
              label={t("admin.team.invite.email")}
              value={form.values.email}
              onChange={(v) => {
                form.set("email", v);
                setConflict(null);
              }}
              error={form.errors.email}
              hint={t("admin.team.invite.emailHint")}
              type="email"
              autoComplete="off"
              inputMode="email"
              maxLength={320}
            />
            <RolePicker
              idPrefix={id}
              label={t("admin.team.invite.role")}
              value={role}
              onChange={(v) => form.set("role", v)}
            />
            <TextField
              idPrefix={id}
              field="fullName"
              label={t("admin.team.invite.fullName")}
              value={form.values.fullName}
              onChange={(v) => form.set("fullName", v)}
              error={form.errors.fullName}
              hint={t("admin.team.invite.fullNameHint")}
              optional
              autoComplete="off"
              maxLength={200}
            />
            <TextField
              idPrefix={id}
              field="phone"
              label={t("admin.team.invite.phone")}
              value={form.values.phone}
              onChange={(v) => form.set("phone", v)}
              error={form.errors.phone}
              hint={t("admin.team.invite.phoneHint")}
              optional
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={50}
            />
            {conflict ? (
              <ConflictNote
                conflict={conflict}
                email={form.values.email.trim().toLowerCase()}
                onClose={() => close(false)}
              />
            ) : null}
            <Problem prefix={t("admin.team.invite.failed")} message={problem} />
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
                disabled={invite.isPending}
              >
                {t("admin.team.invite.cancel")}
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                {invite.isPending
                  ? t("admin.team.invite.submitting")
                  : t("admin.team.invite.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Why this address cannot be invited, with the way forward. */
function ConflictNote({
  conflict,
  email,
  onClose,
}: {
  conflict: StaffInviteConflict;
  email: string;
  onClose: () => void;
}) {
  const t = useT();
  let text: string;
  let customerId: string | null = null;
  switch (conflict.kind) {
    case "member":
      text = t(
        conflict.member.blocked ? "admin.team.invite.memberBlocked" : "admin.team.invite.member",
        {
          email,
          name: memberName(conflict.member),
        },
      );
      break;
    case "already_invited":
      text = t("admin.team.invite.alreadyInvited", { email });
      break;
    case "customer_invited":
      text = t("admin.team.invite.customerInvited", { email });
      customerId = conflict.customer?.id ?? null;
      break;
    case "customer":
      text = t("admin.team.invite.customer", {
        email,
        code: conflict.customer.customer_code,
        name: conflict.customer.full_name,
      });
      customerId = conflict.customer.id;
      break;
  }
  return (
    <div role="alert">
      <Callout
        tone="warning"
        icon={TriangleAlert}
        title={t("admin.team.invite.conflictTitle")}
        actions={
          customerId ? (
            <Button asChild size="sm" variant="outline" onClick={onClose}>
              <Link to="/admin/klanten/$id" params={{ id: customerId }}>
                {t("admin.team.invite.openCustomer")}
              </Link>
            </Button>
          ) : null
        }
      >
        {text}
      </Callout>
    </div>
  );
}
