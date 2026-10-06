-- =====================================================================
-- ValijApp v2 — Supabase schema. Idempotent: safe to run again.
-- Paste the whole file in Supabase → SQL Editor → Run.
-- Also upgrades a database that ran an older version (activation-code flow is removed).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
-- the admin view is recreated below; dropping it first lets old columns be removed
drop view if exists public.clients_admin;

create sequence if not exists public.clients_id_seq;

create table if not exists public.clients (
  id int primary key default nextval('public.clients_id_seq'),
  legacy_key text unique,              -- normalized v1 name, used by the migration
  name text not null,                  -- admin's internal name (hidden from the client)
  display_name text,                   -- chosen by the client
  phone text,
  address text,
  email text,
  avatar_path text,
  notes text,                          -- admin notes (hidden from the client)
  user_id uuid unique references auth.users (id) on delete set null,
  auth_email text,                     -- hidden from the client
  created_at timestamptz not null default now()
);

-- ---- upgrade from the activation-code version: remove everything it used ----
drop function if exists public.check_activation(int, text);
drop function if exists public.claim_client(int, text);
drop function if exists public._activation_status(int, text);
drop function if exists public.admin_new_code(int);
drop function if exists public.admin_reset_access(int);
drop function if exists public.random_code6();
drop table if exists public.claim_attempts;
alter table public.clients drop column if exists activation_code;
alter table public.clients drop column if exists activation_code_expires_at;
alter sequence public.clients_id_seq owned by public.clients.id;

-- Field limits (what clients can write themselves)
alter table public.clients drop constraint if exists clients_display_name_len;
alter table public.clients add constraint clients_display_name_len check (display_name is null or char_length(display_name) <= 60);
alter table public.clients drop constraint if exists clients_phone_len;
alter table public.clients add constraint clients_phone_len check (phone is null or char_length(phone) <= 30);
alter table public.clients drop constraint if exists clients_address_len;
alter table public.clients add constraint clients_address_len check (address is null or char_length(address) <= 200);
alter table public.clients drop constraint if exists clients_email_len;
alter table public.clients add constraint clients_email_len check (email is null or char_length(email) <= 120);
alter table public.clients drop constraint if exists clients_avatar_path_format;
alter table public.clients add constraint clients_avatar_path_format
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/avatar-[0-9]+\.jpg$');

-- The avatar must live in the folder of the linked auth user.
create or replace function public.clients_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.avatar_path is not null and new.user_id is not null
     and split_part(new.avatar_path, '/', 1) <> new.user_id::text then
    raise exception 'avatar_path must start with the owner user id';
  end if;
  return new;
end $$;
drop trigger if exists clients_guard on public.clients;
create trigger clients_guard before insert or update on public.clients for each row execute function public.clients_guard();

-- Keep the sequence ahead of manually chosen numbers (on insert and on renumbering). Never moves backwards.
create or replace function public.clients_bump_seq()
returns trigger language plpgsql security definer set search_path = public as $$
declare lv bigint; called boolean;
begin
  select last_value, is_called into lv, called from public.clients_id_seq;
  if new.id > lv or (new.id = lv and not called) then
    perform setval('public.clients_id_seq', new.id, true);
  end if;
  return new;
end $$;
drop trigger if exists clients_bump_seq on public.clients;
create trigger clients_bump_seq after insert or update of id on public.clients
  for each row execute function public.clients_bump_seq();
do $$
declare m int; lv bigint; called boolean;
begin
  select last_value, is_called into lv, called from public.clients_id_seq;
  select max(id) into m from public.clients;
  if m is not null and (m > lv or (m = lv and not called)) then
    perform setval('public.clients_id_seq', m, true);
  end if;
end $$;

