// Admin: "Pagos informados" (transfers reported by clients) and "Datos para transferencias".
// Confirming runs confirm_payment_request(): it creates the payment movement and marks the request, atomically.
import { html, onAction, onForm, openSheet, closeSheet, toast } from "../dom.js";
import { must } from "../supabase.js";
import { fmtMoney, fmtDateTime } from "../format.js";
import { pendingPayments } from "../calc.js";
import { S, map, clientName } from "./store.js";
import { rerender, renderShell } from "./app.js";
import { scheduleBackup } from "./sync.js";

export const mapRequest = r => ({
  id: r.id, clientId: r.client_id, amount: Number(r.amount), note: r.note || "", receiptPath: r.receipt_path,
  status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, movementId: r.movement_id
});

/** Loads all requests. Tolerates a database where the feature is not installed yet. */
export async function loadPaymentRequests() {
  try {
    const { data, error } = await S.sb.from("payment_requests").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    S.paymentRequests = data.map(mapRequest);
    S.paymentsReady = true;
  } catch (e) {
    console.warn("payment_requests not available", e);
    S.paymentRequests = [];
    S.paymentsReady = false;
  }
}

export const pendingInfo = () => pendingPayments(S.paymentRequests);
const pendingOf = clientId => S.paymentRequests.filter(r => r.status === "pending" && (clientId == null || r.clientId === clientId));

const STATUS = { pending: ["Pendiente", "neutral"], confirmed: ["Confirmado", "paid"], rejected: ["Rechazado", "owes"] };

/** One request row; `from` = client id when shown inside her drawer (to go back to it). */
export function requestRow(r, { withName = true, from = "" } = {}) {
  const [label, tone] = STATUS[r.status] || [r.status, ""];
  return html`<div class="pay-req">
    <div class="cred-row">
      <span>${withName ? html`<button class="link-btn inline" data-act="client-open" data-id="${r.clientId}">${clientName(r.clientId)}</button> · ` : ""}<strong>${fmtMoney(r.amount)}</strong></span>
      <span class="chip ${tone}">${label}</span>
    </div>
    <div class="small muted">Informado ${fmtDateTime(r.createdAt)}${r.resolvedAt ? " · resuelto " + fmtDateTime(r.resolvedAt) : ""}</div>
    ${r.note ? html`<p class="notes">${r.note}</p>` : ""}
    <div class="btn-row tight">
      ${r.receiptPath ? html`<button class="btn ghost sm" data-act="pr-receipt" data-id="${r.id}">Ver comprobante</button>` : html`<span class="small muted">Sin comprobante</span>`}
      ${r.status === "pending" ? html`
        <button class="btn pay sm" data-act="pr-confirm" data-id="${r.id}" data-from="${from}">Confirmar</button>
        <button class="btn danger-ghost sm" data-act="pr-reject" data-id="${r.id}" data-from="${from}">Rechazar</button>` : ""}
    </div>
  </div>`;
}

/** Card for Inicio (only when something is pending). */
export function paymentsHomeCard() {
  const p = pendingInfo();
  if (!p.count) return "";
  return html`<section class="card migrate-card">
    <h2 class="h3">Pagos informados <span class="count">${p.count}</span></h2>
    <p>${p.count === 1 ? "Una clienta avisó" : `${p.count} clientas avisaron`} que transfirió: <strong>${fmtMoney(p.total)}</strong> en total, esperando que lo confirmes.</p>
    <button class="btn primary" data-act="go" data-view="pagos">Revisar pagos</button>
  </section>`;
}

/** Pending requests inside the client drawer. */
export function drawerPayments(clientId) {
  const list = pendingOf(clientId);
  if (!list.length) return "";
  return html`<section class="card">
    <h3 class="h3">Pagos informados <span class="count">${list.length}</span></h3>
    ${list.map(r => requestRow(r, { withName: false, from: String(clientId) }))}
  </section>`;
}

export function vPayments() {
  const pending = pendingOf(null);
  const done = S.paymentRequests.filter(r => r.status !== "pending").slice(0, 30);
  return html`
  <header class="view-head"><h1 class="display-l">Pagos informados</h1></header>
  ${!S.paymentsReady ? html`<section class="empty"><p>Esta función todavía no está instalada en la base de datos.</p></section>` : ""}
  <p class="hint">Las clientas avisan acá cuando te transfieren. Revisá que la plata haya entrado y tocá <strong>Confirmar</strong>: se anota el pago solo. Si cambió el monto, lo corregís antes de confirmar.</p>
  <section class="card">
    <h2 class="h3">Pendientes <span class="count">${pending.length}</span></h2>
    ${pending.length ? pending.map(r => requestRow(r)) : html`<p class="muted">No hay pagos esperando confirmación.</p>`}
  </section>
  ${done.length ? html`<section class="card"><h2 class="h3">Últimos resueltos</h2>${done.map(r => requestRow(r))}</section>` : ""}
  <p class="small muted">Los datos de la cuenta que ven las clientas se cambian en Más → Datos para transferencias.</p>`;
}

