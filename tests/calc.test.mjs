// Run with: node tests/calc.test.mjs
import assert from "node:assert/strict";
import {
  clientBalance, clientSummaries, tripStats, splitCollected, cashDetail, cashBalanceAfter, pendingLoans,
  couponDiscount, couponIsValid, dashboard, periodSummary, daysSince, sortCash, loanReserves, monthStats, monthlyHistory, monthLabel, pendingPayments, balanceWithPending, validTransferAmount, usedCouponIds, availableCoupons
} from "../js/calc.js";
import { convertLegacy, toLegacyState, parseMoney } from "../js/legacy.js";
import { fmtMoney, fmtDate } from "../js/format.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name); throw e; }
}

const settings = { partner1Name: "JOACO", partner1Pct: 25, partner2Name: "ALE", partner2Pct: 25, inactiveDays: 45, cashSince: "2026-06-01", cashInitial: 100000 };
const trips = [
  { id: "t1", name: "JUNIO 2026", startsOn: "2026-06-01", investment: 500000 },
  { id: "t2", name: "JULIO 2026", startsOn: "2026-07-01", investment: 0 }
];
const movements = [
  { id: "m0", clientId: 1, date: "2026-05-20", total: 50000, paid: 50000 }, // before first trip: belongs to it
  { id: "m1", clientId: 1, date: "2026-06-05", total: 100000, paid: 40000 },
  { id: "m2", clientId: 2, date: "2026-06-10", total: 80000, paid: 0 },
  { id: "m3", clientId: 1, date: "2026-07-02", total: 0, paid: 60000 },
  { id: "m4", clientId: 2, date: "2026-07-03", total: 20000, paid: 100000 }
];
const cash = [
  { id: "c1", kind: "PRESTAMO", person: "YANINA", date: "2026-07-01", amount: 300000 },
  { id: "c2", kind: "DEVOLUCION", person: "YANINA", date: "2026-07-05", amount: 100000 },
  { id: "c3", kind: "RETIRO", person: "J", date: "2026-07-06", amount: 10000 },
  { id: "c4", kind: "AJUSTE", person: "", date: "2026-07-07", amount: -5000 }
];
const data = { movements, trips, cash, settings };

test("balance per client", () => {
  assert.equal(clientBalance(movements, 1), 0);     // 150000 bought, 150000 paid
  assert.equal(clientBalance(movements, 2), 0);     // 100000 bought, 100000 paid
  assert.equal(clientBalance(movements.slice(0, 3), 2), 80000);
  const s = clientSummaries(movements.slice(0, 3)).get(1);
  assert.deepEqual([s.debt, s.bought, s.last], [60000, 150000, "2026-06-05"]);
});

test("split without loans", () => {
  const st = tripStats(data, trips[0]);
  assert.equal(st.collected, 90000); // m0 (before first trip) + m1
  assert.equal(st.returned, 0);
  assert.deepEqual([st.share1, st.share2, st.box], [22500, 22500, 45000]);
});

test("split with a loan: collections are reserved for the loan before anyone gets their %", () => {
  const st = tripStats(data, trips[1]);
  assert.equal(st.collected, 160000);
  assert.equal(st.returned, 100000);
  // 300k loan on 07-01: both July collections (60k + 100k) are reserved; the 100k return uses that reserve
  assert.equal(st.reserved, 160000);
  assert.equal(st.returnDeducted, 0);
  assert.equal(st.base, 0);
  assert.deepEqual([st.share1, st.share2, st.box], [0, 0, 0]);
  // returning more than collected leaves nothing to split (never negative)
  assert.deepEqual(splitCollected(50000, 80000, settings), { base: 0, share1: 0, share2: 0, box: 0 });
});

test("pending loans per lender", () => {
  assert.deepEqual(pendingLoans(cash), [["YANINA", 200000]]);
  assert.deepEqual(pendingLoans([...cash, { kind: "DEVOLUCION", person: "YANINA", date: "2026-07-09", amount: 200000 }]), []);
});

