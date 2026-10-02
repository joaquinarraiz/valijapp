// Caja & Socios: cash box, partner split per period, trips/investments.
import { html, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must } from "../supabase.js";
import { fmtMoney, fmtDate } from "../format.js";
import {
  cashDetail, cashSign, cashBalanceAfter, sortCash, withdrawnSinceCut, withdrawnIn, withdrawnTotal,
  tripStats, periodSummary, pendingLoans, totalPendingLoans, sortTrips, collectedByMonth, todayISO
} from "../calc.js";
import { norm } from "../legacy.js";
import { luggageTag, stat } from "../ui.js";
import { S, map, calcData, partnerName, upsertLocal, removeLocal, deleteOne } from "./store.js";
import { rerender } from "./app.js";
import { scheduleBackup } from "./sync.js";

const KIND_LABEL = { RETIRO: "Retiro", PRESTAMO: "Préstamo", DEVOLUCION: "Devolución", INGRESO: "Entró plata", GASTO: "Salió plata", AJUSTE: "Ajuste" };
const KIND_TONE = { RETIRO: "owes", PRESTAMO: "credit", DEVOLUCION: "neutral", INGRESO: "paid", GASTO: "owes", AJUSTE: "neutral" };

function who(c) {
  return c.kind === "RETIRO" ? partnerName(c.person) : c.person || "—";
}

export function cashRow(c, withBalance = true) {
  const signed = cashSign(c.kind) * c.amount;
  return html`<li><button class="row" data-act="cash-edit" data-id="${c.id}">
    <span class="row-date">${fmtDate(c.date)}</span>
    <span class="row-main"><span class="row-title"><span class="chip ${KIND_TONE[c.kind]}">${KIND_LABEL[c.kind] || c.kind}</span> ${who(c)}</span>
      ${c.note ? html`<span class="row-sub">${c.note}</span>` : ""}</span>
    <span class="row-amounts"><span class="amt ${signed >= 0 ? "paid" : "owes"}">${signed >= 0 ? "+" : "−"}${fmtMoney(Math.abs(c.amount))}</span>
      ${withBalance ? html`<span class="small muted">quedó ${fmtMoney(cashBalanceAfter(calcData(), c.date, c.id))}</span>` : ""}</span>
  </button></li>`;
}

export function vCash() {
  const tabs = [["caja", "Caja"], ["socios", "Socios y períodos"], ["viajes", "Viajes e inversiones"]];
  return html`
  <header class="view-head"><h1 class="display-l">Caja & Socios</h1></header>
  <div class="seg wide" role="tablist">
    ${tabs.map(([id, label]) => html`<button role="tab" class="${S.cashTab === id ? "on" : ""}" aria-selected="${S.cashTab === id}" data-act="cash-tab" data-tab="${id}">${label}</button>`)}
  </div>
  ${S.cashTab === "socios" ? vPartners() : S.cashTab === "viajes" ? vTrips() : vBox()}`;
}
onAction("cash-tab", d => { S.cashTab = d.tab; rerender(); });

