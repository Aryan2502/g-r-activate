import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { APP_ROLES, type AppRole } from "@/lib/admin/team";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Medewerker / Beheerder, each with what it may do (SPEC §35.4). */
export function RolePicker({
  idPrefix,
  label,
  value,
  onChange,
}: {
  idPrefix: string;
  label: string;
  value: AppRole;
  onChange: (value: AppRole) => void;
}) {
  const t = useT();
  const labelId = `${idPrefix}-role-label`;
  // Staff first: the everyday role.
  const roles = [...APP_ROLES].reverse();
  return (
    <div className="space-y-1.5">
      <Label id={labelId} className="block">
        {label}
      </Label>
      <RadioGroup
        id={`${idPrefix}-role`}
        aria-labelledby={labelId}
        value={value}
        onValueChange={(next) => {
          const role = APP_ROLES.find((r) => r === next);
          if (role) onChange(role);
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        {roles.map((role) => (
          <label
            key={role}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
              value === role ? "border-primary bg-cream" : "border-border",
            )}
          >
            <RadioGroupItem
              value={role}
              className="mt-0.5"
              aria-describedby={`${idPrefix}-role-${role}-hint`}
            />
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">
                {t(`admin.roles.${role}`)}
              </span>
              <span
                id={`${idPrefix}-role-${role}-hint`}
                className="mt-0.5 block text-xs leading-5 text-muted-foreground"
              >
                {t(`admin.team.role.${role}Hint`)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