test("cash box", () => {
  const d = cashDetail(data);
  // 100000 initial + collected since 06-01 (40000+60000+100000) + loan 300000 − invested 500000 − return 100000 − withdrawal 10000 − 5000 adj
  assert.equal(d.collected, 200000);
  assert.equal(d.balance, 100000 + 200000 + 300000 - 500000 - 100000 - 10000 - 5000);
  assert.equal(cashBalanceAfter(data, "2026-07-05", "c2"), 100000 + 200000 - 500000 + 300000 - 100000);
});

test("coupon fixed / percent / expired / targeted", () => {
  const fixed = { kind: "fixed", value: 5000, active: true, allClients: true, startsOn: "2026-07-01", endsOn: "2026-07-31" };
  const pct = { kind: "percent", value: 15, active: true, allClients: false, startsOn: null, endsOn: null };
  assert.equal(couponDiscount(fixed, 30000), 5000);
  assert.equal(couponDiscount(fixed, 3000), 3000); // never more than the sale
  assert.equal(couponDiscount(pct, 33333), 5000);  // 4999.95 rounded
  assert.equal(couponDiscount(pct, 0), 0);
  assert.equal(couponIsValid(fixed, { date: "2026-07-15", clientId: 9 }), true);
  assert.equal(couponIsValid(fixed, { date: "2026-08-01", clientId: 9 }), false); // expired
  assert.equal(couponIsValid(fixed, { date: "2026-06-30", clientId: 9 }), false); // not started
  assert.equal(couponIsValid({ ...fixed, active: false }, { date: "2026-07-15" }), false);
  assert.equal(couponIsValid(pct, { date: "2026-07-15", clientId: 9, targets: [3, 9] }), true);
  assert.equal(couponIsValid(pct, { date: "2026-07-15", clientId: 4, targets: [3, 9] }), false);
});

test("dashboard rankings and inactivity", () => {
  const d = dashboard({ ...data, movements: movements.slice(0, 3) }, "2026-08-01");
  assert.equal(d.totalDebt, 140000);
  assert.deepEqual(d.debtors.map(x => x.clientId), [2, 1]);
  assert.deepEqual(d.inactive.map(x => x.clientId), [1, 2]); // 57 and 52 days
  assert.equal(daysSince("2026-06-05", "2026-08-01"), 57);
  assert.equal(d.currentTrip.id, "t2");
});

test("money and date format identical to legacy", () => {
  assert.equal(fmtMoney(2018000), "$2.018.000");
  assert.equal(fmtMoney(-1500.6), "$-1.501");
  assert.equal(fmtMoney(undefined), "$0");
  assert.equal(fmtDate("2026-09-08"), "08/09/26");
});

test("legacy conversion round trip keeps keys stable", () => {
  const legacy = {
    clientas: [{ id: 1, nombre: "ana", telefono: "11", direccion: "" }, { id: 1, nombre: "BETY", telefono: "" }],
    movimientos: [
      { fecha: "2026-01-01", nombre: "Ana ", detalle: "JEAN", total: 100, pago: 0 },
      { fecha: "2026-01-01", nombre: "ANA", detalle: "JEAN", total: 100, pago: 0 },
      { id: "x1", fecha: "2026-01-02", nombre: "CARLA", total: 0, pago: 50 }
    ],
    viajes: [], caja: [], ajustes: { nombreJoaco: "JOACO", nombreMama: "ALE", pctJoaco: 25, pctMama: 25 }
  };
  const a = convertLegacy(legacy), b = convertLegacy(legacy);
  assert.deepEqual(a.clients.map(c => [c.key, c.legacyNumber]), [["ANA", 1], ["BETY", null], ["CARLA", null]]);
  assert.equal(new Set(a.movements.map(m => m.legacyId)).size, 3); // identical rows stay distinct
  assert.deepEqual(a.movements.map(m => m.legacyId), b.movements.map(m => m.legacyId));
  const back = toLegacyState({ clients: [{ id: 1, name: "ANA" }], movements: [{ id: "u", legacyId: "x1", clientId: 1, date: "2026-01-02", total: 0, paid: 50 }], trips: [], cash: [], places: [], settings: a.settings });
  assert.equal(back.movimientos[0].id, "x1");
});

