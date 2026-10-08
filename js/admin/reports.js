// Report builders for "Descargar": each one returns what its section currently shows
// (search, chips, sort and period filter respected; "Ver más" limits ignored). No DOM scraping.
// Never exported: passwords, auth emails, admin notes, receipt URLs.
import { fmtMoney, fmtDate } from "../format.js";
import { cashDetail, cashBalanceAfter, sortCash, periodSummary, monthlyHistory, monthLabel } from "../calc.js";
import { S, calcData, clientName } from "./store.js";
import { registerExport } from "./export.js";
import { filtered as filteredMovements } from "./movements.js";
import { rows as filteredClients } from "./clients.js";
import { KIND_LABEL, who } from "./cash.js";

const money = label => ({ label, align: "right", money: true });
const text = label => ({ label });
const sum = (rows, i) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);

registerExport("movimientos", () => {
  const list = filteredMovements();
  const trip = S.filters.movTrip ? S.trips.find(t => t.id === S.filters.movTrip) : null;
  const rows = list.map(m => {
    const coupon = m.couponId ? S.coupons.find(c => c.id === m.couponId) : null;
    return [
      fmtDate(m.date), clientName(m.clientId), m.clientId, m.total === 0 ? "Pago a cuenta" : m.detail || "Venta",
      m.total, m.paid, m.discountAmount ? `${coupon ? coupon.code : "Cupón"} −${fmtMoney(m.discountAmount)}` : ""
    ];
  });
  const filters = [trip && "Período " + trip.name, S.filters.movText && `Búsqueda “${S.filters.movText}”`].filter(Boolean).join(" · ");
  return {
    title: "Movimientos", filename: "Movimientos",
    subtitle: `${rows.length} movimientos${filters ? " · " + filters : ""}`,
    sections: [{
      heading: "Movimientos", sheet: "Movimientos",
      columns: [text("Fecha"), text("Clienta"), { label: "N°", align: "right" }, text("Detalle"), money("Total"), money("Pagó"), text("Cupón / desc.")],
      rows,
      totals: ["Total", "", "", "", sum(rows, 4), sum(rows, 5), ""]
    }]
  };
});

const CHIP_LABEL = { todas: "Todas", deben: "Deben", aldia: "Al día", inactivas: "Inactivas", sinacceso: "Sin acceso", conacceso: "Con acceso" };
const SORT_LABEL = { deuda: "Mayor deuda", nombre: "Nombre (A-Z)", numero: "N° de clienta", reciente: "Última compra", compras: "Más compraron" };

registerExport("clientas", () => {
  const rows = filteredClients().map(({ c, s }) => [
    c.id, c.name, c.displayName || "", c.phone || "", c.address || "", c.email || "",
    s.debt, s.last ? fmtDate(s.last) : "", c.userId ? "Con acceso" : "Sin acceso"
  ]);
  const parts = [`Filtro: ${CHIP_LABEL[S.filters.clientChip] || "Todas"}`, `Orden: ${SORT_LABEL[S.filters.clientSort] || "Mayor deuda"}`,
    S.filters.clientText && `Búsqueda “${S.filters.clientText}”`].filter(Boolean);
  return {
    title: "Clientas", filename: "Clientas",
    subtitle: `${rows.length} de ${S.clients.length} clientas · ${parts.join(" · ")}`,
    sections: [{
      heading: "Clientas", sheet: "Clientas",
      columns: [{ label: "N°", align: "right" }, text("Nombre"), text("Nombre que eligió ella"), text("Teléfono"), text("Dirección"),
        text("Email"), money("Saldo"), text("Última compra"), text("Acceso")],
      rows,
      totals: ["", "Total", "", "", "", "", sum(rows, 6), "", ""]
    }]
  };
});

registerExport("caja", () => {
  const data = calcData();
  const d = cashDetail(data);
  const cashRows = sortCash(S.cash).filter(c => !d.since || c.date >= d.since).reverse().map(c => [
    fmtDate(c.date), KIND_LABEL[c.kind] || c.kind, who(c),
    (c.kind === "AJUSTE" ? 1 : ["PRESTAMO", "INGRESO"].includes(c.kind) ? 1 : -1) * c.amount, c.note || "",
    cashBalanceAfter(data, c.date, c.id)
  ]);
  const { rows, total } = periodSummary(data);
  const s = S.settings;
  const tripRows = rows.map(({ trip, st }) => [trip.name, fmtDate(st.from), trip.investment, st.sold, st.collected, st.deducted, st.base, st.share1, st.share2, st.box]);
  const months = monthlyHistory(data).map(m => [monthLabel(m.month), m.sold, m.collected]);
  return {
    title: "Caja & Socios", filename: "Caja y Socios",
    subtitle: `Plata en la caja: ${fmtMoney(d.balance)} (contando desde ${d.since ? fmtDate(d.since) : "el principio"}, saldo inicial ${fmtMoney(d.initial)})`,
    sections: [
      {
        heading: "Movimientos de caja", sheet: "Caja",
        columns: [text("Fecha"), text("Tipo"), text("Quién"), money("Monto"), text("Nota"), money("Quedó")],
        rows: cashRows
      },
      {
        heading: "Resumen por viaje", sheet: "Por viaje",
        columns: [text("Período"), text("Desde"), money("Inversión"), money("Vendido"), money("Cobrado"), money("Para préstamos"),
          money("A repartir"), money(s.partner1Name), money(s.partner2Name), money("Sobró")],
        rows: tripRows,
        totals: ["Total", "", total.investment, total.sold, total.collected, total.deducted, total.base, total.share1, total.share2, total.box]
      },
      {
        heading: "Por mes", sheet: "Por mes",
        columns: [text("Mes"), money("Vendido"), money("Cobrado")],
        rows: months,
        totals: ["Total", sum(months, 1), sum(months, 2)]
      }
    ]
  };
});

const PAY_STATUS = { pending: "Pendiente", confirmed: "Confirmado", rejected: "Rechazado" };

registerExport("pagos", () => {
  // pending first (as on screen), then newest
  const list = [...S.paymentRequests].sort((a, b) => (b.status === "pending") - (a.status === "pending") || String(b.createdAt).localeCompare(String(a.createdAt)));
  const rows = list.map(r => [
    fmtDate(String(r.createdAt).slice(0, 10)), clientName(r.clientId), r.clientId, r.amount,
    PAY_STATUS[r.status] || r.status, r.note || "", r.receiptPath ? "Sí" : "No"
  ]);
  const pending = list.filter(r => r.status === "pending");
  return {
    title: "Pagos informados", filename: "Pagos informados",
    subtitle: `${pending.length} pendientes por ${fmtMoney(sum(pending.map(r => [r.amount]), 0))} · ${list.length} en total`,
    sections: [{
      heading: "Pagos informados", sheet: "Pagos",
      columns: [text("Fecha"), text("Clienta"), { label: "N°", align: "right" }, money("Monto"), text("Estado"), text("Nota"), text("Comprobante")],
      rows,
      totals: ["Total", "", "", sum(rows, 3), "", "", ""]
    }]
  };
});

