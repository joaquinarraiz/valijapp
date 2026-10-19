// "Descargar resumen": account statement of one client for a period, via the shared exporter.
// Never includes notes, phone, address or credentials.
import { html, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { fmtMoney, fmtDate } from "../format.js";
import { clientStatement, statementRange, todayISO } from "../calc.js";
import { S, clientById } from "./store.js";
import { exportReport } from "./export.js";
import { openClientDrawer } from "./clients.js";

const PRESETS = [["month", "Este mes"], ["prev", "Mes anterior"], ["3m", "Últimos 3 meses"], ["all", "Todo"], ["custom", "Elegir fechas"]];
const isoOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const balanceText = n => n < 0 ? "a favor " + fmtMoney(-n) : fmtMoney(n);

function firstDateOf(clientId) {
  return S.movements.filter(m => m.clientId === clientId && m.date).map(m => m.date).sort()[0] || null;
}

/** Builds the report object for exportReport (pure on top of calc + store). */
export function statementReport(clientId, from, to) {
  const c = clientById(clientId);
  const st = clientStatement({ movements: S.movements, coupons: S.coupons }, clientId, from, to);
  const name = c.displayName || c.name;
  const summary = [
    ["Saldo al inicio", balanceText(st.opening)],
    ["Compras", fmtMoney(st.totalBought)],
    ["Pagos", fmtMoney(st.totalPaid)],
    ...(st.totalDiscount > 0 ? [["Descuentos", fmtMoney(st.totalDiscount)]] : []),
    ["Saldo al final", balanceText(st.closing)]
  ];
  const rows = st.rows.length
    ? st.rows.map(r => [
      fmtDate(r.date),
      (r.detail || (r.total ? "Compra" : "Pago")) +
        (r.discount > 0 ? ` (cupón${r.couponCode ? " " + r.couponCode : ""} −${fmtMoney(r.discount)})` : ""),
      r.total || null, r.paid || null, r.balance
    ])
    : [["", "Sin movimientos en este período", null, null, null]];
  const safeName = String(name).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: "Resumen de cuenta",
    subtitle: `${name} · N° ${c.id} · del ${fmtDate(from)} al ${fmtDate(to)}`,
    filename: "Resumen",
    fileBase: `ValijApp - Resumen ${c.id} ${safeName} - ${from} a ${to}`,
    sections: [
      { heading: "Resumen", sheet: "Resumen", columns: [{ label: "Concepto" }, { label: "Monto", align: "right" }], rows: summary },
      {
        heading: "Movimientos", sheet: "Movimientos",
        columns: [{ label: "Fecha" }, { label: "Detalle" }, { label: "Compra", money: true }, { label: "Pagó", money: true }, { label: "Saldo", money: true }],
        rows
      }
    ]
  };
}

function paintRange() {
  const f = $("#stmtForm");
  if (!f) return;
  const preset = f.preset.value;
  const custom = preset === "custom";
  $("#stmtDates").hidden = !custom;
  if (!custom) {
    const r = statementRange(preset, todayISO(), firstDateOf(Number(f.id.value)));
    f.from.value = r.from; f.to.value = r.to;
  }
  $("#stmtRange").textContent = isoOk(f.from.value) && isoOk(f.to.value) ? `Del ${fmtDate(f.from.value)} al ${fmtDate(f.to.value)}` : "";
}

export function statementSheet(clientId) {
  const c = clientById(clientId);
  const r = statementRange("month");
  openSheet(html`
  <h2 class="display-m">Resumen de cuenta</h2>
  <p class="muted">${c.name} · N° ${c.id}</p>
  <form class="form" data-form="stmt-download" id="stmtForm">
    <input type="hidden" name="id" value="${c.id}">
    <fieldset class="pay-amount"><legend>Período</legend>
      <div class="chips" role="radiogroup">
        ${PRESETS.map(([id, label], i) => html`<label class="filter-chip radio-chip"><input type="radio" name="preset" value="${id}" ${i === 0 ? "checked" : ""} data-input="stmt-preset"> ${label}</label>`)}
      </div>
    </fieldset>
    <div class="grid-2" id="stmtDates" hidden>
      <label>Desde<input type="date" name="from" value="${r.from}" required data-input="stmt-date"></label>
      <label>Hasta<input type="date" name="to" value="${r.to}" required data-input="stmt-date"></label>
    </div>
    <p class="small muted" id="stmtRange"></p>
    <label>Formato
      <select name="format">
        <option value="pdf">PDF</option>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="jpg">Imagen (.jpg)</option>
      </select></label>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Descargar</button>
    </div>
  </form>`, { onClose: () => setTimeout(() => openClientDrawer(c.id)) });
  paintRange();
}

onInput("stmt-preset", paintRange);
onInput("stmt-date", () => {
  const f = $("#stmtForm");
  $("#stmtRange").textContent = isoOk(f.from.value) && isoOk(f.to.value) ? `Del ${fmtDate(f.from.value)} al ${fmtDate(f.to.value)}` : "";
});
onAction("drawer-statement", d => statementSheet(Number(d.id)));

onForm("stmt-download", async f => {
  if (!isoOk(f.from) || !isoOk(f.to)) return toast("Elegí las dos fechas");
  if (f.from > f.to) return toast("La fecha “desde” tiene que ser anterior o igual a “hasta”");
  if (f.format !== "xlsx") toast("Generando…");
  try {
    await exportReport(statementReport(Number(f.id), f.from, f.to), f.format);
    closeSheet();
  } catch (e) {
    console.error(e);
    toast("No se pudo generar el resumen: " + (e.message || e));
  }
});
