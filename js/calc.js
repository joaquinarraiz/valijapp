/**
 * Pure business calculations for ValijApp.
 * No DOM, no Supabase. Ported 1:1 from the legacy app (js/app.js, "Cálculos" and "Caja").
 *
 * Data shape used across the app (camelCase, already loaded from Supabase):
 *   movement: { id, clientId, date: "YYYY-MM-DD", detail, total, paid, couponId?, discountAmount? }
 *   trip:     { id, name, startsOn: "YYYY-MM-DD", investment }
 *   cash:     { id, kind: "RETIRO"|"PRESTAMO"|"DEVOLUCION"|"INGRESO"|"GASTO"|"AJUSTE"|"AJUSTE_SOCIO", person, date, amount, note }
 *   settings: { partner1Name, partner1Pct, partner2Name, partner2Pct, inactiveDays, cashSince, cashInitial }
 * Partner keys stay as in the legacy data: "J" (partner 1) and "M" (partner 2).
 */

export const CASH_KINDS = ["RETIRO", "PRESTAMO", "DEVOLUCION", "INGRESO", "GASTO", "AJUSTE", "AJUSTE_SOCIO"];
// AJUSTE_SOCIO: manual change of what a partner earns (person "J"/"M", signed amount). Never moves the cash box.
export const PARTNER_ADJUST = "AJUSTE_SOCIO";
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
 * Account statement of one client between two ISO dates (both inclusive).
 * opening = clientBalance of everything dated before `from`; rows carry the running balance.
 * Movements: { clientId, date, detail, total, paid, discountAmount?, couponId?, createdAt? }; data.coupons optional (for codes).
 */
export function clientStatement(data, clientId, from, to) {
  const mine = data.movements.filter(m => m.clientId === clientId && m.date);
  const opening = clientBalance(mine.filter(m => m.date < from), clientId);
  const inRange = mine
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.date >= from && m.date <= to)
    .sort((a, b) => a.m.date.localeCompare(b.m.date) || String(a.m.createdAt || "").localeCompare(String(b.m.createdAt || "")) || a.i - b.i);
  let balance = opening, totalBought = 0, totalPaid = 0, totalDiscount = 0;
  const rows = inRange.map(({ m }) => {
    const total = num(m.total), paid = num(m.paid), discount = num(m.discountAmount);
    balance += total - paid; totalBought += total; totalPaid += paid; totalDiscount += discount;
    const coupon = m.couponId && data.coupons ? data.coupons.find(c => c.id === m.couponId) : null;
    return { date: m.date, detail: m.detail || "", total, paid, discount, couponCode: coupon ? coupon.code : null, balance };
  });
  return { opening, rows, totalBought, totalPaid, totalDiscount, closing: opening + totalBought - totalPaid };
}

/** Date range of a statement preset ("month" | "prev" | "3m" | "all"). firstDate = earliest movement of the client. */
export function statementRange(preset, today = todayISO(), firstDate = null) {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy, mm, dd) => yy + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
  const back = n => { let yy = y, mm = m - n; while (mm < 1) { mm += 12; yy--; } return [yy, mm]; };
  if (preset === "prev") {
    const [py, pm] = back(1);
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return { from: iso(py, pm, 1), to: iso(py, pm, last) };
  }
  if (preset === "3m") { const [py, pm] = back(2); return { from: iso(py, pm, 1), to: today }; }
  if (preset === "all") return { from: firstDate && firstDate < today ? firstDate : today, to: today };
  return { from: iso(y, m, 1), to: today };
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
  const split = splitCollected(collected, deducted, data.settings);
  // manual partner adjustments dated in the period (same range rule as withdrawals); what is not given stays in "sobró"
  const adjust1 = partnerAdjustIn(data.cash, PARTNER_1, from, to);
  const adjust2 = partnerAdjustIn(data.cash, PARTNER_2, from, to);
  return {
    movs: movs.length, sold, collected, returned, reserved, returnDeducted, deducted, from, to, ...split,
    adjust1, adjust2, share1: split.share1 + adjust1, share2: split.share2 + adjust2, box: split.box - adjust1 - adjust2
  };
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

/** Sum of signed AJUSTE_SOCIO amounts of a partner dated in [from, to). */
export function partnerAdjustIn(cash, person, from, to) {
  return cashInRange(cash, from, to).filter(c => c.kind === PARTNER_ADJUST && c.person === person).reduce((a, c) => a + num(c.amount), 0);
}

/** "Que le quede por cobrar $X": the adjustment needed, rounded to cents. */
export function adjustmentForTarget(target, currentOwed) {
  return Math.round((num(target) - num(currentOwed)) * 100) / 100;
}

export function withdrawnTotal(cash, person) {
  return cash.filter(c => c.kind === "RETIRO" && c.person === person).reduce((a, c) => a + num(c.amount), 0);
}