// ---------- Caja ----------
function vBox() {
  const d = cashDetail(calcData());
  const movs = sortCash(S.cash).filter(c => !d.since || c.date >= d.since).reverse();
  const line = (label, value, sign) => html`<tr><td>${label}</td><td class="num ${sign > 0 ? "paid" : sign < 0 ? "owes" : ""}">${sign > 0 ? "+" : sign < 0 ? "−" : ""}${fmtMoney(Math.abs(value))}</td></tr>`;
  return html`
  ${luggageTag({
    label: "Plata que hay ahora mismo", amount: fmtMoney(d.balance), tone: d.balance >= 0 ? "box" : "negative",
    sub: `contando desde ${d.since ? fmtDate(d.since) : "el principio"} · ya descontados los retiros y lo invertido`,
    children: html`<button class="btn tag-btn" data-act="cash-correct">Corregir el saldo</button>`
  })}
  <div class="btn-row">
    <button class="btn ghost" data-act="cash-new" data-kind="INGRESO">+ Entró plata</button>
    <button class="btn ghost" data-act="cash-new" data-kind="GASTO">− Salió plata</button>
    <button class="btn ghost" data-act="cash-new" data-kind="RETIRO">Retiro</button>
    <button class="btn ghost" data-act="cash-new" data-kind="PRESTAMO">Préstamo</button>
    <button class="btn ghost" data-act="cash-new" data-kind="DEVOLUCION">Devolución</button>
  </div>
  <div class="two-col">
    <section class="card">
      <h2 class="h3">De dónde sale ese número</h2>
      <table class="ledger"><tbody>
        <tr><td>Saldo inicial <span class="muted small">(al ${d.since ? fmtDate(d.since) : "inicio"})</span></td><td class="num">${fmtMoney(d.initial)}</td></tr>
        ${line("Cobrado a las clientas", d.collected, 1)}
        ${d.loans ? line("Préstamos recibidos", d.loans, 1) : ""}
        ${d.incomes ? line("Otros ingresos", d.incomes, 1) : ""}
        ${d.invested ? line("Invertido en los viajes", d.invested, -1) : ""}
        ${line("Retiros de " + S.settings.partner1Name, withdrawnSinceCut(calcData(), "J"), -1)}
        ${line("Retiros de " + S.settings.partner2Name, withdrawnSinceCut(calcData(), "M"), -1)}
        ${d.returns ? line("Devoluciones de préstamos", d.returns, -1) : ""}
        ${d.expenses ? line("Gastos", d.expenses, -1) : ""}
        ${d.adjustments ? line("Ajustes a mano", d.adjustments, d.adjustments >= 0 ? 1 : -1) : ""}
        <tr class="total"><td>Queda en caja</td><td class="num">${fmtMoney(d.balance)}</td></tr>
      </tbody></table>
    </section>
    <form class="card form" data-form="cash-cut">
      <h2 class="h3">Desde cuándo cuenta la caja</h2>
      <p class="hint">La caja empieza a contar en esta fecha con este saldo. Todo lo anterior queda afuera (sirve para arrancar de cero sin cargar años de historia).</p>
      <div class="grid-2">
        <label>Contar desde<input type="date" name="since" value="${d.since || ""}" required></label>
        <label>Saldo que había ese día ($)<input type="number" name="initial" step="1" value="${d.initial}"></label>
      </div>
      <button class="btn ghost" type="submit">Guardar</button>
    </form>
  </div>
  <section class="card flush">
    <h2 class="h3 pad">Movimientos de la caja</h2>
    <p class="hint pad">Cada vez que anotás un pago de una clienta la caja sube sola. Acá solo van los movimientos de plata que no son ventas.</p>
    ${movs.length ? html`<ul class="rows">${movs.map(c => cashRow(c))}</ul>` : html`<p class="muted pad">Todavía no hay movimientos anotados en este período.</p>`}
  </section>`;
}