test("coupon discount clamps", () => {
  assert.equal(couponDiscount({ kind: "percent", value: 150 }, 20000), 20000); // 150% -> whole sale
  assert.equal(couponDiscount({ kind: "fixed", value: 99999 }, 20000), 20000); // fixed > total -> total
  assert.equal(couponDiscount({ kind: "fixed", value: -50 }, 20000), 0);
  assert.equal(couponDiscount(null, 20000), 0);
});

test("parseMoney understands es-AR formats", () => {
  assert.equal(parseMoney("1.500,50"), 1500.5);
  assert.equal(parseMoney("$ 1.500"), 1500);
  assert.equal(parseMoney("1.500.000"), 1500000);
  assert.equal(parseMoney("1500.5"), 1500.5);
  assert.equal(parseMoney("-5000"), -5000);
  assert.equal(parseMoney(35000), 35000);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(NaN), null);
  assert.equal(parseMoney(""), null);
});

test("convertLegacy validates rows instead of failing", () => {
  const legacy = {
    clientas: [{ id: 5, nombre: "ANA" }, { id: 99999999999, nombre: "BIG" }, { nombre: "" }],
    movimientos: [
      { id: "dup", fecha: "2026-01-01", nombre: "ANA", detalle: "A", total: "1.500,50", pago: 0 },
      { id: "dup", fecha: "2026-01-02", nombre: "ANA", detalle: "B", total: 100, pago: 0 },
      { id: "dup", fecha: "2026-01-03", nombre: "ANA", detalle: "C", total: 100, pago: 0 },
      { id: "nodate", fecha: "", nombre: "ANA", total: 100, pago: 0 },
      { id: "baddate", fecha: "2026-02-30", nombre: "ANA", total: 100, pago: 0 },
      { id: "nan", fecha: "2026-01-04", nombre: "ANA", total: "mucho", pago: 0 },
      { id: "neg", fecha: "2026-01-05", nombre: "ANA", total: -5, pago: 0 }
    ],
    viajes: [{ id: "v1", nombre: "X", desde: null, inversion: 0 }],
    caja: [
      { id: "k1", fecha: "2026-01-01", tipo: "préstamo", persona: "TIA", monto: "10.000" },
      { id: "k2", fecha: "2026-01-01", tipo: "REGALO", persona: "", monto: 1 },
      { id: "k3", fecha: "2026-01-01", tipo: "GASTO", persona: "", monto: "x" }
    ],
    ajustes: {}
  };
  const r = convertLegacy(legacy);
  assert.deepEqual(r.movements.map(m => m.legacyId), ["dup", "dup#2", "dup#3"]);
  assert.equal(r.movements[0].total, 1500.5);
  assert.deepEqual(r.clients.map(c => [c.key, c.legacyNumber]), [["ANA", 5], ["BIG", null]]); // out of int4 range
  assert.deepEqual(r.cash.map(c => [c.kind, c.amount]), [["PRESTAMO", 10000]]);
  const reasons = r.skipped.map(x => x.type + ":" + ((x.row && x.row.id) || "") + ":" + x.reason);
  for (const expected of [
    "movimiento:nodate:fecha inválida o vacía", "movimiento:baddate:fecha inválida o vacía",
    "movimiento:nan:monto inválido", "movimiento:neg:monto negativo", "viaje:v1:fecha inválida o vacía",
    "caja:k2:tipo desconocido", "caja:k3:monto inválido", "clienta::sin nombre"
  ]) {
    assert.ok(reasons.includes(expected), "missing skip " + expected + " in " + reasons.join(" | "));
  }
});

test("cash rows of the same day keep insertion order (seq)", () => {
  const rows = [{ id: "b", date: "2026-01-01", seq: 2 }, { id: "c", date: "2025-12-31", seq: 3 }, { id: "a", date: "2026-01-01", seq: 1 }];
  assert.deepEqual(sortCash(rows).map(r => r.id), ["c", "a", "b"]);
});

