import { useId, useState, type FormEvent, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  KeyRound,
  Loader2,
  MailQuestion,
  Send,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Callout } from "@/components/admin/Callout";
import {
  AccountTypeField,
  CustomerCodeField,
  TextField,
} from "@/components/admin/customers/CustomerFormFields";
import {
  fieldErrorsOf,
  focusFirstError,
  useFormValues,
} from "@/components/admin/customers/form-state";
import { ShareLinkPanel } from "@/components/admin/customers/ShareLinkPanel";
import { useLinkGuard, type LinkGuard } from "@/components/admin/customers/link-guard";
import { UnsharedLinkPrompt } from "@/components/admin/customers/one-time-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  inviteNewCustomerSchema,
  type AccountType,
  type CustomerSummary,
  type InviteConflict,
  type InviteCustomerInput,
} from "@/lib/admin/customer-actions";
import { invitationShareText } from "@/lib/admin/invitations";
import { adminKeys } from "@/lib/admin/keys";
import { errorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { submitInviteCustomer, type InviteResponse } from "@/lib/server-fns/customers.functions";

/** In the order the form shows them, for focusing the first problem. */
const FIELDS = ["companyName", "fullName", "email", "phone", "code"] as const;
type Field = (typeof FIELDS)[number];
type Outcome = Exclude<InviteResponse, { ok: false } | { status: "conflict" }>;
type Conflict = Extract<InviteResponse, { status: "conflict" }>["conflict"];

/**
 * "Klant uitnodigen" (SPEC §5, §35.6): for a new customer (name, e-mail,
 * optional phone and existing GR code) or, from the customer page, for an
 * existing one. inviteCustomerFn looks the e-mail up first and never makes a
 * second record for it; a conflict is explained with the way forward. The
 * result is the link, ALWAYS with "Kopieer uitnodigingslink" and "Deel via
 * WhatsApp" (e-mail follows in P8).
 */
export function InviteCustomerDialog({
  userId,
  isAdmin,
  customer = null,
  open,
  onOpenChange,
}: {
  userId: string;
  isAdmin: boolean;
  /** Invite this existing customer; without it, the form for a new one. */
  customer?: CustomerSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A conflict may point at another existing customer to invite instead.
  const [target, setTarget] = useState<CustomerSummary | null>(customer);
  const shown = target ?? customer;

  const finish = () => {
    onOpenChange(false);
    setOutcome(null);
    setTarget(customer);
  };
  // The link is shown once: closing before it was copied or shared asks first.
  const guard = useLinkGuard(outcome?.status === "invited" ? outcome.link : null, finish);
  const close = (next: boolean) => {
    if (busy) return;
    if (next) onOpenChange(true);
    else guard.requestClose();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-card sm:max-w-xl"
        {...guard.contentProps}
      >
        <DialogHeader>
          <DialogTitle className="font-heading text-primary">
            {shown
              ? t("admin.customers.inviteDialog.titleExisting", { name: shown.full_name })
              : t("admin.customers.inviteDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {shown
              ? t("admin.customers.inviteDialog.introExisting", {
                  name: shown.full_name,
                  code: shown.customer_code,
                  email: shown.email ?? "",
                })
              : t("admin.customers.inviteDialog.intro")}
          </DialogDescription>
        </DialogHeader>
        {!open ? null : outcome ? (
          <InviteOutcome outcome={outcome} guard={guard} onClose={() => close(false)} />
        ) : (
          <InviteForm
            key={shown?.id ?? "new"}
            userId={userId}
            isAdmin={isAdmin}
            customer={shown}
            onBusyChange={setBusy}
            onClose={() => close(false)}
            onOutcome={setOutcome}
            onInviteInstead={setTarget}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  userId,
  isAdmin,
  customer,
  onBusyChange,
  onClose,
  onOutcome,
  onInviteInstead,
}: {
  userId: string;
  isAdmin: boolean;
  customer: CustomerSummary | null;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
  /** A conflict points at another existing customer to invite instead. */
  onInviteInstead: (customer: CustomerSummary) => void;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const { values, set, errors, setErrors } = useFormValues<Field>({
    companyName: "",
    fullName: "",
    email: "",
    phone: "+597 ",
    code: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  // Shown above the buttons with the form still filled in, so staff can
  // correct the e-mail or code (or follow the way forward it offers).
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const invite = useMutation({
    mutationFn: (input: InviteCustomerInput) => submitInviteCustomer(input),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: async (result) => {
      if (result.status === "invited") {
        toast.success(
          result.customerCreated
            ? t("admin.customers.inviteDialog.created", {
                code: result.customer.customer_code,
                name: result.customer.full_name,
              })
            : t("admin.customers.inviteDialog.invited", {
                code: result.customer.customer_code,
                name: result.customer.full_name,
              }),
        );
      } else if (result.status === "customer_only") {
        toast.warning(t("admin.customers.inviteDialog.customerOnlyTitle"));
      }
      if (result.status === "conflict") {
        setConflict(result.conflict);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.customers(userId) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.customerCounts(userId) }),
      ]);
      onOutcome(result);
    },
    onError: (e) => {
      setProblem(errorMessage(e));
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setConflict(null);
    if (customer) {
      invite.mutate({ mode: "existing", customerId: customer.id });
      return;
    }
    const raw = { ...values, accountType };
    const parsed = inviteNewCustomerSchema.safeParse(raw);
    if (!parsed.success) {
      const found = fieldErrorsOf<Field>(parsed.error);
      setErrors(found);
      focusFirstError(id, FIELDS, found);
      return;
    }
    setErrors({});
    // The raw values: the server parses them again with the same schema.
    invite.mutate({ mode: "new", customer: raw });
  };

  const field = (name: Field) => ({
    idPrefix: id,
    field: name,
    value: values[name],
    onChange: (v: string) => {
      set(name, v);
      if (name === "email" || name === "code") setConflict(null);
    },
    error: errors[name],
  });

  return (
    <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
      {customer ? null : (
        <>
          <p className="text-xs text-muted-foreground">{t("admin.customers.form.requiredNote")}</p>
          <AccountTypeField idPrefix={id} value={accountType} onChange={setAccountType} />
          {accountType === "business" ? (
            <TextField
              {...field("companyName")}
              label={t("admin.customers.fields.companyName")}
              maxLength={220}
              autoComplete="off"
            />
          ) : null}
          <TextField
            {...field("fullName")}
            label={t("admin.customers.fields.fullName")}
            hint={t("admin.customers.form.nameHint")}
            maxLength={220}
            autoComplete="off"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              {...field("email")}
              label={t("admin.customers.fields.email")}
              hint={t("admin.customers.form.emailHintInvite")}
              type="email"
              inputMode="email"
              maxLength={330}
              autoComplete="off"
            />
            <TextField
              {...field("phone")}
              label={t("admin.customers.fields.phone")}
              hint={t("admin.customers.form.phoneHint")}
              optional
              type="tel"
              inputMode="tel"
              maxLength={60}
              autoComplete="off"
            />
          </div>
          <CustomerCodeField
            idPrefix={id}
            userId={userId}
            value={values.code}
            onChange={(v) => {
              set("code", v);
              setConflict(null);
            }}
            error={errors.code}
          />
        </>
      )}

      {conflict ? (
        <div role="alert">
          <ConflictView
            conflict={conflict}
            isAdmin={isAdmin}
            onClose={onClose}
            onInviteInstead={onInviteInstead}
          />
        </div>
      ) : null}

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("admin.customers.inviteDialog.failed")} {problem}
          </span>
        </p>
      ) : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={invite.isPending}>
          {t("admin.customers.inviteDialog.cancel")}
        </Button>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Send aria-hidden />
          )}
          {invite.isPending
            ? t("admin.customers.inviteDialog.submitting")
            : t("admin.customers.inviteDialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CustomerLink({
  customer,
  onNavigate,
}: {
  customer: CustomerSummary;
  onNavigate: (event: MouseEvent) => void;
}) {
  const t = useT();
  return (
    <Button size="sm" variant="outline" className="bg-card" asChild>
      <Link to="/admin/klanten/$id" params={{ id: customer.id }} onClick={onNavigate}>
        <UserRound aria-hidden />
        {t("admin.customers.conflicts.openCustomer", { code: customer.customer_code })}
      </Link>
    </Button>
  );
}

function ConflictView({
  conflict,
  isAdmin,
  onClose,
  onInviteInstead,
}: {
  conflict: InviteConflict;
  isAdmin: boolean;
  onClose: () => void;
  onInviteInstead: (customer: CustomerSummary) => void;
}) {
  const t = useT();
  const { customer } = conflict;
  const names = { code: customer.customer_code, name: customer.full_name };
  switch (conflict.kind) {
    case "has_login":
      return (
        <Callout
          tone="info"
          icon={KeyRound}
          title={t("admin.customers.conflicts.hasLoginTitle")}
          actions={
            <>
              {conflict.requestedCode && conflict.canChangeCode && isAdmin ? (
                <Button size="sm" asChild>
                  <Link
                    to="/admin/klanten/$id"
                    params={{ id: customer.id }}
                    search={{ codeChange: conflict.requestedCode }}
                    onClick={onClose}
                  >
                    {t("admin.customers.conflicts.changeCode", { code: conflict.requestedCode })}
                  </Link>
                </Button>
              ) : null}
              <CustomerLink customer={customer} onNavigate={onClose} />
            </>
          }
        >
          <p>
            {t("admin.customers.conflicts.hasLoginText", {
              ...names,
              email: customer.email ?? "",
            })}
          </p>
          {conflict.requestedCode ? (
            <p className="mt-1">
              {conflict.canChangeCode
                ? `${t("admin.customers.conflicts.changeCodeText", {
                    requested: conflict.requestedCode,
                  })}${isAdmin ? "" : ` ${t("admin.customers.conflicts.changeCodeAdminOnly")}`}`
                : t("admin.customers.conflicts.changeCodeLocked", {
                    requested: conflict.requestedCode,
                  })}
            </p>
          ) : null}
        </Callout>
      );
    case "already_invited":
      return (
        <Callout
          tone="warning"
          icon={MailQuestion}
          title={t("admin.customers.conflicts.alreadyInvitedTitle")}
          actions={<CustomerLink customer={customer} onNavigate={onClose} />}
        >
          <p>{t("admin.customers.conflicts.alreadyInvitedText", names)}</p>
        </Callout>
      );
    case "disabled":
      return (
        <Callout
          tone="danger"
          icon={Ban}
          title={t("admin.customers.conflicts.disabledTitle")}
          actions={<CustomerLink customer={customer} onNavigate={onClose} />}
        >
          <p>{t("admin.customers.conflicts.disabledText", names)}</p>
        </Callout>
      );
    case "other_code":
      return (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t("admin.customers.conflicts.otherCodeTitle")}
          actions={
            <>
              <Button size="sm" onClick={() => onInviteInstead(customer)}>
                <Send aria-hidden />
                {t("admin.customers.conflicts.inviteExisting", { code: customer.customer_code })}
              </Button>
              <CustomerLink customer={customer} onNavigate={onClose} />
            </>
          }
        >
          <p>
            {t("admin.customers.conflicts.otherCodeText", {
              ...names,
              email: customer.email ?? "",
              requested: conflict.requestedCode,
            })}
          </p>
        </Callout>
      );
    case "no_email":
      return (
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t("admin.customers.conflicts.noEmailTitle")}
          actions={<CustomerLink customer={customer} onNavigate={onClose} />}
        >
          <p>{t("admin.customers.conflicts.noEmailText", { name: customer.full_name })}</p>
        </Callout>
      );
  }
}

function InviteOutcome({
  outcome,
  guard,
  onClose,
}: {
  outcome: Outcome;
  guard: LinkGuard;
  onClose: () => void;
}) {
  const t = useT();
  if (outcome.status === "customer_only") {
    return (
      <div className="min-w-0 space-y-4">
        <Callout
          tone="warning"
          icon={TriangleAlert}
          title={t("admin.customers.inviteDialog.customerOnlyTitle")}
          actions={<CustomerLink customer={outcome.customer} onNavigate={onClose} />}
        >
          <p>
            {t("admin.customers.inviteDialog.customerOnlyText", {
              code: outcome.customer.customer_code,
              name: outcome.customer.full_name,
              message: outcome.error.message,
            })}
          </p>
        </Callout>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("admin.customers.inviteDialog.done")}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const { customer } = outcome;
  return (
    <div className="min-w-0 space-y-4">
      <Callout
        tone="success"
        icon={CheckCircle2}
        title={
          outcome.customerCreated
            ? t("admin.customers.inviteDialog.created", {
                code: customer.customer_code,
                name: customer.full_name,
              })
            : t("admin.customers.inviteDialog.invited", {
                code: customer.customer_code,
                name: customer.full_name,
              })
        }
      />
      <ShareLinkPanel
        link={outcome.link}
        label={t("admin.invitations.linkLabel")}
        copyLabel={t("admin.invitations.copy")}
        shareText={invitationShareText({
          kind: "customer",
          fullName: customer.full_name,
          customerCode: customer.customer_code,
          email: customer.email,
          link: outcome.link,
        })}
        phone={customer.phone}
        emailed={outcome.emailed}
        linkSource={outcome.linkSource}
        notes={[
          t("admin.invitations.linkOnce"),
          t("admin.invitations.linkValid", { date: formatDateTime(outcome.expiresAt) }),
        ]}
        onShared={guard.markShared}
      />
      <UnsharedLinkPrompt guard={guard} />
      <DialogFooter className="gap-2">
        <CustomerLink
          customer={customer}
          onNavigate={(event) => {
            // Leaving for the customer page loses an unshared link too: ask first.
            if (guard.guarded) {
              event.preventDefault();
              guard.requestClose();
            } else guard.confirmClose();
          }}
        />
        <Button type="button" onClick={onClose}>
          {t("admin.customers.inviteDialog.done")}
        </Button>
      </DialogFooter>
    </div>
  );
}
