// Movimientos: list (legacy "Cuenta corriente"), Anotar venta / pago, edit and delete.
import { html, mount, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must } from "../supabase.js";
import { fmtMoney, fmtDate } from "../format.js";
import { clientBalance, couponDiscount, couponIsValid, sortTrips, tripRange, todayISO } from "../calc.js";
import { norm } from "../legacy.js";
import { S, map, clientById, clientName, upsertLocal, removeLocal, deleteOne } from "./store.js";
import { clientPicker } from "./picker.js";
import { createClientNamed, openClientDrawer } from "./clients.js";
import { rerender } from "./app.js";
import { scheduleBackup } from "./sync.js";

// ---------- list ----------
function filtered() {
  let movs = [...S.movements].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const t = norm(S.filters.movText);
  if (t) movs = movs.filter(m => norm(clientName(m.clientId)).includes(t) || norm(m.detail).includes(t) || norm(clientById(m.clientId)?.displayName).includes(t));
  if (S.filters.movTrip) {
    const vs = sortTrips(S.trips);
    const v = vs.find(x => x.id === S.filters.movTrip);
    if (v) {
      const r = tripRange(S.trips, v);
      movs = movs.filter(m => m.date && (vs[0].id === v.id || m.date >= r.from) && (!r.to || m.date < r.to));
    }
  }
  return movs;
}

/** Child sheets opened from a client drawer go back to it when closed. */
const backTo = from => from ? { onClose: () => setTimeout(() => openClientDrawer(Number(from))) } : {};

export function movementRow(m, withName = true, from = "") {
  const owed = m.total - m.paid;
  const chip = owed > 0 ? html`<span class="chip owes">debe ${fmtMoney(owed)}</span>`
    : owed < 0 ? html`<span class="chip credit">a favor ${fmtMoney(-owed)}</span>`
      : html`<span class="chip paid">pagó</span>`;
  const coupon = m.couponId ? S.coupons.find(c => c.id === m.couponId) : null;
  return html`
  <li><button class="row" data-act="mov-edit" data-id="${m.id}" data-from="${from}">
    <span class="row-date">${fmtDate(m.date)}</span>
    <span class="row-main">
      ${withName ? html`<span class="row-title">${clientName(m.clientId)}</span>` : ""}
      <span class="row-sub">${m.total === 0 ? "Pago a cuenta" : m.detail || "Venta"}${m.discountAmount ? html` · <span class="chip coupon">${coupon ? coupon.code : "cupón"} −${fmtMoney(m.discountAmount)}</span>` : ""}</span>
    </span>
    <span class="row-amounts">
      ${m.total ? html`<span class="amt">${fmtMoney(m.total)}</span>` : ""}
      ${m.paid ? html`<span class="amt paid">+${fmtMoney(m.paid)}</span>` : ""}
      ${chip}
    </span>
  </button></li>`;
}

export function vMovements() {
  const movs = filtered();
  const visible = movs.slice(0, S.filters.movLimit);
  return html`
  <header class="view-head">
    <h1 class="display-l">Movimientos</h1>
    <div class="head-actions">
      <button class="btn sale" data-act="sale-new">Anotar venta</button>
      <button class="btn pay" data-act="pay-new">Anotar pago</button>
    </div>
  </header>
  <div class="toolbar">
    <label class="search">${icon("search")}<input type="search" placeholder="Buscar clienta o prenda" value="${S.filters.movText}" data-input="mov-search" aria-label="Buscar"></label>
    <select data-input="mov-trip" aria-label="Período">
      <option value="">Todos los períodos</option>
      ${sortTrips(S.trips).reverse().map(v => html`<option value="${v.id}" ${S.filters.movTrip === v.id ? "selected" : ""}>${v.name}</option>`)}
    </select>
  </div>
  <p class="small muted">${movs.length} movimientos</p>
  <ul class="rows card flush" id="movList">${visible.map(m => movementRow(m))}</ul>
  ${movs.length > S.filters.movLimit ? html`<button class="btn ghost block" data-act="mov-more">Ver más (${movs.length - S.filters.movLimit} restantes)</button>` : ""}
  ${!movs.length ? html`<section class="empty"><p>No hay movimientos con ese filtro.</p></section>` : ""}`;
}

let searchTimer;
onInput("mov-search", v => {
  S.filters.movText = v; S.filters.movLimit = 100;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const movs = filtered();
    mount($("#movList"), movs.slice(0, S.filters.movLimit).map(m => movementRow(m)));
  }, 120);
});
onInput("mov-trip", v => { S.filters.movTrip = v; S.filters.movLimit = 100; rerender(); });
onAction("mov-more", () => { S.filters.movLimit += 200; rerender(); });