create or replace function public.my_client_id()
returns int language sql stable security definer set search_path = public as $$
  select id from public.clients where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Ledger (mirrors v1 "movimientos": one row = sale and/or payment)
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  kind text not null check (kind in ('fixed', 'percent')),
  value numeric not null check (value >= 0),
  starts_on date,
  ends_on date,
  all_clients boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.coupons drop constraint if exists coupons_percent_max;
alter table public.coupons add constraint coupons_percent_max check (kind <> 'percent' or value <= 100);

create table if not exists public.coupon_targets (
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  client_id int not null references public.clients (id) on delete cascade on update cascade,
  primary key (coupon_id, client_id)
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  client_id int not null references public.clients (id) on delete cascade on update cascade,
  date date not null,
  detail text not null default '',
  total numeric not null default 0,      -- what she owes for this sale, after discount
  paid numeric not null default 0,       -- what she paid in this row
  coupon_id uuid references public.coupons (id) on delete set null,
  discount_amount numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists movements_client_idx on public.movements (client_id, date);
create index if not exists movements_date_idx on public.movements (date);
alter table public.movements drop constraint if exists movements_amounts_nonneg;
alter table public.movements add constraint movements_amounts_nonneg check (total >= 0 and paid >= 0 and discount_amount >= 0);

-- ---------------------------------------------------------------------
-- Admin-only business tables
-- ---------------------------------------------------------------------
create table if not exists public.trips (            -- v1 "viajes": period start + investment
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  starts_on date not null,
  investment numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_movements (   -- v1 "caja"
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  kind text not null check (kind in ('RETIRO', 'PRESTAMO', 'DEVOLUCION', 'INGRESO', 'GASTO', 'AJUSTE')),
  person text not null default '',                   -- 'J' / 'M' for RETIRO, lender for loans
  date date not null,
  amount numeric not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
-- insertion order, used to break ties between rows of the same date (v1 kept array order)
alter table public.cash_movements add column if not exists seq bigint generated by default as identity;

create table if not exists public.places (           -- v1 "lugares"
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  mall text not null default '',
  aisle text not null default '',
  stand text not null default '',
  phone text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (         -- v1 "ajustes", single row
  id int primary key default 1 check (id = 1),
  partner1_name text not null default 'JOACO',
  partner1_pct numeric not null default 25,
  partner2_name text not null default 'ALE',
  partner2_pct numeric not null default 25,
  inactive_days int not null default 45,
  cash_since date,
  cash_initial numeric not null default 0,
  sheets_url text not null default '',
  legacy_imported_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- One row per migration / import run, with the rows that could not be uploaded.
create table if not exists public.migration_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null,
  summary jsonb not null default '{}'::jsonb,
  skipped jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------
-- Broadcasts ("Novedades")
-- ---------------------------------------------------------------------
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  emoji text not null default '',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_reads (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  client_id int not null references public.clients (id) on delete cascade on update cascade,
  read_at timestamptz not null default now(),
  primary key (broadcast_id, client_id)
);

-- ---------------------------------------------------------------------
-- Admin-set passwords (so the admin can resend them). Written only by the Edge Function
-- admin-client-auth (service role); the admin can read them; clients never can.
-- Passwords a client chooses herself are never stored (see forget_my_stored_password()).
-- ---------------------------------------------------------------------
create table if not exists public.client_credentials (
  client_id int primary key references public.clients (id) on delete cascade on update cascade,
  password text not null,
  set_at timestamptz not null default now()
);

-- =====================================================================
-- Privileges: nothing by default, then the minimum each role needs.
-- RLS (below) decides which rows.
-- =====================================================================
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- clients: column-level. Clients never see name, notes or auth_email.
-- The admin reads/writes every column through the clients_admin view.
grant select (id, display_name, phone, address, email, avatar_path, user_id, created_at) on public.clients to authenticated;
grant update (display_name, phone, address, email, avatar_path) on public.clients to authenticated;

grant select, insert, update, delete on public.movements      to authenticated;
grant select, insert, update, delete on public.coupons        to authenticated;
grant select                         on public.coupon_targets to authenticated; -- writes go through set_coupon_targets()
grant select, insert, update, delete on public.trips          to authenticated;
grant select, insert, update, delete on public.cash_movements to authenticated;
grant select, insert, update, delete on public.places         to authenticated;
grant select, update                 on public.settings       to authenticated;
grant select, insert                 on public.migration_reports to authenticated;
grant select, insert, update, delete on public.broadcasts     to authenticated;
grant select, insert                 on public.broadcast_reads to authenticated;
grant select                         on public.client_credentials to authenticated; -- RLS: admin only; writes only via service role
-- admins: no direct access (only through security definer functions)

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.admins            enable row level security;
alter table public.clients           enable row level security;
alter table public.movements         enable row level security;
alter table public.coupons           enable row level security;
alter table public.coupon_targets    enable row level security;
alter table public.trips             enable row level security;
alter table public.cash_movements    enable row level security;
alter table public.places            enable row level security;
alter table public.settings          enable row level security;
alter table public.migration_reports enable row level security;
alter table public.broadcasts        enable row level security;
alter table public.broadcast_reads   enable row level security;
alter table public.client_credentials enable row level security;

drop policy if exists admins_read on public.admins;

-- clients: a client sees and edits only her own row (columns limited by the grants above)
drop policy if exists clients_self_read on public.clients;
create policy clients_self_read on public.clients for select to authenticated
  using (user_id = auth.uid());
drop policy if exists clients_self_update on public.clients;
create policy clients_self_update on public.clients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin view over clients: runs with the owner's rights (bypasses the column grants above)
-- and only returns/accepts rows when the caller is an admin.
drop view if exists public.clients_admin;
create view public.clients_admin with (security_barrier = true) as
  select id, legacy_key, name, display_name, phone, address, email, avatar_path, notes,
         user_id, auth_email, created_at
  from public.clients
  where public.is_admin()
  with cascaded check option;
alter view public.clients_admin alter column id set default nextval('public.clients_id_seq');
alter view public.clients_admin alter column created_at set default now();
revoke all on public.clients_admin from anon, authenticated;
grant select, insert, update, delete on public.clients_admin to authenticated;
-- the view's id default calls nextval() as the caller
grant usage on sequence public.clients_id_seq to authenticated;

-- movements
drop policy if exists movements_admin on public.movements;
create policy movements_admin on public.movements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists movements_own on public.movements;
create policy movements_own on public.movements for select to authenticated
  using (client_id = public.my_client_id());

-- coupons: clients see active, current coupons aimed at them, plus coupons used on their own sales
drop policy if exists coupons_admin on public.coupons;
create policy coupons_admin on public.coupons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists coupons_client on public.coupons;
create policy coupons_client on public.coupons for select to authenticated
  using (
    public.my_client_id() is not null and (
      (active
        and (starts_on is null or starts_on <= current_date)
        and (ends_on is null or ends_on >= current_date)
        and (all_clients or exists (
          select 1 from public.coupon_targets t where t.coupon_id = coupons.id and t.client_id = public.my_client_id())))
      or exists (select 1 from public.movements m where m.coupon_id = coupons.id and m.client_id = public.my_client_id())
    )
  );

drop policy if exists coupon_targets_admin on public.coupon_targets;
create policy coupon_targets_admin on public.coupon_targets for select to authenticated
  using (public.is_admin());
drop policy if exists coupon_targets_own on public.coupon_targets;
create policy coupon_targets_own on public.coupon_targets for select to authenticated
  using (client_id = public.my_client_id());

-- admin-only tables
do $$
declare t text;
begin
  foreach t in array array['trips', 'cash_movements', 'places', 'settings', 'migration_reports'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;
drop policy if exists client_credentials_admin_read on public.client_credentials;
create policy client_credentials_admin_read on public.client_credentials for select to authenticated
  using (public.is_admin());

-- broadcasts
drop policy if exists broadcasts_admin on public.broadcasts;
create policy broadcasts_admin on public.broadcasts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists broadcasts_client on public.broadcasts;
create policy broadcasts_client on public.broadcasts for select to authenticated
  using (public.my_client_id() is not null and starts_at <= now() and (ends_at is null or ends_at > now()));

drop policy if exists broadcast_reads_admin on public.broadcast_reads;
create policy broadcast_reads_admin on public.broadcast_reads for select to authenticated
  using (public.is_admin());
drop policy if exists broadcast_reads_own_read on public.broadcast_reads;
create policy broadcast_reads_own_read on public.broadcast_reads for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists broadcast_reads_own_insert on public.broadcast_reads;
create policy broadcast_reads_own_insert on public.broadcast_reads for insert to authenticated
  with check (client_id = public.my_client_id());

-- =====================================================================
-- RPCs
-- =====================================================================

-- Who am I? Used right after login to route to the admin or the client app.
create or replace function public.my_role()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('is_admin', public.is_admin(), 'client_id', public.my_client_id());
$$;

-- Client login: number -> internal auth email (null when she has no access yet).
create or replace function public.client_login_email(p_client_id int)
returns text language sql stable security definer set search_path = public as $$
  select auth_email from public.clients where id = p_client_id and user_id is not null;
$$;

-- Client changed her own password: forget the copy the admin had set (it is no longer valid).
create or replace function public.forget_my_stored_password()
returns void language sql volatile security definer set search_path = public as $$
  delete from public.client_credentials where client_id = public.my_client_id();
$$;

-- Admin: replace the target clients of a coupon atomically.
create or replace function public.set_coupon_targets(p_coupon_id uuid, p_client_ids int[])
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from public.coupon_targets where coupon_id = p_coupon_id;
  insert into public.coupon_targets (coupon_id, client_id)
  select distinct p_coupon_id, unnest(coalesce(p_client_ids, '{}'::int[]));
end $$;

-- Function privileges: only what each role needs
revoke all on function public.is_admin() from public, anon;
revoke all on function public.my_client_id() from public, anon;
revoke all on function public.my_role() from public, anon;
revoke all on function public.client_login_email(int) from public;
revoke all on function public.forget_my_stored_password() from public, anon;
revoke all on function public.set_coupon_targets(uuid, int[]) from public, anon;
revoke all on function public.clients_bump_seq() from public, anon, authenticated;
revoke all on function public.clients_guard() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_client_id() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.forget_my_stored_password() to authenticated;
grant execute on function public.set_coupon_targets(uuid, int[]) to authenticated;
grant execute on function public.client_login_email(int) to anon, authenticated;

-- =====================================================================
-- Storage: avatars. Public read through the public URL (no listing).
-- A linked client writes only "<her uid>/avatar-<n>.jpg"; the admin can do anything.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists avatars_own_insert on storage.objects;
create policy avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (public.is_admin() or (
    public.my_client_id() is not null and name ~ ('^' || auth.uid()::text || '/avatar-[0-9]+\.jpg$'))));
drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (public.is_admin() or (
    public.my_client_id() is not null and name ~ ('^' || auth.uid()::text || '/avatar-[0-9]+\.jpg$'))))
  with check (bucket_id = 'avatars' and (public.is_admin() or (
    public.my_client_id() is not null and name ~ ('^' || auth.uid()::text || '/avatar-[0-9]+\.jpg$'))));
drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (public.is_admin() or (
    public.my_client_id() is not null and name ~ ('^' || auth.uid()::text || '/avatar-[0-9]+\.jpg$'))));
-- No general list/select policy (the bucket is public-read by URL). Storage needs SELECT on the
-- object to delete it, so each client may only "see" her own files.
drop policy if exists avatars_read on storage.objects;
drop policy if exists avatars_own_select on storage.objects;
create policy avatars_own_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (public.is_admin() or (
    public.my_client_id() is not null and name ~ ('^' || auth.uid()::text || '/avatar-[0-9]+\.jpg$'))));

-- =====================================================================
-- Make yourself admin (run once, after creating the user in Authentication → Users):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'TU_EMAIL_DE_ADMIN' on conflict do nothing;
-- =====================================================================

-- =====================================================================
-- Pagar por transferencia (also in migrations/2026-10-06_payment_requests.sql)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Payment details: columns of the admin-only single-row settings table.
-- Clients never read settings; they get only these 4 fields through get_payment_info().
-- ---------------------------------------------------------------------
alter table public.settings add column if not exists payment_alias  text not null default '';
alter table public.settings add column if not exists payment_cvu    text not null default '';
alter table public.settings add column if not exists payment_holder text not null default '';
alter table public.settings add column if not exists payment_bank   text not null default '';
alter table public.settings drop constraint if exists settings_payment_len;
alter table public.settings add constraint settings_payment_len check (
  char_length(payment_alias) <= 60 and char_length(payment_cvu) <= 30 and
  char_length(payment_holder) <= 100 and char_length(payment_bank) <= 60);

create or replace function public.get_payment_info()
returns json language sql stable security definer set search_path = public as $$
  select case when public.my_client_id() is not null or public.is_admin() then (
    select json_build_object('alias', payment_alias, 'cvu', payment_cvu, 'holder', payment_holder, 'bank', payment_bank)
    from public.settings where id = 1)
  end;
$$;
revoke all on function public.get_payment_info() from public, anon;
grant execute on function public.get_payment_info() to authenticated;

-- ---------------------------------------------------------------------
-- Payment requests
-- ---------------------------------------------------------------------
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  client_id int not null references public.clients (id) on delete cascade on update cascade,
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  note text check (char_length(note) <= 200),
  receipt_path text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  movement_id uuid references public.movements (id) on delete set null
);
create index if not exists payment_requests_client_idx on public.payment_requests (client_id, status);
create index if not exists payment_requests_status_idx on public.payment_requests (status, created_at);
alter table public.payment_requests drop constraint if exists payment_requests_receipt_path_format;
alter table public.payment_requests add constraint payment_requests_receipt_path_format
  check (receipt_path is null or receipt_path ~ '^[0-9a-f-]{36}/receipt-[0-9]+\.(jpg|png|webp|pdf)$');

-- Client inserts: max 5 pending per client, receipt must be in her own folder, nothing but a fresh pending row.
create or replace function public.payment_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  perform pg_advisory_xact_lock(hashtext('payment_requests'), new.client_id);
  if (select count(*) from public.payment_requests where client_id = new.client_id and status = 'pending') >= 5 then
    raise exception 'too_many_pending' using errcode = 'P0001';
  end if;
  if new.receipt_path is not null and split_part(new.receipt_path, '/', 1) <> coalesce(auth.uid()::text, '') then
    raise exception 'bad_receipt_path' using errcode = 'P0001';
  end if;
  new.status := 'pending';
  new.resolved_at := null;
  new.movement_id := null;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists payment_requests_guard on public.payment_requests;
create trigger payment_requests_guard before insert on public.payment_requests
  for each row execute function public.payment_requests_guard();
revoke all on function public.payment_requests_guard() from public, anon, authenticated;

alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon, authenticated;
grant select, delete on public.payment_requests to authenticated;
-- clients can only send these columns; status/resolved_at/movement_id stay at their defaults
grant insert (client_id, amount, note, receipt_path) on public.payment_requests to authenticated;
-- admin changes go through confirm/reject RPCs; plain update is kept for the admin only (RLS)
grant update (status, resolved_at, movement_id, amount) on public.payment_requests to authenticated;

drop policy if exists payment_requests_admin on public.payment_requests;
create policy payment_requests_admin on public.payment_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists payment_requests_own_select on public.payment_requests;
create policy payment_requests_own_select on public.payment_requests for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists payment_requests_own_insert on public.payment_requests;
create policy payment_requests_own_insert on public.payment_requests for insert to authenticated
  with check (client_id = public.my_client_id() and status = 'pending' and resolved_at is null and movement_id is null);
drop policy if exists payment_requests_own_delete on public.payment_requests;
create policy payment_requests_own_delete on public.payment_requests for delete to authenticated
  using (client_id = public.my_client_id() and status = 'pending');

-- Admin: confirm = create the payment movement + mark the request, in one transaction.
create or replace function public.confirm_payment_request(p_id uuid, p_amount numeric default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare r public.payment_requests%rowtype; v_amount numeric; v_mov public.movements%rowtype;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into r from public.payment_requests where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, r.amount), 2);
  if v_amount <= 0 or v_amount > 10000000 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  insert into public.movements (client_id, date, detail, total, paid)
  values (r.client_id,
          (now() at time zone 'America/Argentina/Buenos_Aires')::date,
          left('A SU FAVOR · TRANSFERENCIA' || coalesce(' · ' || nullif(trim(r.note), ''), ''), 200),
          0, v_amount)
  returning * into v_mov;
  update public.payment_requests
     set status = 'confirmed', resolved_at = now(), movement_id = v_mov.id, amount = v_amount
   where id = p_id;
  return row_to_json(v_mov);
