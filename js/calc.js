/**
 * Pure business calculations for ValijApp.
 * No DOM, no Supabase. Ported 1:1 from the legacy app (js/app.js, "Cálculos" and "Caja").
 *
 * Data shape used across the app (camelCase, already loaded from Supabase):
 *   movement: { id, clientId, date: "YYYY-MM-DD", detail, total, paid, couponId?, discountAmount? }
 *   trip:     { id, name, startsOn: "YYYY-MM-DD", investment }
 *   cash:     { id, kind: "RETIRO"|"PRESTAMO"|"DEVOLUCION"|"INGRESO"|"GASTO"|"AJUSTE", person, date, amount, note }
 *   settings: { partner1Name, partner1Pct, partner2Name, partner2Pct, inactiveDays, cashSince, cashInitial }
 * Partner keys stay as in the legacy data: "J" (partner 1) and "M" (partner 2).
 */

export const CASH_KINDS = ["RETIRO", "PRESTAMO", "DEVOLUCION", "INGRESO", "GASTO", "AJUSTE"];
export const PARTNER_1 = "J";
export const PARTNER_2 = "M";

const num = v => Number(v) || 0;

// ---------- dates ----------
export function todayISO(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Whole days between an ISO date and today (legacy diasDesde). */
export function daysSince(iso, today = todayISO()) {
  if (!iso) return null;
  return Math.floor((new Date(today) - new Date(iso)) / 86400000);
}

// ---------- clients ----------
export function clientBalance(movements, clientId) {
  return movements.reduce((a, m) => a + (m.clientId === clientId ? num(m.total) - num(m.paid) : 0), 0);
}

/**
 * Per-client aggregates (legacy todasLasDeudoras): debt, bought, last purchase date.
 * Returns a Map clientId -> { clientId, debt, bought, last, count }.
 */
export function clientSummaries(movements) {
  const map = new Map();
  for (const m of movements) {
    let s = map.get(m.clientId);
    if (!s) { s = { clientId: m.clientId, debt: 0, bought: 0, last: null, count: 0 }; map.set(m.clientId, s); }
    s.debt += num(m.total) - num(m.paid);
    s.bought += num(m.total);
    s.count++;
    if (num(m.total) > 0 && m.date && (!s.last || m.date > s.last)) s.last = m.date;
  }
  return map;
}

// ---------- trips / periods ----------
export function sortTrips(trips) {
  return [...trips].sort((a, b) => (a.startsOn || "").localeCompare(b.startsOn || ""));
}

export function tripOfDate(trips, date) {
  const vs = sortTrips(trips);
  let chosen = vs.length ? vs[0] : null;
  for (const v of vs) if (v.startsOn <= date) chosen = v;
  return chosen;
}

/** Period of a trip: [startsOn, next trip startsOn) — upper bound exclusive. */
export function tripRange(trips, trip) {
  const vs = sortTrips(trips);
  const i = vs.findIndex(x => x.id === trip.id);
  return { from: trip.startsOn, to: i >= 0 && i < vs.length - 1 ? vs[i + 1].startsOn : null };
}

export function cashInRange(cash, from, to) {
  return cash.filter(c => c.date && (!from || c.date >= from) && (!to || c.date < to));
}

/** Movements that belong to a trip period. The first trip also absorbs everything before it. */
export function movementsOfTrip(data, trip) {
  const { from, to } = tripRange(data.trips, trip);
  const vs = sortTrips(data.trips);
  const isFirst = vs.length && vs[0].id === trip.id;
  return data.movements.filter(m => m.date && (isFirst || m.date >= from) && (!to || m.date < to));
}

/**
 * "Reserve first, then split": while a loan is outstanding, collections are set aside to return it
 * before anyone earns their %. Events run chronologically across ALL time
 * (same date: loans, then collections, then returns):
 *  - PRESTAMO A:   outstanding += A
 *  - collection P: take = min(P, outstanding − pool); pool += take  → reserve in the collection's period
 *  - DEVOLUCION R: used = min(R, pool); pool −= used; extra = R − used → deducted in the return's period
 *                  (a loan returned before collections covered it); outstanding −= R (floor 0)
 * Only the partner split uses this; the cash box keeps showing real money.
 * Returns { reserves: [{date, amount}], extras: [{date, amount}], outstanding, pool }.
 */
export function loanReserves(data) {
  const ORDER = { PRESTAMO: 0, PAGO: 1, DEVOLUCION: 2 };
  const events = [];
  for (const c of data.cash) {
    if (c.date && (c.kind === "PRESTAMO" || c.kind === "DEVOLUCION")) events.push({ date: c.date, kind: c.kind, amount: num(c.amount), seq: num(c.seq) });
  }
  for (const m of data.movements) {
    if (m.date && num(m.paid) > 0) events.push({ date: m.date, kind: "PAGO", amount: num(m.paid), seq: 0 });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.seq - b.seq);
  let outstanding = 0, pool = 0;
  const reserves = [], extras = [];
  for (const e of events) {
    if (e.kind === "PRESTAMO") outstanding += e.amount;
    else if (e.kind === "PAGO") {
      const take = Math.min(e.amount, Math.max(0, outstanding - pool));
      if (take > 0) { pool += take; reserves.push({ date: e.date, amount: take }); }
    } else {
      const used = Math.min(e.amount, pool);
      pool -= used;
      const extra = e.amount - used;
      if (extra > 0) extras.push({ date: e.date, amount: extra });
      outstanding = Math.max(0, outstanding - e.amount);
    }
  }
  return { reserves, extras, outstanding, pool };
}

/**
 * Period stats with the partner split (legacy statsDeViaje, with the "reserve first" loan rule).
 * base = collected − reserved for loans (by collection date) − returns not covered by reserves (by return date).
 * `returned` keeps the total of loan returns dated in the period (informative).
 */
export function tripStats(data, trip, reservesState = loanReserves(data)) {
  const { from, to } = tripRange(data.trips, trip);
  const vs = sortTrips(data.trips);
  const isFirst = vs.length && vs[0].id === trip.id;
  const movs = movementsOfTrip(data, trip);
  const sold = movs.reduce((a, m) => a + num(m.total), 0);
  const collected = movs.reduce((a, m) => a + num(m.paid), 0);
  const returned = cashInRange(data.cash, from, to).filter(c => c.kind === "DEVOLUCION").reduce((a, c) => a + num(c.amount), 0);
  // reserves follow the collections (same period rule as movements: the first trip absorbs earlier dates)
  const reserved = reservesState.reserves
    .filter(r => (isFirst || r.date >= from) && (!to || r.date < to)).reduce((a, r) => a + r.amount, 0);
  // uncovered returns follow the return date (same range rule as the old one)
  const returnDeducted = reservesState.extras
    .filter(x => (!from || x.date >= from) && (!to || x.date < to)).reduce((a, x) => a + x.amount, 0);
  const deducted = reserved + returnDeducted;
  return { movs: movs.length, sold, collected, returned, reserved, returnDeducted, deducted, from, to, ...splitCollected(collected, deducted, data.settings) };
}

/** The split itself, isolated so it can be tested on its own. `deducted` = money set aside for loans. */
export function splitCollected(collected, deducted, settings) {
  const base = Math.max(0, collected - deducted);
  const share1 = base * num(settings.partner1Pct) / 100;
  const share2 = base * num(settings.partner2Pct) / 100;
  return { base, share1, share2, box: base - share1 - share2 };
}

export function withdrawnIn(cash, person, from, to) {
  return cashInRange(cash, from, to).filter(c => c.kind === "RETIRO" && c.person === person).reduce((a, c) => a + num(c.amount), 0);
}

export function withdrawnTotal(cash, person) {
  return cash.filter(c => c.kind === "RETIRO" && c.person === person).reduce((a, c) => a + num(c.amount), 0);
}

// ---------- cash box ----------
export function cashSign(kind) {
  if (kind === "PRESTAMO" || kind === "INGRESO") return 1;
  if (kind === "AJUSTE") return 1; // amount already carries its sign
  return -1; // RETIRO, DEVOLUCION, GASTO
}

/** By date; same-day rows keep their insertion order (`seq`, like the v1 array order). Stable sort. */
export function sortCash(cash) {
  return [...cash].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

/**
 * Real money in the box right now (legacy detalleCaja). Starts at cashInitial on cashSince and adds:
 * + collected  − trip investments  − withdrawals  + loans received  − loan returns  + incomes  − expenses  ± adjustments
 */
export function cashDetail(data) {
  const since = data.settings.cashSince || null;
  const inside = f => f && (!since || f >= since);
  const collected = data.movements.reduce((a, m) => a + (inside(m.date) ? num(m.paid) : 0), 0);
  const invested = data.trips.reduce((a, v) => a + (inside(v.startsOn) ? num(v.investment) : 0), 0);
  const t = { RETIRO: 0, PRESTAMO: 0, DEVOLUCION: 0, INGRESO: 0, GASTO: 0, AJUSTE: 0 };
  for (const c of data.cash) if (inside(c.date) && c.kind in t) t[c.kind] += num(c.amount);
  const initial = num(data.settings.cashInitial);
  const balance = initial + collected + t.PRESTAMO + t.INGRESO + t.AJUSTE - invested - t.RETIRO - t.DEVOLUCION - t.GASTO;
  return {
    since, initial, collected, invested,
    withdrawals: t.RETIRO, loans: t.PRESTAMO, returns: t.DEVOLUCION, incomes: t.INGRESO, expenses: t.GASTO, adjustments: t.AJUSTE,
    balance
  };
}

/** Box balance right after a given cash movement (legacy saldoHasta, the "Quedó" column). */
export function cashBalanceAfter(data, date, idUntil) {
  const d = cashDetail(data);
  const inside = f => f && (!d.since || f >= d.since);
  let s = d.initial;
  s += data.movements.reduce((a, m) => a + (inside(m.date) && m.date <= date ? num(m.paid) : 0), 0);
  s -= data.trips.reduce((a, v) => a + (inside(v.startsOn) && v.startsOn <= date ? num(v.investment) : 0), 0);
  for (const c of sortCash(data.cash)) {
    if (!inside(c.date) || c.date > date) continue;
    s += cashSign(c.kind) * num(c.amount);
    if (c.id === idUntil) break;
  }
  return s;
}

export function withdrawnSinceCut(data, person) {
  const since = data.settings.cashSince || null;
  return data.cash.filter(c => c.kind === "RETIRO" && c.person === person && (!since || c.date >= since)).reduce((a, c) => a + num(c.amount), 0);
}

/** Outstanding loans per lender: loans received − returns. Returns [[lender, amount], ...]. */
export function pendingLoans(cash) {
  const map = {};
  for (const c of cash) {
    if (c.kind === "PRESTAMO") map[c.person] = (map[c.person] || 0) + num(c.amount);
    if (c.kind === "DEVOLUCION") map[c.person] = (map[c.person] || 0) - num(c.amount);
  }
  return Object.entries(map).filter(([, v]) => Math.round(v) !== 0);
}

export function totalPendingLoans(cash) {
  return pendingLoans(cash).reduce((a, [, v]) => a + v, 0);
}

// ---------- dashboard ----------
/**
 * Everything the "Inicio" screen shows (legacy vDashboard).
 * `clients` is only used to keep client rows that have no movements out of rankings (same as legacy).
 */
export function dashboard(data, today = todayISO()) {
  const sums = [...clientSummaries(data.movements).values()];
  const totalDebt = sums.reduce((a, d) => a + Math.max(d.debt, 0), 0);
  const debtors = sums.filter(d => d.debt > 0).sort((a, b) => b.debt - a.debt);
  const topBuyers = [...sums].sort((a, b) => b.bought - a.bought).slice(0, 10);
  const days = num(data.settings.inactiveDays) || 45;
  const inactive = sums
    .filter(d => d.last && daysSince(d.last, today) >= days)
    .sort((a, b) => daysSince(b.last, today) - daysSince(a.last, today))
    .slice(0, 15);
  const collectedHistoric = data.movements.reduce((a, m) => a + num(m.paid), 0);
  const vs = sortTrips(data.trips);
  const currentTrip = vs.length ? vs[vs.length - 1] : null;
  const reserves = loanReserves(data);
  const current = currentTrip ? tripStats(data, currentTrip, reserves) : null;
  const withdrawn1 = current ? withdrawnIn(data.cash, PARTNER_1, current.from, current.to) : 0;
  const withdrawn2 = current ? withdrawnIn(data.cash, PARTNER_2, current.from, current.to) : 0;
  return {
    totalDebt, debtors, topBuyers, inactive, inactiveDays: days, collectedHistoric,
    currentTrip, current, withdrawn1, withdrawn2,
    loans: pendingLoans(data.cash), totalLoans: totalPendingLoans(data.cash),
    loanPool: reserves.pool, loanOutstanding: reserves.outstanding,
    cash: cashDetail(data)
  };
}

/** "Resumen por período" table with totals (legacy vResumen). */
export function periodSummary(data) {
  const reserves = loanReserves(data);
  const rows = sortTrips(data.trips).map(trip => ({ trip, st: tripStats(data, trip, reserves) }));
  const total = rows.reduce((a, { trip, st }) => ({
    investment: a.investment + num(trip.investment), sold: a.sold + st.sold, collected: a.collected + st.collected,
    returned: a.returned + st.returned, deducted: a.deducted + st.deducted, base: a.base + st.base,
    share1: a.share1 + st.share1, share2: a.share2 + st.share2, box: a.box + st.box
  }), { investment: 0, sold: 0, collected: 0, returned: 0, deducted: 0, base: 0, share1: 0, share2: 0, box: 0 });
  return { rows, total };
}

/** Money collected per calendar month (YYYY-MM -> { sold, collected }), newest first. */
export function collectedByMonth(movements) {
  const map = {};
  for (const m of movements) {
    if (!m.date) continue;
    const k = m.date.slice(0, 7);
    map[k] = map[k] || { month: k, sold: 0, collected: 0 };
    map[k].sold += num(m.total);
    map[k].collected += num(m.paid);
  }
  return Object.values(map).sort((a, b) => b.month.localeCompare(a.month));
}

// ---------- coupons ----------
/**
 * Is a coupon usable for a client on a date?
 * coupon: { active, startsOn, endsOn, allClients }, targets: array of clientIds the coupon is aimed at.
 */
export function couponIsValid(coupon, { date = todayISO(), clientId = null, targets = [] } = {}) {
  if (!coupon || !coupon.active) return false;
  if (coupon.startsOn && date < coupon.startsOn) return false;
  if (coupon.endsOn && date > coupon.endsOn) return false;
  if (coupon.allClients) return true;
  return clientId != null && targets.includes(clientId);
}

/** Discount in whole pesos, never more than the sale itself. */
export function couponDiscount(coupon, gross) {
  const g = Math.max(0, num(gross));
  if (!coupon) return 0;
  const v = Math.max(0, num(coupon.value));
  const d = coupon.kind === "percent" ? Math.round(g * Math.min(v, 100) / 100) : Math.round(v);
  return Math.min(d, g);
}


/** Coupon ids this client already used (one use per client per coupon). Movements: { clientId, couponId }. */
export function usedCouponIds(movements, clientId) {
  return new Set((movements || []).filter(m => m.clientId === clientId && m.couponId).map(m => m.couponId));
}

/** Coupons valid for a client on a date that she has not used yet. targetsOf(couponId) -> clientIds. */
export function availableCoupons(coupons, { clientId = null, date = todayISO(), targetsOf = () => [], movements = [] } = {}) {
  const used = clientId == null ? new Set() : usedCouponIds(movements, clientId);
  return (coupons || []).filter(c => !used.has(c.id) && couponIsValid(c, { date, clientId, targets: targetsOf(c.id) }));
}
// ---------- reported transfers ----------
/** Pending reported transfers: { count, total }. Requests: { status, amount }. */
export function pendingPayments(requests) {
  const pending = (requests || []).filter(r => r.status === "pending");
  return { count: pending.length, total: pending.reduce((a, r) => a + num(r.amount), 0) };
}

/** Balance if every pending transfer were confirmed (info only; the real balance ignores them). */
export function balanceWithPending(balance, requests) {
  return num(balance) - pendingPayments(requests).total;
}

/** Amount a client may report: > 0, at most her balance, max 2 decimals. Returns the number or null. */
export function validTransferAmount(value, balance) {
  const x = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(x) && x > 0 && x <= num(balance) && x <= 10000000 ? x : null;
}