test("reported transfers: pending total, balance preview, amount validation", () => {
  const reqs = [{ status: "pending", amount: 1000 }, { status: "pending", amount: "500.5" }, { status: "confirmed", amount: 9999 }, { status: "rejected", amount: 7 }];
  assert.deepEqual(pendingPayments(reqs), { count: 2, total: 1500.5 });
  assert.equal(balanceWithPending(20000, reqs), 18499.5);
  assert.equal(validTransferAmount("5000", 20000), 5000);
  assert.equal(validTransferAmount(20000, 20000), 20000);
  assert.equal(validTransferAmount(20001, 20000), null);
  assert.equal(validTransferAmount(0, 20000), null);
  assert.equal(validTransferAmount("abc", 20000), null);
  assert.equal(validTransferAmount(10.555, 20000), 10.56);
});

test("coupons: one use per client, used ones are not offered again", () => {
  const coupons = [
    { id: "a", kind: "percent", value: 10, active: true, allClients: true },
    { id: "b", kind: "fixed", value: 500, active: true, allClients: false },
    { id: "c", kind: "fixed", value: 100, active: true, allClients: true, endsOn: "2026-01-01" }
  ];
  const movements = [{ clientId: 7, couponId: "a" }, { clientId: 8, couponId: "b" }];
  const targetsOf = id => (id === "b" ? [7] : []);
  assert.deepEqual([...usedCouponIds(movements, 7)], ["a"]);
  assert.deepEqual(availableCoupons(coupons, { clientId: 7, date: "2026-10-06", targetsOf, movements }).map(c => c.id), ["b"]);
  assert.deepEqual(availableCoupons(coupons, { clientId: 9, date: "2026-10-06", targetsOf, movements }).map(c => c.id), ["a"]);
});

// ---------- "reserve first, then split" (loans) ----------
const S25 = { partner1Pct: 25, partner2Pct: 25, cashSince: "2026-09-01", cashInitial: 0 };
const sept = [{ id: "s", name: "SEPTIEMBRE 2026", startsOn: "2026-09-01", investment: 0 }];
const pay = (date, paid, id = date + paid) => ({ id, clientId: 1, date, total: 0, paid });
const loanCash = (kind, date, amount, person = "YANINA", seq = 0) => ({ id: kind + date + amount + person, kind, person, date, amount, seq });

test("split: live September scenario (700k returned + 800k still reserved) -> base 1.923.000", () => {
  const data = {
    trips: sept, settings: S25,
    movements: [
      pay("2026-09-01", 1000000), pay("2026-09-05", 500000), pay("2026-09-07", 1008000),
      pay("2026-09-24", 600000), pay("2026-09-28", 315000)
    ],
    cash: [
      loanCash("PRESTAMO", "2026-09-04", 700000, "YANINA", 1),
      loanCash("DEVOLUCION", "2026-09-08", 700000, "YANINA", 2),
      loanCash("PRESTAMO", "2026-09-23", 400000, "YANINA", 3),
      loanCash("PRESTAMO", "2026-09-23", 400000, "ALE", 4)
    ]
  };
  const st = tripStats(data, sept[0]);
  assert.equal(st.collected, 3423000);
  assert.equal(st.reserved, 1500000);      // 700k (returned) + 800k (still outstanding)
  assert.equal(st.returnDeducted, 0);      // the return was fully covered by reserves: no double deduction
  assert.equal(st.base, 1923000);
  assert.equal(st.share1, 480750);
  assert.equal(st.share2, 480750);
  const lr = loanReserves(data);
  assert.deepEqual([lr.outstanding, lr.pool], [800000, 800000]);
});

test("split: loan not yet covered -> every collection is reserved, base 0", () => {
  const data = { trips: sept, settings: S25, movements: [pay("2026-09-10", 100000), pay("2026-09-11", 50000)], cash: [loanCash("PRESTAMO", "2026-09-05", 500000)] };
  const st = tripStats(data, sept[0]);
  assert.deepEqual([st.collected, st.reserved, st.base, st.share1], [150000, 150000, 0, 0]);
  assert.deepEqual(loanReserves(data).pool, 150000);
});