// ---------- cash box ----------
export function cashSign(kind) {
  if (kind === "PRESTAMO" || kind === "INGRESO") return 1;
  if (kind === "AJUSTE") return 1; // amount already carries its sign
  if (kind === PARTNER_ADJUST) return 0; // changes a partner share, not the money in the box
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

// ---------- calendar months (informative; the partner split stays per trip) ----------
export const MONTH_NAMES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

/** "2026-10" -> "OCTUBRE 2026" */
export function monthLabel(ym) {
  const [y, m] = String(ym).split("-");
  return MONTH_NAMES[Number(m) - 1] + " " + y;
}

/**
 * One calendar month ("YYYY-MM"): sold = sum of sale totals (stored already net of any coupon discount),
 * collected = sum of paid, movements = rows dated in that month.
 */
export function monthStats(data, ym) {
  let sold = 0, collected = 0, movements = 0;
  for (const m of data.movements) {
    if (!m.date || m.date.slice(0, 7) !== ym) continue;
    sold += num(m.total);
    collected += num(m.paid);
    movements++;
  }
  return { month: ym, sold, collected, movements };
}

/** Every month from the first movement to the current month (zeros included), newest first. */
export function monthlyHistory(data, today = todayISO()) {
  const dates = data.movements.map(m => m.date).filter(Boolean).sort();
  const last = today.slice(0, 7);
  const first = dates.length ? (dates[0].slice(0, 7) < last ? dates[0].slice(0, 7) : last) : last;
  const byMonth = new Map();
  for (const m of data.movements) {
    if (!m.date) continue;
    const k = m.date.slice(0, 7);
    const s = byMonth.get(k) || { month: k, sold: 0, collected: 0, movements: 0 };
    s.sold += num(m.total); s.collected += num(m.paid); s.movements++;
    byMonth.set(k, s);
  }
  const out = [];
  let [y, mo] = last.split("-").map(Number);
  for (;;) {
    const k = y + "-" + String(mo).padStart(2, "0");
    out.push(byMonth.get(k) || { month: k, sold: 0, collected: 0, movements: 0 });
    if (k <= first) break;
    mo--; if (mo === 0) { mo = 12; y--; }
  }
  return out;
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

// ---------- Métricas (data prep for the Inicio charts; rendering lives in js/admin/charts.js) ----------
const lastDayOf = ym => {
  const [y, m] = ym.split("-").map(Number);
  return ym + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
};

/** Last `n` calendar months ending in today's month, oldest first: ["2025-11", …, "2026-10"]. */
export function lastMonths(n = 12, today = todayISO()) {
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.unshift(y + "-" + String(m).padStart(2, "0"));
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

/** Sold / collected per month for the given months (oldest first). */
export function salesByMonth(movements, months) {
  const map = new Map(months.map(k => [k, { month: k, sold: 0, collected: 0 }]));
  for (const m of movements) {
    const s = m.date && map.get(m.date.slice(0, 7));
    if (s) { s.sold += num(m.total); s.collected += num(m.paid); }
  }
  return months.map(k => map.get(k));
}

/**
 * Total debt (sum of POSITIVE client balances, same formula as clientBalance) at the end of each month.
 * Months oldest first; the current month is measured as of its last day (i.e. everything so far).
 */
export function debtAtMonthEnds(movements, months) {
  const sorted = movements.filter(m => m.date).sort((a, b) => a.date.localeCompare(b.date));
  const bal = new Map();
  let i = 0;
  return months.map(ym => {
    const end = lastDayOf(ym);
    for (; i < sorted.length && sorted[i].date <= end; i++) {
      const m = sorted[i];
      bal.set(m.clientId, (bal.get(m.clientId) || 0) + num(m.total) - num(m.paid));
    }
    let debt = 0;
    for (const v of bal.values()) if (v > 0) debt += v;
    return { month: ym, debt };
  });
}

/** Clients whose FIRST movement falls in each month (oldest first). */
export function newClientsByMonth(movements, months) {
  const first = new Map();
  for (const m of movements) {
    if (!m.date) continue;
    const f = first.get(m.clientId);
    if (!f || m.date < f) first.set(m.clientId, m.date);
  }
  const map = new Map(months.map(k => [k, 0]));
  for (const d of first.values()) { const k = d.slice(0, 7); if (map.has(k)) map.set(k, map.get(k) + 1); }
  return months.map(k => ({ month: k, count: map.get(k) }));
}

/** Top `n` clients by total bought and by debt: [{ clientId, value }]. */
export function topClients(movements, n = 10) {
  const sums = [...clientSummaries(movements).values()];
  return {
    buyers: sums.filter(s => s.bought > 0).sort((a, b) => b.bought - a.bought).slice(0, n).map(s => ({ clientId: s.clientId, value: s.bought })),
    debtors: sums.filter(s => s.debt > 0).sort((a, b) => b.debt - a.debt).slice(0, n).map(s => ({ clientId: s.clientId, value: s.debt }))
  };
}

/**
 * Per trip: how the collected money was split. partner1/partner2 = shares (incl. manual adjustments),
 * business = what stays in the business ("sobró"), loans = reserved/returned for loans. Negative parts are 0.
 */
export function tripSplitSeries(data) {
  return periodSummary(data).rows.map(({ trip, st }) => ({
    name: trip.name, collected: st.collected,
    partner1: Math.max(0, st.share1), partner2: Math.max(0, st.share2), business: Math.max(0, st.box), loans: Math.max(0, st.deducted)
  }));
}

/** Clients by balance state and by app access. Clients without movements count as "al día". */
export function clientStatusCounts(clients, movements) {
  const sums = clientSummaries(movements);
  const out = { owes: 0, clear: 0, credit: 0, withAccess: 0, withoutAccess: 0 };
  for (const c of clients) {
    const d = (sums.get(c.id) || { debt: 0 }).debt;
    if (d > 0) out.owes++; else if (d < 0) out.credit++; else out.clear++;
    if (c.userId) out.withAccess++; else out.withoutAccess++;
  }
  return out;
}

/** Active = bought within `days` (same rule as "Hace tiempo no compran"); never = no purchase at all. */
export function activityCounts(clients, movements, days = 45, today = todayISO()) {
  const sums = clientSummaries(movements);
  const out = { active: 0, inactive: 0, never: 0 };
  for (const c of clients) {
    const last = (sums.get(c.id) || {}).last;
    if (!last) out.never++;
    else if (daysSince(last, today) < days) out.active++;
    else out.inactive++;
  }
  return out;
}