const backTo = from => from ? {
  onClose: () => setTimeout(async () => { const { openClientDrawer } = await import("./clients.js"); openClientDrawer(Number(from)); })
} : {};

onAction("pr-receipt", async d => {
  const r = S.paymentRequests.find(x => x.id === d.id);
  if (!r || !r.receiptPath) return;
  const win = window.open("", "_blank"); // open now so popup blockers allow it
  const { data, error } = await S.sb.storage.from("receipts").createSignedUrl(r.receiptPath, 300);
  if (error || !data) {
    if (win) win.close();
    return toast("No pude abrir el comprobante: " + (error ? error.message : ""));
  }
  if (win) { win.opener = null; win.location.href = data.signedUrl; } else location.href = data.signedUrl;
});

onAction("pr-confirm", d => {
  const r = S.paymentRequests.find(x => x.id === d.id);
  if (!r) return;
  openSheet(html`
  <h2 class="display-m">Confirmar pago</h2>
  <p>${clientName(r.clientId)} informó <strong>${fmtMoney(r.amount)}</strong>.</p>
  <form class="form" data-form="pr-confirm">
    <input type="hidden" name="id" value="${r.id}">
    <label>Monto que entró de verdad ($)<input type="number" name="amount" min="1" step="0.01" required value="${r.amount}"></label>
    <p class="small muted">Se anota como pago de hoy con el detalle “Transferencia”.</p>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn pay" type="submit">Confirmar pago</button>
    </div>
  </form>`, backTo(d.from));
});

onForm("pr-confirm", async f => {
  const r = S.paymentRequests.find(x => x.id === f.id);
  const amount = Math.round(Number(f.amount) * 100) / 100;
  if (!r || !(amount > 0) || amount > 10000000) return toast("Poné un monto válido");
  const { data, error } = await S.sb.rpc("confirm_payment_request", { p_id: r.id, p_amount: amount });
  if (error) {
    return toast(/not_pending/.test(error.message) ? "Ese pago ya estaba resuelto" : "No se pudo confirmar: " + error.message);
  }
  const mov = map.movement(data);
  S.movements.push(mov);
  Object.assign(r, { status: "confirmed", resolvedAt: new Date().toISOString(), movementId: mov.id, amount });
  closeSheet();
  renderShell();
  scheduleBackup();
  toast(`Pago de ${fmtMoney(amount)} confirmado y anotado`);
});

onAction("pr-reject", async d => {
  const r = S.paymentRequests.find(x => x.id === d.id);
  if (!r) return;
  if (!confirm(`¿Rechazar el pago de ${fmtMoney(r.amount)} de ${clientName(r.clientId)}? No se anota nada en su cuenta.`)) return;
  const { error } = await S.sb.rpc("reject_payment_request", { p_id: r.id });
  if (error) return toast(/not_pending/.test(error.message) ? "Ese pago ya estaba resuelto" : "No se pudo rechazar: " + error.message);
  Object.assign(r, { status: "rejected", resolvedAt: new Date().toISOString() });
  renderShell();
  if (d.from) { const { openClientDrawer } = await import("./clients.js"); openClientDrawer(Number(d.from)); }
  toast("Pago rechazado");
});

// ---------- Más → Datos para transferencias ----------
export function paymentSettingsForm() {
  const s = S.settings;
  return html`<form class="card form" data-form="pay-settings">
    <h2 class="h3">Datos para transferencias</h2>
    <p class="hint">Es lo que ven las clientas cuando tocan “Pagar por transferencia”. Si dejás alias y CVU vacíos, el botón no aparece.</p>
    <div class="grid-2">
      <label>Alias<input name="alias" maxlength="60" value="${s.paymentAlias}" placeholder="Ej: valijapp.mp"></label>
      <label>CVU / CBU<input name="cvu" maxlength="30" inputmode="numeric" value="${s.paymentCvu}" placeholder="22 números"></label>
      <label>Titular<input name="holder" maxlength="100" value="${s.paymentHolder}" placeholder="Nombre y apellido"></label>
      <label>Banco o billetera (opcional)<input name="bank" maxlength="60" value="${s.paymentBank}" placeholder="Ej: Mercado Pago"></label>
    </div>
    <button class="btn ghost" type="submit">Guardar datos</button>
  </form>`;
}

onForm("pay-settings", async f => {
  const cvu = (f.cvu || "").replace(/\s+/g, "");
  if (cvu && !/^\d{22}$/.test(cvu)) return toast("El CVU/CBU tiene que tener 22 números");
  const row = {
    payment_alias: (f.alias || "").trim(), payment_cvu: cvu,
    payment_holder: (f.holder || "").trim(), payment_bank: (f.bank || "").trim(), updated_at: new Date().toISOString()
  };
  const saved = must(await S.sb.from("settings").update(row).eq("id", 1).select().single());
  S.settings = map.settings(saved);
  rerender();
  toast("Datos para transferencias guardados");
});
