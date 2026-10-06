-- =====================================================================
-- ValijApp v2 — a coupon can be used ONCE per client (on a sale recorded by the admin).
-- Idempotent. Same block is appended at the end of supabase/schema.sql.
--
-- Two layers:
--  1. Trigger (always created): rejects a second movement of the same client with the same coupon,
--     race-safe via an advisory lock. Works even if old data already has duplicates.
--  2. Partial unique index (created only when existing data has no duplicates). If it is skipped,
--     a NOTICE says so; run the query below, fix the duplicates and re-run this file:
--       select client_id, coupon_id, count(*) from public.movements
--       where coupon_id is not null group by 1, 2 having count(*) > 1;
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
