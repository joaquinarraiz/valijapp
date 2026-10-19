// "Métricas" on Inicio: hand-written inline SVG charts (CSP is script-src 'self', no chart library).
// Data prep lives in js/calc.js; this file only draws. Every chart has a title, an aria-label,
// <title> tooltips with exact values and a "Ver tabla" table, so nothing depends on colour alone.
import { html, raw } from "../dom.js";
import { fmtMoney } from "../format.js";
import {
  lastMonths, salesByMonth, debtAtMonthEnds, newClientsByMonth, topClients, tripSplitSeries,
  clientStatusCounts, activityCounts, monthLabel, todayISO, MONTH_NAMES
} from "../calc.js";
import { S, calcData, clientName } from "./store.js";

// ---------- formatting ----------
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Axis money: $1,2M / $350k / $900 */
export function abbrMoney(n) {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  if (a >= 1e3) return sign + "$" + Math.round(a / 1e3).toLocaleString("es-AR") + "k";
  return sign + "$" + Math.round(a);
}
/** "SEPTIEMBRE 2026" -> "sep 26" for crowded axes */
const tripShort = n => { const m = String(n).match(/^(\S{3})\S*\s+\d{2}(\d{2})$/); return m ? m[1].toLowerCase() + " " + m[2] : String(n).slice(0, 8); };
const shortMonth = ym => MONTH_NAMES[Number(ym.slice(5)) - 1].slice(0, 3).toLowerCase() + " " + ym.slice(2, 4);

/** Clean axis maximum and ticks (0 … max in 4 steps of 1/2/2.5/5 × 10^k). */
function niceScale(max) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * p).find(s => s >= raw);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { max: top, ticks };
}