// ---------- sale ----------
function couponsFor(clientId, date) {
  return S.coupons.filter(c => couponIsValid(c, { date, clientId, targets: S.couponTargets.get(c.id) || [] }));
}

export function saleSheet(clientId = null, from = "") {
  openSheet(html`
  <h2 class="display-m">Anotar venta</h2>
  <form class="form" data-form="sale-save" id="saleForm">
    ${clientPicker({ selectedId: clientId, allowNew: true })}
    <div class="grid-2">
      <label>Fecha<input type="date" name="date" value="${todayISO()}" required data-input="sale-recalc"></label>
      <label>Total ($)<input type="number" name="gross" min="0" step="1" inputmode="numeric" required placeholder="0" data-input="sale-recalc"></label>
    </div>
    <label>¿Qué llevó?<input name="detail" placeholder="Ej: 2 remeras, 1 jean" maxlength="200"></label>
    <div id="saleCoupon"></div>
    <label>Pagó ahora ($)<input type="number" name="paid" min="0" step="1" inputmode="numeric" placeholder="0 si queda todo debiendo"></label>
    <p class="small" id="saleInfo"></p>
    <div class="form-actions"><button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn sale" type="submit">Guardar venta</button></div>
  </form>`, backTo(from));
  $("#saleForm .picker").addEventListener("picked", saleRecalc);
  saleRecalc();
}

function saleRecalc() {
  const f = $("#saleForm");
  if (!f) return;
  const clientId = Number(f.client_id.value) || null;
  const date = f.date.value || todayISO();
  const list = couponsFor(clientId, date);
  const box = $("#saleCoupon");
  const current = f.coupon_id ? f.coupon_id.value : "";
  if (list.length) {
    mount(box, html`<label>Cupón
      <select name="coupon_id" data-input="sale-recalc">
        <option value="">Sin cupón</option>
        ${list.map(c => html`<option value="${c.id}" ${current === c.id ? "selected" : ""}>${c.code} · ${c.kind === "percent" ? c.value + "%" : fmtMoney(c.value)} — ${c.title}</option>`)}
      </select></label>`);
  } else mount(box, "");
  const gross = Number(f.gross.value) || 0;
  const coupon = f.coupon_id && f.coupon_id.value ? S.coupons.find(c => c.id === f.coupon_id.value) : null;
  const disc = couponDiscount(coupon, gross);
  const debt = clientId ? clientBalance(S.movements, clientId) : 0;
  mount($("#saleInfo"), html`
    ${disc ? html`Descuento <strong>−${fmtMoney(disc)}</strong> · total a cobrar <strong>${fmtMoney(gross - disc)}</strong><br>` : ""}
    ${clientId ? (debt > 0 ? html`Ya debía <strong class="owes">${fmtMoney(debt)}</strong>` : html`<span class="muted">No debía nada</span>`) : ""}`);
}
onInput("sale-recalc", saleRecalc);
onAction("sale-new", () => saleSheet());

async function resolveClient(f) {
  if (f.client_id) return Number(f.client_id);
  if (f.new_name) {
    const existing = S.clients.find(c => norm(c.name) === norm(f.new_name));
    if (existing) return existing.id;
    return (await createClientNamed(f.new_name)).id;
  }
  return null;
}

onForm("sale-save", async f => {
  const gross = Number(f.gross) || 0;
  const paid = Number(f.paid) || 0;
  if (!f.client_id && !f.new_name) return toast("Elegí la clienta");
  if (!f.date) return toast("Falta la fecha");
  if (gross <= 0) return toast("Poné el total de la venta");
  if (paid < 0) return toast("El pago no puede ser negativo");
  // validate the coupon BEFORE creating a new client, so a rejected sale leaves nothing behind
  const coupon = f.coupon_id ? S.coupons.find(c => c.id === f.coupon_id) : null;
  const knownId = f.client_id ? Number(f.client_id) : null;
  if (coupon && !couponIsValid(coupon, { date: f.date, clientId: knownId, targets: S.couponTargets.get(coupon.id) || [] })) return toast("Ese cupón no vale para esta clienta o fecha");
  const clientId = await resolveClient(f);
  const discount = couponDiscount(coupon, gross);
  const total = gross - discount;
  const row = must(await S.sb.from("movements").insert({
    client_id: clientId, date: f.date, detail: (f.detail || "").trim().toUpperCase(), total, paid,
    coupon_id: coupon ? coupon.id : null, discount_amount: discount
  }).select().single());
  S.movements.push(map.movement(row));
  closeSheet(); rerender(); scheduleBackup();
  toast(paid >= total ? "Venta anotada ¡y pagada!" : `Venta anotada. Queda debiendo ${fmtMoney(total - paid)}`);
});

