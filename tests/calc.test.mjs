// Run with: node tests/calc.test.mjs
import assert from "node:assert/strict";
import {
  clientBalance, clientSummaries, tripStats, splitCollected, cashDetail, cashBalanceAfter, pendingLoans,
  couponDiscount, couponIsValid, dashboard, periodSummary, daysSince, sortCash, pendingPayments, balanceWithPending, validTransferAmount, usedCouponIds, availableCoupons
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

test("split with a loan being returned: return is paid before anyone gets their %", () => {
  const st = tripStats(data, trips[1]);
  assert.equal(st.collected, 160000);
  assert.equal(st.returned, 100000);
  assert.equal(st.base, 60000);
  assert.deepEqual([st.share1, st.share2, st.box], [15000, 15000, 30000]);
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

console.log(`\n${passed} tests passed`);
