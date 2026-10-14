-- =====================================================================
-- ValijApp v2 — manual partner adjustments (cash kind AJUSTE_SOCIO).
-- Idempotent. Same block is appended at the end of supabase/schema.sql.
--
-- AJUSTE_SOCIO rows change what a partner (person 'J' or 'M') earns in a trip period.
-- amount is SIGNED and non-zero; the app never counts them in the cash box.
-- Other kinds keep their current rules (no new restriction on their amounts).
-- RLS is unchanged: cash_movements stays admin-only.
-- =====================================================================

alter table public.cash_movements drop constraint if exists cash_movements_kind_check;
alter table public.cash_movements add constraint cash_movements_kind_check
  check (kind in ('RETIRO', 'PRESTAMO', 'DEVOLUCION', 'INGRESO', 'GASTO', 'AJUSTE', 'AJUSTE_SOCIO'));

alter table public.cash_movements drop constraint if exists cash_movements_partner_adjust_check;
alter table public.cash_movements add constraint cash_movements_partner_adjust_check
  check (kind <> 'AJUSTE_SOCIO' or (amount <> 0 and person in ('J', 'M')));
