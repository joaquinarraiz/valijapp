-- =====================================================================
-- ValijApp v2 — "Pagar por transferencia" (bank transfer reported by the client, confirmed by the admin).
-- Idempotent. Same block is appended at the end of supabase/schema.sql.
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
          left('Transferencia' || coalesce(' · ' || nullif(trim(r.note), ''), ''), 200),
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