export function cashSheet(id, kindInitial = "RETIRO") {
  const c = id ? S.cash.find(x => x.id === id) : null;
  const kind = c ? c.kind : kindInitial;
  const opt = (v, t) => html`<option value="${v}" ${kind === v ? "selected" : ""}>${t}</option>`;
  openSheet(html`
  <h2 class="display-m">${c ? "Editar movimiento de caja" : KIND_LABEL[kind] === "Retiro" ? "Anotar retiro" : "Anotar en la caja"}</h2>
  <form class="form" data-form="cash-save" id="cashForm">
    <input type="hidden" name="id" value="${c ? c.id : ""}">
    <label>¿Qué pasó?
      <select name="kind" data-input="cash-kind">
        ${opt("INGRESO", "Entró plata (otro ingreso)")}${opt("GASTO", "Salió plata (gasto)")}${opt("RETIRO", "Retiro de ganancia")}
        ${opt("PRESTAMO", "Préstamo recibido (a devolver)")}${opt("DEVOLUCION", "Devolución de préstamo")}${opt("AJUSTE", "Ajuste a mano")}
      </select></label>
    <label class="kind-retiro">¿Quién retira?
      <select name="partner">
        <option value="J" ${c && c.person === "J" ? "selected" : ""}>${S.settings.partner1Name}</option>
        <option value="M" ${c && c.person === "M" ? "selected" : ""}>${S.settings.partner2Name}</option>
      </select></label>
    <label class="kind-loan">¿Quién les prestó?<input name="lender" list="lenders" value="${c && (c.kind === "PRESTAMO" || c.kind === "DEVOLUCION") ? c.person : ""}" placeholder="Ej: TÍA MARTA, BANCO"></label>
    <datalist id="lenders">${[...new Set(S.cash.filter(x => x.kind === "PRESTAMO").map(x => x.person))].map(p => html`<option value="${p}">`)}</datalist>
    <div class="grid-2">
      <label>Fecha<input type="date" name="date" value="${c ? c.date : todayISO()}" required></label>
      <label><span id="cashAmountLabel">Monto ($)</span><input type="number" name="amount" step="1" value="${c ? c.amount : ""}" placeholder="0" required></label>
    </div>
    <label>Nota (opcional)<input name="note" maxlength="120" value="${c ? c.note : ""}" placeholder="Ej: FLETE, BOLSAS, PAGO MENSUAL"></label>
    <p class="small" id="cashHint"></p>
    <div class="form-actions">
      ${c ? html`<button type="button" class="btn danger-ghost" data-act="cash-delete" data-id="${c.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar</button>
    </div>
  </form>`);
  cashKindChanged();
}

function cashKindChanged() {
  const f = $("#cashForm");
  if (!f) return;
  const k = f.kind.value;
  f.querySelector(".kind-retiro").hidden = k !== "RETIRO";
  f.querySelector(".kind-loan").hidden = k !== "PRESTAMO" && k !== "DEVOLUCION";
  $("#cashAmountLabel").textContent = k === "AJUSTE" ? "Monto ($) — con un menos adelante si la caja baja" : "Monto ($)";
  $("#cashHint").textContent = k === "AJUSTE" ? "El ajuste se suma tal cual. Ej: -5000 baja la caja $5.000."
    : `Esto va a ${k === "INGRESO" || k === "PRESTAMO" ? "sumar" : "restar"} plata de la caja.`;
}
onInput("cash-kind", cashKindChanged);
onAction("cash-edit", d => cashSheet(d.id));

onForm("cash-save", async f => {
  const kind = f.kind;
  let person = "";
  if (kind === "RETIRO") person = f.partner;
  else if (kind === "PRESTAMO" || kind === "DEVOLUCION") person = norm(f.lender);
  let amount = parseFloat(f.amount);
  if (!f.date || isNaN(amount) || amount === 0) return toast("Completá fecha y monto");
  if (kind !== "AJUSTE") amount = Math.abs(amount);
  if ((kind === "PRESTAMO" || kind === "DEVOLUCION") && !person) return toast("Poné quién les prestó");
  const row = { kind, person, date: f.date, amount, note: (f.note || "").trim().toUpperCase() };
  const saved = must(f.id
    ? await S.sb.from("cash_movements").update(row).eq("id", f.id).select().single()
    : await S.sb.from("cash_movements").insert(row).select().single());
  upsertLocal(S.cash, map.cash(saved));
  closeSheet(); rerender(); scheduleBackup();
  toast(`Anotado. En la caja quedan ${fmtMoney(cashDetail(calcData()).balance)}`);
});

onAction("cash-delete", async d => {
  if (!confirm("¿Borrar este movimiento de caja?")) return;
  try { await deleteOne("cash_movements", d.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.cash, d.id);
  closeSheet(); rerender(); scheduleBackup();
  toast("Borrado");
});

onAction("cash-correct", () => {
  const d = cashDetail(calcData());
  openSheet(html`
  <h2 class="display-m">Corregir el saldo de la caja</h2>
  <p class="hint">Contá la plata que hay de verdad y escribila acá. La app anota sola la diferencia como un ajuste, así el número queda bien y se sigue sumando desde ahí.</p>
  <form class="form" data-form="cash-correct">
    <div class="grid-2">
      <label>Según la app hay<input value="${fmtMoney(d.balance)}" disabled></label>
      <label>En realidad hay ($)<input type="number" name="real" step="1" value="${Math.round(d.balance)}" required></label>
    </div>
    <label>¿Por qué? (opcional)<input name="note" placeholder="Ej: CONTAMOS LA PLATA"></label>
    <div class="form-actions"><button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>
  </form>`);
});

onForm("cash-correct", async f => {
  const real = parseFloat(f.real);
  if (isNaN(real)) return toast("Escribí cuánta plata hay");
  const diff = Math.round(real - cashDetail(calcData()).balance);
  if (diff === 0) { closeSheet(); return toast("Ya estaba bien"); }
  const saved = must(await S.sb.from("cash_movements").insert({ kind: "AJUSTE", person: "", date: todayISO(), amount: diff, note: (f.note || "").trim().toUpperCase() || "CORRECCION DE SALDO" }).select().single());
  S.cash.push(map.cash(saved));
  closeSheet(); rerender(); scheduleBackup();
  toast(`Caja corregida a ${fmtMoney(real)}`);
});

onForm("cash-cut", async f => {
  if (!f.since) return toast("Elegí desde qué fecha contar");
  const initial = parseFloat(f.initial) || 0;
  must(await S.sb.from("settings").update({ cash_since: f.since, cash_initial: initial, updated_at: new Date().toISOString() }).eq("id", 1));
  S.settings.cashSince = f.since; S.settings.cashInitial = initial;
  rerender(); scheduleBackup();
  toast(`Listo. En la caja hay ${fmtMoney(cashDetail(calcData()).balance)}`);
});

// ---------- Socios ----------
function vPartners() {
  const data = calcData();
  const { rows, total } = periodSummary(data);
  const s = S.settings;
  const w1 = withdrawnTotal(S.cash, "J"), w2 = withdrawnTotal(S.cash, "M");
  const loans = pendingLoans(S.cash);
  const months = collectedByMonth(S.movements).slice(0, 12);
  return html`
  <p class="hint">Lo cobrado en cada período se reparte: ${s.partner1Name} ${s.partner1Pct}%, ${s.partner2Name} ${s.partner2Pct}% y el resto queda en la caja para reinvertir. Mientras haya un préstamo sin devolver, nadie cobra su %: la devolución se descuenta de lo cobrado antes de repartir.</p>
  <div class="stats">
    ${stat({ label: "Total cobrado", value: fmtMoney(total.collected), tone: "paid" })}
    ${stat({ label: `Total ${s.partner1Name} (${s.partner1Pct}%)`, value: fmtMoney(total.share1), tone: "p1", sub: w1 ? `ya retiró ${fmtMoney(w1)} · le queda ${fmtMoney(total.share1 - w1)}` : "" })}
    ${stat({ label: `Total ${s.partner2Name} (${s.partner2Pct}%)`, value: fmtMoney(total.share2), tone: "p2", sub: w2 ? `ya retiró ${fmtMoney(w2)} · le queda ${fmtMoney(total.share2 - w2)}` : "" })}
    ${stat({ label: "Plata en la caja hoy", value: fmtMoney(cashDetail(data).balance), sub: "real, ya descontado todo" })}
    ${totalPendingLoans(S.cash) > 0 ? stat({ label: "Préstamos a devolver", value: fmtMoney(totalPendingLoans(S.cash)), sub: loans.map(([q, v]) => q + ": " + fmtMoney(v)).join(" · "), tone: "owes" }) : ""}
  </div>
  <section class="card flush">
    <h2 class="h3 pad">Resumen por período</h2>
    <div class="table-wrap"><table class="grid-table">
      <thead><tr><th>Período</th><th>Desde</th><th class="num">Inversión</th><th class="num">Vendido</th><th class="num">Cobrado</th><th class="num">Devuelto</th><th class="num">${s.partner1Name}</th><th class="num">${s.partner2Name}</th><th class="num">Sobró</th></tr></thead>
      <tbody>
        ${rows.map(({ trip, st }) => html`<tr>
          <td><strong>${trip.name}</strong></td><td>${fmtDate(st.from)}</td>
          <td class="num">${trip.investment ? fmtMoney(trip.investment) : "—"}</td><td class="num">${fmtMoney(st.sold)}</td>
          <td class="num"><strong>${fmtMoney(st.collected)}</strong></td><td class="num">${st.returned ? fmtMoney(st.returned) : "—"}</td>
          <td class="num">${fmtMoney(st.share1)}</td><td class="num">${fmtMoney(st.share2)}</td><td class="num">${fmtMoney(st.box)}</td></tr>`)}
        <tr class="total"><td>Total</td><td></td><td class="num">${fmtMoney(total.investment)}</td><td class="num">${fmtMoney(total.sold)}</td>
          <td class="num">${fmtMoney(total.collected)}</td><td class="num">${fmtMoney(total.returned)}</td><td class="num">${fmtMoney(total.share1)}</td>
          <td class="num">${fmtMoney(total.share2)}</td><td class="num">${fmtMoney(total.box)}</td></tr>
      </tbody></table></div>
  </section>
  <section class="card flush">
    <h2 class="h3 pad">Cobrado por mes</h2>
    <div class="table-wrap"><table class="grid-table">
      <thead><tr><th>Mes</th><th class="num">Vendido</th><th class="num">Cobrado</th></tr></thead>
      <tbody>${months.map(m => html`<tr><td>${m.month.slice(5)}/${m.month.slice(2, 4)}</td><td class="num">${fmtMoney(m.sold)}</td><td class="num"><strong>${fmtMoney(m.collected)}</strong></td></tr>`)}</tbody>
    </table></div>
  </section>`;
}

// ---------- Viajes ----------
function vTrips() {
  const data = calcData();
  const vs = sortTrips(S.trips).reverse();
  return html`
  <p class="hint">Cada viaje marca el comienzo de un período nuevo. El resumen agrupa lo cobrado desde ese viaje hasta el siguiente. Si viajan a mitad de mes, no pasa nada: el corte es la fecha del viaje.</p>
  <div class="btn-row"><button class="btn primary" data-act="trip-new">Nuevo viaje / inversión</button></div>
  ${vs.map(v => {
    const st = tripStats(data, v);
    const balance = st.collected - v.investment;
    const w1 = withdrawnIn(S.cash, "J", st.from, st.to), w2 = withdrawnIn(S.cash, "M", st.from, st.to);
    return html`<section class="card trip">
      <header class="trip-head">
        <div><h2 class="h3">${icon("plane")} ${v.name}</h2><p class="small muted">desde ${fmtDate(st.from)}${st.to ? " hasta " + fmtDate(st.to) : " (período actual)"}</p></div>
        <button class="icon-btn" data-act="trip-edit" data-id="${v.id}" aria-label="Editar viaje">${icon("edit")}</button>
      </header>
      <div class="stats four">
        ${stat({ label: "Inversión", value: fmtMoney(v.investment) })}
        ${stat({ label: "Vendido", value: fmtMoney(st.sold) })}
        ${stat({ label: "Cobrado", value: fmtMoney(st.collected), sub: st.returned ? `− ${fmtMoney(st.returned)} devueltos = ${fmtMoney(st.base)} a repartir` : "", tone: "paid" })}
        ${stat({ label: "Cobrado − inversión", value: fmtMoney(balance), tone: balance >= 0 ? "paid" : "owes" })}
      </div>
      <p class="small">${st.movs} movimientos · ${S.settings.partner1Name}: <strong>${fmtMoney(st.share1)}</strong>${w1 ? ` (retiró ${fmtMoney(w1)})` : ""} · ${S.settings.partner2Name}: <strong>${fmtMoney(st.share2)}</strong>${w2 ? ` (retiró ${fmtMoney(w2)})` : ""} · Caja: <strong>${fmtMoney(st.box)}</strong></p>
    </section>`;
  })}
  ${!vs.length ? html`<section class="empty"><p>Todavía no hay viajes cargados.</p></section>` : ""}`;
}

function suggestTripName() {
  const months = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  const d = new Date();
  return months[d.getMonth()] + " " + d.getFullYear();
}

function tripSheet(id) {
  const v = id ? S.trips.find(x => x.id === id) : null;
  openSheet(html`
  <h2 class="display-m">${v ? "Editar viaje" : "Nuevo viaje / inversión"}</h2>
  <form class="form" data-form="trip-save">
    <input type="hidden" name="id" value="${v ? v.id : ""}">
    <label>Nombre del período<input name="name" required value="${v ? v.name : suggestTripName()}" placeholder="Ej: AGOSTO 2026"></label>
    <div class="grid-2">
      <label>Fecha del viaje (acá empieza el período)<input type="date" name="starts_on" required value="${v ? v.startsOn : todayISO()}"></label>
      <label>Cuánto invirtieron en mercadería ($)<input type="number" name="investment" min="0" step="1" value="${v ? v.investment : ""}" placeholder="0"></label>
    </div>
    <div class="form-actions">
      ${v ? html`<button type="button" class="btn danger-ghost" data-act="trip-delete" data-id="${v.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar</button>
    </div>
  </form>`);
}
onAction("trip-new", () => tripSheet());
onAction("trip-edit", d => tripSheet(d.id));

onForm("trip-save", async f => {
  const row = { name: norm(f.name), starts_on: f.starts_on, investment: parseFloat(f.investment) || 0 };
  if (!row.name || !row.starts_on) return toast("Completá nombre y fecha");
  const saved = must(f.id
    ? await S.sb.from("trips").update(row).eq("id", f.id).select().single()
    : await S.sb.from("trips").insert(row).select().single());
  upsertLocal(S.trips, map.trip(saved));
  closeSheet(); rerender(); scheduleBackup();
  toast("Viaje guardado");
});

onAction("trip-delete", async d => {
  if (!confirm("¿Borrar este viaje? Los movimientos no se borran, se agrupan en el período anterior.")) return;
  try { await deleteOne("trips", d.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.trips, d.id);
  closeSheet(); rerender(); scheduleBackup();
  toast("Viaje borrado");
});
