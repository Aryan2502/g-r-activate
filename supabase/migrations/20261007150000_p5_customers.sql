-- P5 (customer management, invitations): the carry-over fixes of
-- docs/PROGRESS.md.
-- 1. "Order behouden" after a cancellation request: the guarded staff RPC
--    keep_order_after_cancellation_request() clears
--    orders.cancellation_requested_at (no client may write that column),
--    resolves the open cancellation task and tells the customer why on the
--    order's history (a customer-visible message, the status stays), in one
--    transaction. The portal then stops showing the request and the customer
--    can ask again later.
-- 2. Every confirmed login without a customer record gives staff a task.
--    handle_new_user created nothing when public sign-up was switched off at
--    confirmation time, or when a staff invitation was open for the address.
--    It now raises a task in both cases (and checks a known e-mail before the
--    sign-up switch, so a known customer who registers while sign-up is off
--    gets the "send the invitation link" task, not a generic one).
-- 3. redeem_invitation resolves those tasks too: the person behind the address
--    has now been linked through their invitation. A login that the
--    invitation itself created or confirmed (app_metadata.invitation_id, paths
--    a and b) takes its profile name from the invitation, never from what a
--    stranger typed when pre-registering the address.
-- 4. Team page /admin/team (SPEC §35.4): "Deactiveren" of a staff member bans
--    the login (auth.admin, server code). A blocked login now holds no role:
--    has_role()/is_staff() (and so is_admin()) ignore users whose
--    auth.users.banned_until lies in the future, so the access token that
--    is still valid stops working at once, and their open invitations stop
--    redeeming. set_user_role keeps one admin who can still sign in.
--    team_members() lists the team for every staff member (user_roles is
--    only readable by admins, e-mail addresses live in auth.users), and
--    log_team_login_change() audits a (de)activation and revokes the open
--    invitations of a blocked inviter, leaving a note on every customer
--    whose link stopped working.
-- 5. Invitations (SPEC §35.6): get_invitation reports an invitation whose
--    inviter no longer holds the rights to create it as revoked, so the
--    /invite page says so and the server never touches Auth for it; the
--    resend limits (once a minute, five times per Suriname day) hold per
--    e-mail address, so "Intrekken" + a new invitation cannot get round them.
-- Signatures of existing functions are unchanged; the new RPCs are closed to
-- everyone but authenticated (and guarded inside).

-- ===========================================================================
-- 1. Keep an order after a cancellation request
-- ===========================================================================