test("split: return before collections covered the loan -> the uncovered part is deducted on return", () => {
  const data = { trips: sept, settings: S25, movements: [pay("2026-09-06", 100000), pay("2026-09-20", 400000)],
    cash: [loanCash("PRESTAMO", "2026-09-05", 300000), loanCash("DEVOLUCION", "2026-09-10", 300000)] };
  const st = tripStats(data, sept[0]);
  // 100k reserved, return uses it + 200k extra; later collections are free
  assert.deepEqual([st.reserved, st.returnDeducted, st.deducted, st.base], [100000, 200000, 300000, 200000]);
});

test("split: return after full coverage -> no double deduction", () => {
  const data = { trips: sept, settings: S25, movements: [pay("2026-09-06", 500000), pay("2026-09-25", 100000)],
    cash: [loanCash("PRESTAMO", "2026-09-05", 300000), loanCash("DEVOLUCION", "2026-09-20", 300000)] };
  const st = tripStats(data, sept[0]);
  assert.deepEqual([st.reserved, st.returnDeducted, st.base], [300000, 0, 300000]);
  assert.deepEqual([loanReserves(data).outstanding, loanReserves(data).pool], [0, 0]);
});

test("split: loan spanning two periods -> reserve continues into the next period", () => {
  const two = [{ id: "a", name: "A", startsOn: "2026-08-01", investment: 0 }, { id: "b", name: "B", startsOn: "2026-09-01", investment: 0 }];
  const data = { trips: two, settings: S25, movements: [pay("2026-08-20", 200000), pay("2026-09-03", 500000)],
    cash: [loanCash("PRESTAMO", "2026-08-15", 600000)] };
  const a = tripStats(data, two[0]), b = tripStats(data, two[1]);
  assert.deepEqual([a.reserved, a.base], [200000, 0]);
  assert.deepEqual([b.reserved, b.base], [400000, 100000]);
});

test("split: same-day order is loans, then collections, then returns", () => {
  const data = { trips: sept, settings: S25, movements: [pay("2026-09-05", 100000)],
    cash: [loanCash("DEVOLUCION", "2026-09-05", 100000, "X", 1), loanCash("PRESTAMO", "2026-09-05", 100000, "X", 2)] };
  const st = tripStats(data, sept[0]);
  assert.deepEqual([st.reserved, st.returnDeducted, st.base], [100000, 0, 0]);
});

test("split rule does not touch the cash box", () => {
  const data = { trips: sept, settings: S25, movements: [pay("2026-09-06", 500000), pay("2026-09-25", 100000)],
    cash: [loanCash("PRESTAMO", "2026-09-05", 300000), loanCash("DEVOLUCION", "2026-09-20", 100000), { id: "r", kind: "RETIRO", person: "J", date: "2026-09-26", amount: 50000 }] };
  // real money: 600k collected + 300k loan − 100k returned − 50k withdrawn
  assert.equal(cashDetail(data).balance, 750000);
  assert.equal(cashBalanceAfter(data, "2026-09-26", "r"), 750000);
});

test("calendar months: stats and full history with empty months", () => {
  const data = { movements: [
    { date: "2026-08-30", total: 10000, paid: 0, discountAmount: 0 },
    { date: "2026-10-02", total: 18000, paid: 5000, discountAmount: 2000 }, // total already net of the coupon
    { date: "2026-10-05", total: 0, paid: 7000 },
    { date: "2026-10-31", total: 1000, paid: 1000 }
  ] };
  assert.deepEqual(monthStats(data, "2026-10"), { month: "2026-10", sold: 19000, collected: 13000, movements: 3 });
  assert.deepEqual(monthStats(data, "2026-09"), { month: "2026-09", sold: 0, collected: 0, movements: 0 });
  const h = monthlyHistory(data, "2026-11-03");
  assert.deepEqual(h.map(x => x.month), ["2026-11", "2026-10", "2026-09", "2026-08"]);
  assert.deepEqual([h[0].sold, h[2].collected, h[3].sold], [0, 0, 10000]);
  assert.deepEqual(monthlyHistory({ movements: [] }, "2026-10-07").map(x => x.month), ["2026-10"]);
  assert.equal(monthlyHistory({ movements: [{ date: "2025-12-22", total: 1, paid: 0 }] }, "2026-01-02").length, 2); // across a year
  assert.equal(monthLabel("2026-10"), "OCTUBRE 2026");
});

console.log(`\n${passed} tests passed`);