// ---------- payment ----------
export function paymentSheet(clientId = null, from = "") {
  openSheet(html`
  <h2 class="display-m">Anotar pago</h2>
  <form class="form" data-form="pay-save" id="payForm">
    ${clientPicker({ selectedId: clientId })}
    <div class="grid-2">
      <label>Fecha<input type="date" name="date" value="${todayISO()}" required></label>
      <label>Cuánto pagó ($)<input type="number" name="amount" min="1" step="1" inputmode="numeric" required placeholder="0"></label>
    </div>
    <p class="small" id="payInfo"></p>
    <div class="form-actions"><button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn pay" type="submit">Guardar pago</button></div>
  </form>`, backTo(from));
  const upd = () => {
    const id = Number($("#payForm").client_id.value);
    const d = id ? clientBalance(S.movements, id) : null;
    mount($("#payInfo"), d === null ? "" : d > 0 ? html`Debe actualmente: <strong class="owes">${fmtMoney(d)}</strong>` : html`<span class="muted">No debe nada ✓</span>`);
  };
  $("#payForm .picker").addEventListener("picked", upd);
  upd();
}
onAction("pay-new", () => paymentSheet());

onForm("pay-save", async f => {
  const amount = Number(f.amount) || 0;
  if (!f.client_id || amount <= 0 || !f.date) return toast("Completá clienta, fecha y monto");
  const clientId = Number(f.client_id);
  const row = must(await S.sb.from("movements").insert({ client_id: clientId, date: f.date, detail: "A SU FAVOR", total: 0, paid: amount }).select().single());
  S.movements.push(map.movement(row));
  closeSheet(); rerender(); scheduleBackup();
  const d = clientBalance(S.movements, clientId);
  toast(d > 0 ? `Pago anotado. Sigue debiendo ${fmtMoney(d)}` : "Pago anotado. ¡Quedó al día!");
});

// ---------- edit / delete ----------
onAction("mov-edit", d => {
  const m = S.movements.find(x => x.id === d.id);
  if (!m) return;
  const coupon = m.couponId ? S.coupons.find(c => c.id === m.couponId) : null;
  openSheet(html`
  <h2 class="display-m">Editar movimiento</h2>
  <form class="form" data-form="mov-save">
    <input type="hidden" name="id" value="${m.id}">
    ${clientPicker({ selectedId: m.clientId })}
    <div class="grid-2">
      <label>Fecha<input type="date" name="date" value="${m.date}" required></label>
      <label>Detalle<input name="detail" value="${m.detail}" maxlength="200"></label>
      ${m.discountAmount || m.couponId
        ? html`<label>Total antes del cupón ($)<input type="number" name="gross" min="0" step="1" required value="${m.total + m.discountAmount}"></label>`
        : html`<label>Total ($)<input type="number" name="total" min="0" step="1" required value="${m.total}"></label>`}
      <label>Pagó ($)<input type="number" name="paid" min="0" step="1" required value="${m.paid}"></label>
    </div>
    ${m.discountAmount || m.couponId ? html`<p class="small muted">Tiene el cupón ${coupon ? coupon.code : "(borrado)"}: el descuento se vuelve a calcular con el total que pongas.</p>` : ""}
    <div class="form-actions">
      <button type="button" class="btn danger-ghost" data-act="mov-delete" data-id="${m.id}">${icon("trash")} Borrar</button>
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar</button>
    </div>
  </form>`, backTo(d.from));
});

onForm("mov-save", async f => {
  if (!f.client_id) return toast("Elegí la clienta");
  const m = S.movements.find(x => x.id === f.id);
  const paid = Number(f.paid) || 0;
  let total, discount = m.discountAmount;
  if ("gross" in f) {
    // coupon sale: recompute the discount from the new gross amount
    const gross = Number(f.gross) || 0;
    const coupon = m.couponId ? S.coupons.find(c => c.id === m.couponId) : null;
    discount = coupon ? couponDiscount(coupon, gross) : Math.min(m.discountAmount, gross);
    total = gross - discount;
  } else total = Number(f.total) || 0;
  if (total < 0 || paid < 0) return toast("Los montos no pueden ser negativos");
  const row = must(await S.sb.from("movements").update({
    client_id: Number(f.client_id), date: f.date, detail: (f.detail || "").toUpperCase(),
    total, paid, discount_amount: discount
  }).eq("id", f.id).select().single());
  upsertLocal(S.movements, map.movement(row));
  closeSheet(); rerender(); scheduleBackup();
  toast("Movimiento actualizado");
});

onAction("mov-delete", async d => {
  if (!confirm("¿Borrar este movimiento? No se puede deshacer.")) return;
  try {
    await deleteOne("movements", d.id);
  } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.movements, d.id);
  closeSheet(); rerender(); scheduleBackup();
  toast("Movimiento borrado");
});