create or replace function public.keep_order_after_cancellation_request(
  _order_id uuid,
  _customer_message text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _order record;
  _resolved integer;
  _msg text := coalesce(
    nullif(btrim(_customer_message), ''),
    'Uw annuleringsverzoek is niet doorgevoerd: deze order wordt niet geannuleerd en wordt gewoon verder verwerkt.'
  );
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if char_length(_msg) > 2000 then
    raise exception 'Het bericht voor de klant is te lang (maximaal 2000 tekens)' using errcode = '22023';
  end if;

  select o.id, o.reference, o.status, o.cancellation_requested_at, s.stage into _order
  from public.orders o join public.shipment_statuses s on s.code = o.status
  where o.id = _order_id
  for update of o;
  if not found then
    raise exception 'Order niet gevonden' using errcode = 'P0002';
  end if;
  if _order.stage = 'cancelled' then
    raise exception 'Order % is al geannuleerd', _order.reference using errcode = '55000';
  end if;

  update public.staff_tasks t
     set resolved_at = now(), resolved_by = _uid
   where t.kind = 'order_cancellation_request' and t.order_id = _order.id and t.resolved_at is null;
  get diagnostics _resolved = row_count;

  if _order.cancellation_requested_at is null and _resolved = 0 then
    raise exception 'Er staat geen annuleringsverzoek open voor order %', _order.reference
      using errcode = '55000';
  end if;

  if _order.cancellation_requested_at is not null then
    perform set_config('app.order_internal_write', 'on', true);
    perform set_config('app.audit_reason', 'Annuleringsverzoek afgehandeld: order behouden', true);
    update public.orders o set cancellation_requested_at = null where o.id = _order.id;
    perform set_config('app.audit_reason', '', true);
    perform set_config('app.order_internal_write', '', true);

    -- The customer saw "Annulering aangevraagd" on the order page; the answer
    -- appears in the order's history there (the status itself stays), the
    -- same way a new "Actie vereist" message does.
    insert into public.shipment_status_history
      (order_id, from_status, to_status, changed_by, changed_at, customer_message)
    values (_order.id, _order.status, _order.status, _uid, now(), _msg);
  end if;
end
$$;

-- ===========================================================================
-- 2. Sign-up hook: a task for every confirmed login without a customer record
-- ===========================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _email text := nullif(lower(btrim(new.email)), '');
  _c public.customers;
  _known_customer_id uuid;
  _known_code text;
  _constraint text;
begin
  _c.full_name := left(nullif(btrim(_meta ->> 'full_name'), ''), 200);

  insert into public.profiles (id, display_name)
  values (new.id, _c.full_name)
  on conflict (id) do nothing;

  if new.email_confirmed_at is null
     or _email is null
     or nullif(new.raw_app_meta_data ->> 'invitation_id', '') is not null
     or exists (select 1 from public.user_roles r where r.user_id = new.id)
     or exists (select 1 from public.customers c where c.user_id = new.id) then
    return null;
  end if;

  -- Someone invited as staff gets no customer record; the invitation link
  -- (path c: log in, then redeem) grants the role. Staff hear about it, and
  -- redeem_invitation resolves the task (same e-mail).
  if exists (
    select 1 from public.invitations i
    where i.email = _email and i.kind = 'staff' and i.accepted_at is null and i.revoked_at is null
  ) then
    perform private.add_staff_task(
      'signup_email_conflict',
      null,
      format(
        'Nieuwe registratie van %s (%s) is niet gekoppeld: er staat een open uitnodiging als medewerker voor dit e-mailadres. Vraag de persoon de uitnodigingslink te openen en daar in te loggen met het gekozen wachtwoord.',
        coalesce(_c.full_name, 'onbekend'), _email),
      _email => _email);
    return null;
  end if;

  -- An e-mail that G&R already knows is never auto-linked, whatever the
  -- sign-up switch says: staff send the invitation link.
  select c.id, c.customer_code into _known_customer_id, _known_code
  from public.customers c where lower(c.email) = _email;
  if not found then
    select i.customer_id into _known_customer_id
    from public.invitations i
    where i.email = _email and i.kind = 'customer' and i.accepted_at is null and i.revoked_at is null;
  end if;
  if found then
    perform private.add_staff_task(
      'signup_email_conflict',
      _known_customer_id,
      format(
        'Nieuwe registratie van %s (%s) is niet gekoppeld: G&R heeft al een klantdossier%s of een open uitnodiging voor dit e-mailadres. Stuur de klant een (nieuwe) uitnodigingslink.',
        coalesce(_c.full_name, 'onbekend'), _email,
        case when _known_code is null then '' else ' (' || _known_code || ')' end),
      _email => _email);
    return null;
  end if;

  -- The switch also holds for sign-ups made straight against the Auth API.
  if not coalesce((select s.public_signup_enabled from public.company_settings s where s.id), true) then
    perform private.add_staff_task(
      'signup_customer_failed',
      null,
      format(
        'Nieuwe registratie van %s (%s) terwijl registreren uitstaat: er is geen klantdossier aangemaakt. Maak de klant aan met ‘Klant toevoegen’ en stuur een uitnodigingslink, of laat deze login ongebruikt.',
        coalesce(_c.full_name, 'onbekend'), _email),
      _email => _email);
    return null;
  end if;

  _c.user_id := new.id;
  _c.email := _email;
  _c.full_name := coalesce(_c.full_name, left(split_part(_email, '@', 1), 200));
  _c.phone := left(coalesce(nullif(btrim(_meta ->> 'phone'), ''), new.phone), 50);
  _c.company_name := left(nullif(btrim(_meta ->> 'company_name'), ''), 200);
  _c.account_type := case
    when _meta ->> 'account_type' = 'business' and _c.company_name is not null then 'business'
    else 'personal'
  end::public.account_type;
  if _c.account_type = 'personal' then
    _c.company_name := null;
  end if;
  _c.terms_version := left(nullif(btrim(_meta ->> 'terms_version'), ''), 50);
  _c.terms_accepted_at := case when _c.terms_version is not null then coalesce(new.created_at, now()) end;
  _c.status := 'active';
  _c.created_by := new.id;
  _c.updated_by := new.id;

  -- Never block the Auth server: if the customer cannot be created, the user
  -- still gets confirmed and staff get a task to sort it out.
  begin
    perform private.insert_customer(_c);
  exception when others then
    get stacked diagnostics _constraint = constraint_name;
    -- customers_user_id_key: a concurrent confirmation already created it.
    if _constraint is distinct from 'customers_user_id_key' then
      perform private.add_staff_task(
        'signup_customer_failed',
        null,
        format(
          'Nieuwe registratie van %s (%s): het klantdossier kon niet automatisch worden aangemaakt (%s). Maak de klant handmatig aan en stuur een uitnodigingslink.',
          coalesce(_c.full_name, 'onbekend'), _email, sqlerrm),
        _email => _email);
    end if;
  end;
  return null;
end
$$;

-- ===========================================================================
-- 3. Redemption resolves every sign-up task about the redeemed address
-- ===========================================================================

create or replace function public.redeem_invitation(_token_hash text, _user_id uuid)
returns table (invitation_id uuid, kind public.invitation_kind, customer_id uuid, staff_role public.app_role)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _inv public.invitations;
  _user_email text;
  _via_link boolean;
  _cust public.customers;
  _linked_code text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  select * into _inv from public.invitations i where i.token_hash = lower(btrim(_token_hash)) for update;
  if not found then
    raise exception 'Uitnodiging niet gevonden' using errcode = 'P0002';
  end if;
  if _inv.accepted_at is not null then
    if _inv.accepted_by = _user_id then
      return query select _inv.id, _inv.kind, _inv.customer_id, _inv.staff_role;
      return;
    end if;
    raise exception 'Deze uitnodiging is al gebruikt' using errcode = '55000';
  end if;
  if _inv.revoked_at is not null then
    raise exception 'Deze uitnodiging is ingetrokken' using errcode = '55000';
  end if;
  if _inv.expires_at <= now() then
    raise exception 'Deze uitnodiging is verlopen' using errcode = '55000';
  end if;

  -- _via_link: the server created (path a) or confirmed (path b) this login
  -- for this very invitation (app_metadata.invitation_id), so whatever a
  -- stranger typed when pre-registering the address is not the person's name.
  select lower(u.email), coalesce(u.raw_app_meta_data ->> 'invitation_id' = _inv.id::text, false)
    into _user_email, _via_link
  from auth.users u where u.id = _user_id;
  if not found then
    raise exception 'Gebruiker niet gevonden' using errcode = 'P0002';
  end if;
  if _user_email is distinct from _inv.email then
    raise exception 'Het e-mailadres van dit account hoort niet bij deze uitnodiging' using errcode = '42501';
  end if;
  -- Second fence behind user_roles_revoke_invitations: the inviter must still
  -- hold the rights to create this invitation (a null inviter is the SQL editor).
  if _inv.created_by is not null and not (
       public.has_role(_inv.created_by, 'admin')
       or (_inv.kind = 'customer' and public.has_role(_inv.created_by, 'staff'))) then
    raise exception 'Deze uitnodiging is niet meer geldig; vraag een nieuwe uitnodiging aan' using errcode = '55000';
  end if;

  if _inv.kind = 'customer' then
    select * into _cust from public.customers c where c.id = _inv.customer_id for update;
    if _cust.user_id is not null and _cust.user_id <> _user_id then
      raise exception 'Dit klantdossier is al aan een ander account gekoppeld' using errcode = '55000';
    end if;
    if _cust.status = 'disabled' then
      raise exception 'Dit klantdossier is gedeactiveerd' using errcode = '55000';
    end if;
    -- Second fence behind customers_revoke_stale_invitations: the link only
    -- works for the address the customer record has now.
    if _cust.email is distinct from _inv.email then
      raise exception 'Het e-mailadres van dit klantdossier is gewijzigd; vraag een nieuwe uitnodiging aan'
        using errcode = '55000';
    end if;
    select c.customer_code into _linked_code
    from public.customers c where c.user_id = _user_id and c.id <> _cust.id;
    if found then
      raise exception 'Dit account is al gekoppeld aan klantdossier %', _linked_code using errcode = '55000';
    end if;
    update public.customers c
       set user_id = _user_id, status = 'active', updated_by = _user_id
     where c.id = _cust.id;
    update public.profiles p
       set display_name = _cust.full_name
     where p.id = _user_id and (p.display_name is null or _via_link);
  else
    insert into public.user_roles (user_id, role, created_by)
    values (_user_id, _inv.staff_role, _inv.created_by)
    on conflict (user_id, role) do nothing;
    -- A staff invitation carries no name: the invitee gives one on the page.
    if _via_link then
      update public.profiles p set display_name = null where p.id = _user_id;
    end if;
  end if;

  -- A self-registration with this e-mail may have raised a task (a known
  -- address, sign-up switched off, an open staff invitation, or a failed
  -- customer insert); it is solved now. GoTrue can confirm the e-mail before
  -- it writes invitation_id (path b), so the sign-up trigger may have run
  -- without knowing about the invitation.
  update public.staff_tasks t
     set resolved_at = now(), resolved_by = _user_id
   where t.kind in ('signup_email_conflict', 'signup_customer_failed')
     and t.resolved_at is null
     and (t.email = _inv.email
          or (t.kind = 'signup_email_conflict' and _inv.kind = 'customer' and t.customer_id = _inv.customer_id));

  update public.invitations i
     set accepted_at = now(), accepted_by = _user_id, updated_by = _user_id
   where i.id = _inv.id;

  return query select _inv.id, _inv.kind, _inv.customer_id, _inv.staff_role;
end
$$;

-- ===========================================================================
-- Grants: the new RPC for signed-in users only (guarded inside); replaced
-- functions keep theirs, restated so this file is complete on its own.
-- ===========================================================================

revoke all on function public.keep_order_after_cancellation_request(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.keep_order_after_cancellation_request(uuid, text) to authenticated;

revoke all on function public.redeem_invitation(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.redeem_invitation(text, uuid) to service_role;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

-- ===========================================================================
-- 4. Team: a blocked login holds no role; the team list; (de)activation log
-- ===========================================================================

-- A login is blocked while auth.users.banned_until lies in the future
-- (auth.admin.updateUserById ban_duration; 'none' clears it).
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    where r.user_id = _user_id and r.role = _role
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    where r.user_id = (select auth.uid()) and r.role in ('admin', 'staff')
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;

-- Same guard and messages as before, plus: the team keeps at least one admin
-- whose login is not blocked (the caller is one, so this only stops an admin
-- removing their own admin role while every other admin is blocked).
create or replace function public.set_user_role(_user_id uuid, _role public.app_role, _grant boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _user_id is null or _role is null or _grant is null then
    raise exception 'Gebruiker, rol en actie zijn verplicht' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = _user_id) then
    raise exception 'Gebruiker niet gevonden' using errcode = 'P0002';
  end if;

  if _grant then
    insert into public.user_roles (user_id, role, created_by)
    values (_user_id, _role, (select auth.uid()))
    on conflict (user_id, role) do nothing;
    return;
  end if;

  if _role = 'admin' then
    -- Lock all admin rows so two concurrent demotions cannot both pass.
    perform 1 from public.user_roles r where r.role = 'admin' for update;
    if exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = 'admin') then
      if (select count(*) from public.user_roles r where r.role = 'admin') <= 1 then
        raise exception 'De laatste beheerder kan niet worden verwijderd' using errcode = '55000';
      end if;
      if not exists (
        select 1
        from public.user_roles r
        join auth.users u on u.id = r.user_id
        where r.role = 'admin' and r.user_id <> _user_id
          and (u.banned_until is null or u.banned_until <= now())
      ) then
        raise exception 'De laatste actieve beheerder kan niet worden verwijderd: de andere beheerders zijn gedeactiveerd'
          using errcode = '55000';
      end if;
    end if;
  end if;
  delete from public.user_roles r where r.user_id = _user_id and r.role = _role;
end
$$;

-- Everyone with a role, for the team page. Staff read it too (SPEC §35.4:
-- staff see the team, admins change it); user_roles itself stays readable
-- by admins only, and nothing here is a secret beyond what profiles shows.
create or replace function public.team_members()
returns table (
  user_id uuid,
  display_name text,
  email text,
  roles public.app_role[],
  blocked boolean,
  last_sign_in_at timestamptz,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_staff()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select u.id,
           p.display_name,
           u.email::text,
           array_agg(r.role order by r.role),
           coalesce(u.banned_until > now(), false),
           u.last_sign_in_at,
           min(r.created_at)
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = u.id
    group by u.id, p.display_name, u.email, u.banned_until, u.last_sign_in_at
    order by lower(coalesce(nullif(btrim(p.display_name), ''), u.email::text)), u.id;
end
$$;

-- The database half of "Deactiveren"/"Activeren" on the team page. The
-- server function bans or unbans the login with auth.admin first (the
-- service role), then calls this with the admin's own client: the audit
-- entry (who, when, why) and, when blocking, the end of the blocked
-- person's invitations that were never accepted (has_role already makes
-- them unredeemable; revoking shows it on every page). Customer invitations
-- go too: the blocked person saw those links once and could still use them.
-- Every customer whose link stops working gets an internal note that says
-- why, so staff know whom to send a new link. Returns how many of the
-- revoked invitations were still open (not yet expired).
create or replace function public.log_team_login_change(_user_id uuid, _blocked boolean, _reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _revoked integer := 0;
  _name text;
begin
  if not (select public.is_admin()) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  if _user_id is null or _blocked is null then
    raise exception 'Gebruiker en actie zijn verplicht' using errcode = '22023';
  end if;
  if nullif(btrim(_reason), '') is null then
    raise exception 'Een reden is verplicht' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_roles r where r.user_id = _user_id) then
    raise exception 'Deze login hoort niet bij het team' using errcode = 'P0002';
  end if;
  if _blocked and _user_id = (select auth.uid()) then
    raise exception 'U kunt uw eigen login niet deactiveren' using errcode = '55000';
  end if;

  if _blocked then
    select coalesce(nullif(btrim(p.display_name), ''), u.email::text) into _name
    from auth.users u left join public.profiles p on p.id = u.id
    where u.id = _user_id;

    perform set_config('app.audit_reason',
      left(format('Ingetrokken: login van %s gedeactiveerd', coalesce(_name, 'een teamlid')), 500), true);
    with revoked as (
      update public.invitations i
         set revoked_at = now()
       where i.created_by = _user_id and i.accepted_at is null and i.revoked_at is null
      returning i.kind, i.customer_id, i.expires_at
    ),
    notes as (
      insert into public.internal_notes (customer_id, body)
      select distinct r.customer_id,
             format('De uitnodigingslink van deze klant werkt niet meer: hij is ingetrokken omdat de login van %s (die de uitnodiging maakte) is gedeactiveerd. Maak een nieuwe uitnodiging met ‘Uitnodigen’.',
                    coalesce(_name, 'een teamlid'))
      from revoked r
      where r.kind = 'customer' and r.customer_id is not null
      returning 1
    )
    select count(*) filter (where r.expires_at > now()) into _revoked
    from revoked r;
    perform set_config('app.audit_reason', '', true);
  end if;

  insert into public.audit_log (actor_id, table_name, record_id, action, old_data, new_data, changed_columns, reason)
  values ((select auth.uid()), 'team_login', _user_id::text, 'UPDATE',
          jsonb_build_object('login_blocked', not _blocked),
          jsonb_build_object('login_blocked', _blocked),
          array['login_blocked'], left(btrim(_reason), 500));
  return _revoked;
end
$$;

revoke all on function
  public.has_role(uuid, public.app_role),
  public.is_staff(),
  public.set_user_role(uuid, public.app_role, boolean),
  public.team_members(),
  public.log_team_login_change(uuid, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.has_role(uuid, public.app_role),
  public.is_staff(),
  public.set_user_role(uuid, public.app_role, boolean),
  public.team_members(),
  public.log_team_login_change(uuid, boolean, text)
to authenticated;

-- ===========================================================================
-- 5. Invitations: an inviter without rights revokes; limits per address
-- ===========================================================================

-- Same signature and columns. An open invitation whose inviter no longer
-- holds the rights to create it (blocked, or the role removed outside the
-- app) is reported as revoked (revoked_at = now()): redeem_invitation refuses
-- it anyway, and this way the /invite page says so and the server never
-- creates or changes a login for it (SPEC §35.6 path b changes a password
-- before redeeming). A null inviter is the SQL editor.
create or replace function public.get_invitation(_token_hash text)
returns table (
  invitation_id uuid,
  kind public.invitation_kind,
  email text,
  staff_role public.app_role,
  customer_id uuid,
  customer_code text,
  full_name text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  is_expired boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  return query
    select i.id, i.kind, i.email, i.staff_role, i.customer_id, c.customer_code, c.full_name,
           i.expires_at, i.accepted_at,
           coalesce(
             i.revoked_at,
             case
               when i.accepted_at is null
                and i.created_by is not null
                and not (public.has_role(i.created_by, 'admin')
                         or (i.kind = 'customer' and public.has_role(i.created_by, 'staff')))
               then now()
             end),
           i.expires_at <= now()
    from public.invitations i
    left join public.customers c on c.id = i.customer_id
    where i.token_hash = lower(btrim(_token_hash));
end
$$;

-- As in the identity migration, plus: the resend limits of SPEC §35.6 (once
-- a minute, five times per Suriname day) count every invitation to the same
-- address, revoked ones included, and also hold for a NEW invitation. So
-- "Intrekken" + "Uitnodigen" cannot send more often than "Opnieuw versturen"
-- (P8 e-mails every send). Staff clients only; the service role and the SQL
-- editor are not limited, as before.
create or replace function private.invitations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
  _today date := (now() at time zone 'America/Paramaribo')::date;
  _customer record;
  _rotated boolean := false;
  _last_sent timestamptz;
  _sent_today bigint;
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'UPDATE' then
    _rotated := new.token_hash is distinct from old.token_hash;
  end if;

  if tg_op = 'INSERT' then
    if _uid is not null then
      -- BEFORE triggers run ahead of the RLS check: deny first, so outsiders
      -- never learn anything from the validation messages below.
      if not public.is_staff() or (new.kind = 'staff' and not public.is_admin()) then
        raise exception 'Geen toegang' using errcode = '42501';
      end if;
      new.created_at := now();
      new.created_by := _uid;
      new.updated_by := _uid;
      new.expires_at := now() + interval '7 days';
      new.accepted_at := null;
      new.accepted_by := null;
      new.revoked_at := null;
    end if;
    new.last_sent_at := now();
    new.send_count := 1;
  elsif _uid is not null then
    if (new.kind, new.customer_id, new.staff_role, new.email, new.created_at, new.created_by,
        new.accepted_at, new.accepted_by, new.expires_at, new.last_sent_at, new.send_count)
       is distinct from
       (old.kind, old.customer_id, old.staff_role, old.email, old.created_at, old.created_by,
        old.accepted_at, old.accepted_by, old.expires_at, old.last_sent_at, old.send_count) then
      raise exception 'Geen toegang: een uitnodiging kan alleen opnieuw verstuurd of ingetrokken worden'
        using errcode = '42501';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'Een ingetrokken uitnodiging kan niet worden heropend' using errcode = '55000';
    end if;
    if old.revoked_at is null and new.revoked_at is not null then
      if old.accepted_at is not null then
        raise exception 'Deze uitnodiging is al geaccepteerd' using errcode = '55000';
      end if;
      new.revoked_at := now();
    end if;
  end if;

  if _rotated then
    if old.accepted_at is not null or old.revoked_at is not null or new.revoked_at is not null then
      raise exception 'Deze uitnodiging is niet meer open' using errcode = '55000';
    end if;
    if _uid is not null then
      if old.last_sent_at > now() - interval '1 minute' then
        raise exception 'Wacht een minuut voordat u de uitnodiging opnieuw verstuurt' using errcode = '55000';
      end if;
      if (old.last_sent_at at time zone 'America/Paramaribo')::date = _today and old.send_count >= 5 then
        raise exception 'Deze uitnodiging is vandaag al 5 keer verstuurd' using errcode = '55000';
      end if;
    end if;
    new.send_count := case
      when (old.last_sent_at at time zone 'America/Paramaribo')::date = _today then old.send_count + 1
      else 1
    end;
    new.last_sent_at := now();
    new.expires_at := now() + interval '7 days';
  end if;

  -- The same limits per address: every send to this e-mail counts, whichever
  -- invitation row it was (a BEFORE trigger: the table still holds this
  -- row's previous send, the new one is not in it yet). A second OPEN
  -- invitation is left to invitations_one_open_per_email ("al uitgenodigd").
  if _uid is not null
     and (_rotated or (tg_op = 'INSERT' and not exists (
           select 1 from public.invitations i
           where i.email = new.email and i.accepted_at is null and i.revoked_at is null))) then
    select max(i.last_sent_at),
           coalesce(sum(i.send_count) filter (
             where (i.last_sent_at at time zone 'America/Paramaribo')::date = _today), 0)
      into _last_sent, _sent_today
    from public.invitations i
    where i.email = new.email;
    if _last_sent > now() - interval '1 minute' then
      raise exception 'Wacht een minuut: er is net al een uitnodiging naar % verstuurd', new.email
        using errcode = '55000';
    end if;
    if _sent_today >= 5 then
      raise exception 'Er zijn vandaag al 5 uitnodigingen naar % verstuurd; probeer het morgen opnieuw', new.email
        using errcode = '55000';
    end if;
  end if;

  if new.kind = 'customer' and (tg_op = 'INSERT' or _rotated) then
    select c.user_id, c.status, c.email into _customer
    from public.customers c where c.id = new.customer_id;
    if not found then
      raise exception 'Klant niet gevonden' using errcode = 'P0002';
    end if;
    if _customer.user_id is not null then
      raise exception 'Deze klant heeft al een account' using errcode = '55000';
    end if;
    if _customer.status = 'disabled' then
      raise exception 'Deze klant is gedeactiveerd' using errcode = '55000';
    end if;
    if _customer.email is null or _customer.email <> new.email then
      raise exception 'Een uitnodiging gaat altijd naar het e-mailadres van het klantdossier' using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.get_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.get_invitation(text) to service_role;
revoke all on function private.invitations_guard() from public, anon, authenticated, service_role;