/** Bar rect with a 4px rounded data-end and a square baseline (vertical). */
function colPath(x, y, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
/** Horizontal bar, rounded at the right end. */
function barPath(x, y, w, h) {
  if (w <= 0) return "";
  const r = Math.min(4, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

const W = 360, H = 210, M = { l: 46, r: 8, t: 10, b: 30 };

function frame(content, label, h = H) {
  return raw(`<svg class="viz-svg" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${content}</svg>`);
}
function yAxis(scale, plotH, fmt) {
  return scale.ticks.map(v => {
    const y = M.t + plotH - (v / scale.max) * plotH;
    return `<line class="viz-gridline" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/><text class="viz-tick" x="${M.l - 6}" y="${y + 3.5}" text-anchor="end">${esc(fmt(v))}</text>`;
  }).join("");
}
function xLabels(cats, x0, band, plotH, every = 1) {
  return cats.map((c, i) => i % every ? "" :
    `<text class="viz-tick" x="${x0 + band * i + band / 2}" y="${M.t + plotH + 16}" text-anchor="middle">${esc(c)}</text>`).join("");
}
const legend = items => html`<div class="viz-legend">${items.map(([cls, label]) => html`<span><i class="viz-key ${cls}"></i>${label}</span>`)}</div>`;
function table(head, rows) {
  return html`<details class="viz-table"><summary>Ver tabla</summary><div class="table-wrap"><table>
    <thead><tr>${head.map((h, i) => html`<th class="${i ? "num" : ""}">${h}</th>`)}</tr></thead>
    <tbody>${rows.map(r => html`<tr>${r.map((c, i) => html`<td class="${i ? "num" : ""}">${c}</td>`)}</tr>`)}</tbody>
  </table></div></details>`;
}
const empty = text => html`<p class="viz-empty">${text}</p>`;
const card = (title, sub, body) => html`<section class="card viz-card"><h3 class="h3">${title}</h3>${sub ? html`<p class="small muted viz-sub">${sub}</p>` : ""}${body}</section>`;

// ---------- chart types ----------
/** Grouped columns: categories × series [{ cls, name, values }]. */
function groupedColumns(cats, series, { label, fmt = abbrMoney, exact = fmtMoney }) {
  const plotH = H - M.t - M.b, plotW = W - M.l - M.r;
  const scale = niceScale(Math.max(0, ...series.flatMap(s => s.values)));
  const band = plotW / cats.length;
  const barW = Math.min(12, (band - 6) / series.length - 1);
  const groupW = barW * series.length + 2 * (series.length - 1);
  let marks = "";
  cats.forEach((c, i) => {
    series.forEach((s, j) => {
      const v = s.values[i];
      const h = (v / scale.max) * plotH;
      const x = M.l + band * i + (band - groupW) / 2 + j * (barW + 2);
      const d = colPath(x, M.t + plotH - h, barW, h);
      if (d) marks += `<path class="viz-mark ${s.cls}" d="${d}"><title>${esc(`${c} · ${s.name}: ${exact(v)}`)}</title></path>`;
    });
  });
  const every = cats.length > 8 ? 2 : 1;
  return frame(yAxis(scale, plotH, fmt) + `<line class="viz-axis" x1="${M.l}" x2="${W - M.r}" y1="${M.t + plotH}" y2="${M.t + plotH}"/>` + marks + xLabels(cats, M.l, band, plotH, every), label);
}

/** Single-series line with a 10% area wash and an end dot. */
function lineArea(cats, values, { label, cls }) {
  const plotH = H - M.t - M.b, plotW = W - M.l - M.r;
  const scale = niceScale(Math.max(0, ...values));
  const band = plotW / cats.length;
  const pts = values.map((v, i) => [M.l + band * i + band / 2, M.t + plotH - (v / scale.max) * plotH]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
  const area = line + `L${pts.at(-1)[0].toFixed(1)},${M.t + plotH}L${pts[0][0].toFixed(1)},${M.t + plotH}Z`;
  const dots = pts.map((p, i) => `<circle class="viz-hit" cx="${p[0]}" cy="${p[1]}" r="9"><title>${esc(`${cats[i]}: ${fmtMoney(values[i])}`)}</title></circle>`).join("");
  const end = pts.at(-1);
  return frame(yAxis(scale, plotH, abbrMoney) +
    `<path class="viz-area ${cls}" d="${area}"/><path class="viz-line ${cls}" d="${line}"/>` +
    `<circle class="viz-dot ${cls}" cx="${end[0]}" cy="${end[1]}" r="4.5"/>` + dots +
    `<text class="viz-value" x="${Math.min(end[0], W - M.r - 2)}" y="${Math.max(end[1] - 9, 12)}" text-anchor="end">${esc(abbrMoney(values.at(-1)))}</text>` +
    xLabels(cats, M.l, band, plotH, cats.length > 8 ? 2 : 1), label);
}

/** Horizontal bars with the name on the left and the value at the tip. */
function hBars(items, { label, cls }) {
  const rowH = 22, labelW = 112, valueW = 52;
  const h = items.length * rowH + 8;
  const max = Math.max(...items.map(x => x.value), 1);
  const plotW = W - labelW - valueW - 4;
  const rows = items.map((x, i) => {
    const y = 4 + i * rowH;
    const w = (x.value / max) * plotW;
    const name = x.label.length > 18 ? x.label.slice(0, 17) + "…" : x.label;
    return `<g><title>${esc(`${x.label}: ${fmtMoney(x.value)}`)}</title>` +
      `<text class="viz-tick viz-name" x="${labelW - 6}" y="${y + rowH / 2 + 3.5}" text-anchor="end">${esc(name)}</text>` +
      `<path class="viz-mark ${cls}" d="${barPath(labelW, y + 4, Math.max(w, 2), rowH - 8)}"/>` +
      `<text class="viz-value" x="${labelW + Math.max(w, 2) + 5}" y="${y + rowH / 2 + 3.5}">${esc(abbrMoney(x.value))}</text></g>`;
  }).join("");
  return frame(rows, label, h);
}

/** Stacked columns, 2px surface gaps between segments. series: [{ cls, name, values }] bottom → top. */
function stackedColumns(cats, series, { label }) {
  const plotH = H - M.t - M.b, plotW = W - M.l - M.r;
  const totals = cats.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const scale = niceScale(Math.max(0, ...totals));
  const band = plotW / cats.length;
  const barW = Math.min(24, band - 8);
  let marks = "";
  cats.forEach((c, i) => {
    let y = M.t + plotH;
    const x = M.l + band * i + (band - barW) / 2;
    const visible = series.filter(s => s.values[i] > 0);
    visible.forEach((s, k) => {
      const v = s.values[i];
      const hRaw = (v / scale.max) * plotH;
      const gap = k < visible.length - 1 && hRaw > 3 ? 2 : 0;
      const h = Math.max(hRaw - gap, 0.5);
      const top = y - hRaw;
      const d = k === visible.length - 1 ? colPath(x, top, barW, h) : `M${x},${top + gap}h${barW}v${h}h${-barW}Z`;
      marks += `<path class="viz-mark ${s.cls}" d="${d}"><title>${esc(`${c} · ${s.name}: ${fmtMoney(v)}`)}</title></path>`;
      y -= hRaw;
    });
  });
  return frame(yAxis(scale, plotH, abbrMoney) + `<line class="viz-axis" x1="${M.l}" x2="${W - M.r}" y1="${M.t + plotH}" y2="${M.t + plotH}"/>` + marks +
    xLabels(cats.map(tripShort), M.l, band, plotH, cats.length > 8 ? 2 : 1), label);
}

/** 100% bar with labelled parts (HTML; direct labels + legend, so not colour-only). */
function percentBar(title, parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return html`<div class="viz-pct">
    <div class="viz-pct-title">${title}</div>
    <div class="viz-pct-bar" role="img" aria-label="${title}: ${parts.map(p => `${p.label} ${p.value}`).join(", ")}">
      ${parts.filter(p => p.value > 0).map(p => html`<span class="${p.cls}" style="flex-grow:${p.value}" title="${p.label}: ${p.value} (${total ? Math.round(p.value * 100 / total) : 0}%)"></span>`)}
    </div>
    <div class="viz-legend">${parts.map(p => html`<span><i class="viz-key ${p.cls}"></i>${p.label} <strong>${p.value}</strong> <span class="muted">(${total ? Math.round(p.value * 100 / total) : 0}%)</span></span>`)}</div>
  </div>`;
}

// ---------- the section ----------
export function metricsSection() {
  const data = calcData();
  const today = todayISO();
  const months = lastMonths(12, today);
  const firstData = S.movements.reduce((a, m) => (m.date && (!a || m.date < a) ? m.date : a), null);
  const shown = firstData ? months.filter(m => m >= firstData.slice(0, 7)) : [];
  const cats = shown.map(shortMonth);

  // a. sales vs collections
  const sales = salesByMonth(S.movements, shown);
  const salesHas = sales.some(x => x.sold || x.collected);
  const a = card("Ventas y cobros por mes", "Últimos 12 meses, mes calendario", salesHas ? html`
    ${legend([["viz-s-sold", "Vendido"], ["viz-s-paid", "Cobrado"]])}
    ${groupedColumns(cats, [{ cls: "viz-s-sold", name: "Vendido", values: sales.map(x => x.sold) }, { cls: "viz-s-paid", name: "Cobrado", values: sales.map(x => x.collected) }], { label: "Vendido y cobrado por mes, últimos 12 meses" })}
    ${table(["Mes", "Vendido", "Cobrado"], sales.map(x => [monthLabel(x.month), fmtMoney(x.sold), fmtMoney(x.collected)]))}` : empty("Todavía no hay ventas anotadas."));

  // b. total debt at each month end
  const debt = debtAtMonthEnds(S.movements, shown);
  const b = card("Deuda total al cierre de cada mes", "Suma de lo que deben las clientas al último día del mes", debt.length ? html`
    ${lineArea(cats, debt.map(x => x.debt), { label: "Deuda total al cierre de cada mes", cls: "viz-s-debt" })}
    ${table(["Mes", "Deuda al cierre"], debt.map(x => [monthLabel(x.month), fmtMoney(x.debt)]))}` : empty("Sin datos todavía."));

  // c. new clients per month
  const fresh = newClientsByMonth(S.movements, shown);
  const c = card("Clientas nuevas por mes", "Según la fecha de su primer movimiento", fresh.some(x => x.count) ? html`
    ${groupedColumns(cats, [{ cls: "viz-s-sold", name: "Clientas nuevas", values: fresh.map(x => x.count) }], { label: "Clientas nuevas por mes", fmt: v => String(Math.round(v)), exact: v => `${v} clientas` })}
    ${table(["Mes", "Clientas nuevas"], fresh.map(x => [monthLabel(x.month), String(x.count)]))}` : empty("No hubo clientas nuevas en estos meses."));

  // d, e. tops
  const tops = topClients(S.movements, 10);
  const named = list => list.map(x => ({ label: clientName(x.clientId), value: x.value }));
  const d = card("Top 10 clientas por compras", "Histórico", tops.buyers.length ? html`
    ${hBars(named(tops.buyers), { label: "Las 10 clientas que más compraron", cls: "viz-s-sold" })}
    ${table(["Clienta", "Compró"], named(tops.buyers).map(x => [x.label, fmtMoney(x.value)]))}` : empty("Todavía no hay compras."));
  const e = card("Top 10 deudoras", "Saldo actual", tops.debtors.length ? html`
    ${hBars(named(tops.debtors), { label: "Las 10 clientas que más deben", cls: "viz-s-debt" })}
    ${table(["Clienta", "Debe"], named(tops.debtors).map(x => [x.label, fmtMoney(x.value)]))}` : empty("Nadie debe nada 🎉"));

  // f. split per trip
  const trips = tripSplitSeries(data);
  const s = S.settings;
  const f = card("Cobrado por viaje y reparto", "Cómo se repartió lo cobrado en cada viaje", trips.length ? html`
    ${legend([["viz-s-p2", s.partner2Name], ["viz-s-p1", s.partner1Name], ["viz-s-biz", "Negocio"], ["viz-s-loan", "Para préstamos"]])}
    ${stackedColumns(trips.map(t => t.name), [
      { cls: "viz-s-p2", name: s.partner2Name, values: trips.map(t => t.partner2) },
      { cls: "viz-s-p1", name: s.partner1Name, values: trips.map(t => t.partner1) },
      { cls: "viz-s-biz", name: "Negocio", values: trips.map(t => t.business) },
      { cls: "viz-s-loan", name: "Para préstamos", values: trips.map(t => t.loans) }
    ], { label: "Cobrado por viaje, repartido entre socios, negocio y préstamos" })}
    ${table(["Viaje", "Cobrado", s.partner1Name, s.partner2Name, "Negocio", "Para préstamos"], trips.map(t => [t.name, fmtMoney(t.collected), fmtMoney(t.partner1), fmtMoney(t.partner2), fmtMoney(t.business), fmtMoney(t.loans)]))}` : empty("Todavía no hay viajes cargados."));

  // g. client states
  const st = clientStatusCounts(S.clients, S.movements);
  const g = card("Clientas", `${S.clients.length} en total`, S.clients.length ? html`
    ${percentBar("Saldo", [{ cls: "viz-s-debt", label: "Con deuda", value: st.owes }, { cls: "viz-s-neutral", label: "Al día", value: st.clear }, { cls: "viz-s-sold", label: "A favor", value: st.credit }])}
    ${percentBar("Acceso a la app", [{ cls: "viz-s-paid", label: "Con acceso", value: st.withAccess }, { cls: "viz-s-neutral", label: "Sin acceso", value: st.withoutAccess }])}` : empty("Todavía no hay clientas."));

  // h. activity
  const days = Number(S.settings.inactiveDays) || 45;
  const act = activityCounts(S.clients, S.movements, days, today);
  const h = card("Actividad", `Activas = compraron en los últimos ${days} días`, S.clients.length ? html`
    ${percentBar("Clientas", [{ cls: "viz-s-paid", label: "Activas", value: act.active }, { cls: "viz-s-neutral", label: "Inactivas", value: act.inactive }, { cls: "viz-s-faint", label: "Nunca compraron", value: act.never }])}` : empty("Todavía no hay clientas."));

  return html`<section class="metrics" aria-labelledby="metricsTitle">
    <h2 class="display-m" id="metricsTitle">Métricas</h2>
    <div class="viz-grid">${a}${b}${c}${d}${e}${f}${g}${h}</div>
  </section>`;
}
