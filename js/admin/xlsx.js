// Excel export in the legacy format (same sheets and columns), plus an ID column so re-imports never duplicate.
import { fmtDate } from "../format.js";
import { cashDetail, clientSummaries, sortCash, sortTrips, tripStats, todayISO } from "../calc.js";
import { S, calcData, clientById, partnerName } from "./store.js";

const XLSX_URL = new URL("../vendor/xlsx-0.18.5.full.min.js", import.meta.url).href; // vendored, same origin

export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = XLSX_URL;
    s.onload = () => ok(window.XLSX);
    s.onerror = () => fail(new Error("No pude cargar la librería de Excel"));
    document.head.appendChild(s);
  });
}

export async function exportXlsx() {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const data = calcData();
  const s = S.settings;

  // CLIENTES
  const sums = clientSummaries(S.movements);
  const fc = [["N°", "NOMBRE", "TELEFONO", "DIRECCION", "DEUDA", "TOTAL COMPRADO", "ULTIMA COMPRA", "NOMBRE ELEGIDO", "EMAIL"]];
  S.clients.map(c => ({ c, d: sums.get(c.id) || { debt: 0, bought: 0, last: null } }))
    .sort((a, b) => b.d.debt - a.d.debt)
    .forEach(({ c, d }) => fc.push([c.id, c.name, c.phone, c.address, d.debt, d.bought, d.last ? fmtDate(d.last) : "", c.displayName || "", c.email || ""]));
  const wsC = XLSX.utils.aoa_to_sheet(fc);
  wsC["!cols"] = [5, 26, 20, 24, 12, 16, 14, 18, 24].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsC, "CLIENTES");

  // CUENTA CORRIENTE (col H = ID, ignored by the v1 importer)
  const fm = [["FECHA", "N°", "NOMBRE", "LLEVO", "TOTAL", "PAGO", "DEBE", "ID"]];
  [...S.movements].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(m => {
    const debe = m.total - m.paid;
    const c = clientById(m.clientId);
    fm.push([m.date ? new Date(m.date + "T00:00:00") : "", m.clientId, c ? c.name : "", m.detail, m.total, m.paid, debe === 0 ? "PAGO" : debe, m.legacyId || m.id]);
  });
  const wsM = XLSX.utils.aoa_to_sheet(fm, { cellDates: true });
  wsM["!cols"] = [11, 5, 24, 46, 11, 11, 11, 12].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsM, "CUENTA CORRIENTE");

  // RESUMEN
  const fr = [["PERIODO", "DESDE", "INVERSION", "VENDIDO", "COBRADO", "DEVUELTO", "A REPARTIR", `${s.partner1Name} ${s.partner1Pct}%`, `${s.partner2Name} ${s.partner2Pct}%`, "SOBRO DEL PERIODO"]];
  const t = [0, 0, 0, 0, 0, 0, 0, 0];
  sortTrips(S.trips).forEach(v => {
    const st = tripStats(data, v);
    const row = [v.investment, st.sold, st.collected, st.returned, st.base, st.share1, st.share2, st.box];
    row.forEach((x, i) => t[i] += x);
    fr.push([v.name, fmtDate(v.startsOn), ...row]);
  });
  fr.push(["TOTAL", "", ...t]);
  const wsR = XLSX.utils.aoa_to_sheet(fr);
  wsR["!cols"] = fr[0].map((_, i) => ({ wch: i === 0 ? 18 : 14 }));
  XLSX.utils.book_append_sheet(wb, wsR, "RESUMEN");

  // VIAJES
  const fv = [["NOMBRE", "DESDE", "INVERSION", "ID"]];
  sortTrips(S.trips).forEach(v => fv.push([v.name, v.startsOn, v.investment, v.legacyId || v.id]));
  const wsV = XLSX.utils.aoa_to_sheet(fv);
  wsV["!cols"] = [18, 12, 14, 12].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsV, "VIAJES");

  // LUGARES
  const fl = [["NOMBRE", "SHOPPING", "PASILLO", "STAND", "TELEFONO", "NOTAS", "ID"]];
  S.places.forEach(l => fl.push([l.name, l.mall, l.aisle, l.stand, l.phone, l.notes, l.legacyId || l.id]));
  const wsL = XLSX.utils.aoa_to_sheet(fl);
  wsL["!cols"] = [24, 16, 12, 8, 18, 34, 12].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsL, "LUGARES");

  // CAJA
  const d = cashDetail(data);
  const fcj = [["FECHA", "TIPO", "QUIEN", "MONTO", "NOTA", "ID"]];
  fcj.push([d.since, "SALDO INICIAL", "", d.initial, "LA CAJA EMPIEZA A CONTAR ACA", ""]);
  sortCash(S.cash).forEach(c => fcj.push([c.date, c.kind, c.kind === "RETIRO" ? partnerName(c.person) : c.person, c.amount, c.note, c.legacyId || c.id]));
  fcj.push([]);
  fcj.push(["", "COBRADO", "", d.collected, "PAGOS DE CLIENTAS DESDE EL CORTE"]);
  fcj.push(["", "INVERTIDO", "", -d.invested, "INVERSION DE LOS VIAJES"]);
  fcj.push([todayISO(), "SALDO ACTUAL", "", d.balance, "PLATA QUE HAY EN LA CAJA"]);
  const wsCj = XLSX.utils.aoa_to_sheet(fcj);
  wsCj["!cols"] = [12, 14, 20, 12, 30, 12].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsCj, "CAJA");

  XLSX.writeFile(wb, "ValijApp " + fmtDate(todayISO()).replace(/\//g, "-") + ".xlsx");
}