end $$;

create or replace function public.reject_payment_request(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.payment_requests set status = 'rejected', resolved_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'not_pending' using errcode = 'P0001'; end if;
end $$;

revoke all on function public.confirm_payment_request(uuid, numeric) from public, anon;
revoke all on function public.reject_payment_request(uuid) from public, anon;
grant execute on function public.confirm_payment_request(uuid, numeric) to authenticated;
grant execute on function public.reject_payment_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: private bucket for transfer receipts.
-- A linked client uploads/reads only "<her uid>/receipt-<n>.<ext>"; the admin reads all (signed URLs).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists receipts_own_insert on storage.objects;
create policy receipts_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.my_client_id() is not null
    and name ~ ('^' || auth.uid()::text || '/receipt-[0-9]+\.(jpg|png|webp|pdf)$'));
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or (public.my_client_id() is not null
    and name ~ ('^' || auth.uid()::text || '/receipt-[0-9]+\.(jpg|png|webp|pdf)$'))));
drop policy if exists receipts_own_delete on storage.objects;
create policy receipts_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.my_client_id() is not null
    and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists receipts_admin_delete on storage.objects;
create policy receipts_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_admin());

-- =====================================================================
-- One use per client per coupon (also in migrations/2026-10-06_coupon_once.sql)
-- If the unique index is skipped (old duplicates), the trigger still blocks new repeats.
-- =====================================================================
create or replace function public.movements_coupon_once()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.coupon_id is null then return new; end if;
  -- updates that do not change who/which coupon cannot create a repeat
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id
     and new.coupon_id is not distinct from old.coupon_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('coupon_once'), new.client_id);
  if exists (select 1 from public.movements
             where client_id = new.client_id and coupon_id = new.coupon_id and id <> new.id) then
    raise exception 'coupon_already_used' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.movements_coupon_once() from public, anon, authenticated;

drop trigger if exists movements_coupon_once on public.movements;
create trigger movements_coupon_once before insert or update of client_id, coupon_id on public.movements
  for each row execute function public.movements_coupon_once();

do $$
begin
  if exists (select 1 from public.movements where coupon_id is not null
             group by client_id, coupon_id having count(*) > 1) then
    raise notice 'movements_coupon_once index NOT created: some client already used a coupon twice (the trigger still blocks new repeats)';
  else
    create unique index if not exists movements_coupon_once_idx
      on public.movements (client_id, coupon_id) where coupon_id is not null;
  end if;
end $$;
