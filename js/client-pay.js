// Client app: "Pagar por transferencia". The client transfers from her own bank app and reports it here;
// the admin confirms it (that creates the payment movement). Pending reports never change the balance.
import { html, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "./dom.js";
import { must } from "./supabase.js";
import { fmtMoney, fmtDate } from "./format.js";
import { pendingPayments, balanceWithPending, validTransferAmount } from "./calc.js";
import { icon } from "./icons.js";
import { SUPPORT_WA, waTo } from "./contact.js";

const MAX_FILE = 3 * 1024 * 1024;
const REQUEST_COLS = "id, amount, note, receipt_path, status, created_at, resolved_at";

let C = null; // { S: () => state, balance: () => number, render: () => void, resizeImage }
export function initPay(ctx) { C = ctx; }

/** Payment info + this client's requests. Never breaks the app if the feature is not set up yet. */
export async function loadPayments(sb, clientId) {
  try {
    const [info, reqs] = await Promise.all([
      sb.rpc("get_payment_info"),
      sb.from("payment_requests").select(REQUEST_COLS).eq("client_id", clientId).order("created_at", { ascending: false })
    ]);
    return { payInfo: must(info), requests: must(reqs) };
  } catch (e) {
    console.warn("transfers not available", e);
    return { payInfo: null, requests: [] };
  }
}

const configured = info => !!info && !!(info.alias || info.cvu);

/** Primary button under the balance (only with payment info set and something to pay). */
export function payButton() {
  if (!configured(C.S().payInfo) || C.balance() <= 0) return "";
  return html`<button class="btn primary support-btn" data-act="pay-open">${icon("wallet")} Pagar por transferencia</button>`;
}

/** "Saldo con pagos informados" — info only, the real balance ignores pending reports. */
export function pendingNote() {
  const reqs = C.S().requests;
  const p = pendingPayments(reqs);
  if (!p.count) return "";
  return html`<p class="small muted pending-note">Saldo con pagos informados: <strong>${fmtMoney(balanceWithPending(C.balance(), reqs))}</strong>
    · ${p.count} ${p.count === 1 ? "pago pendiente" : "pagos pendientes"} de confirmación</p>`;
}

const STATUS = {
  pending: ["Pago informado · pendiente de confirmación", "neutral"],
  confirmed: ["Pago acreditado", "paid"],
  rejected: ["Pago no acreditado", "owes"]
};

export function requestsCard() {
  const reqs = C.S().requests.slice(0, 10);
  if (!reqs.length) return "";
  return html`<section class="card">
    <h2 class="h3">Pagos informados</h2>
    <ul class="rows">${reqs.map(r => {
      const [label, tone] = STATUS[r.status] || [r.status, ""];
      return html`<li class="row">
        <div class="row-main">
          <div class="row-title"><span class="chip ${tone}">${label}</span></div>
          <div class="row-sub">${fmtDate(String(r.created_at).slice(0, 10))}${r.note ? " · " + r.note : ""}</div>
        </div>
        <div class="row-amounts">
          <div class="amt ${r.status === "confirmed" ? "paid" : ""}">${fmtMoney(r.amount)}</div>
          ${r.status === "pending" ? html`<button class="btn ghost sm" data-act="pay-cancel" data-id="${r.id}">Cancelar</button>` : ""}
        </div>
      </li>`;
    })}</ul>
  </section>`;
}

// ---------- the sheet ----------
function chosenAmount(form) {
  const b = C.balance();
  return form.choice.value === "other" ? validTransferAmount(form.other.value, b) : validTransferAmount(b, b);
}

function paintAmount() {
  const form = $("#payForm");
  if (!form) return;
  const other = form.choice.value === "other";
  form.other.hidden = !other;
  form.other.required = other;
  const a = chosenAmount(form);
  $("#payAmountText").textContent = a ? fmtMoney(a) : "—";
  $("#payAmountCopy").dataset.value = a ? String(a) : "";
}

onAction("pay-open", () => {
  const b = C.balance();
  const i = C.S().payInfo || {};
  // only what she has to paste in her bank app gets a "Copiar" button
  const row = (label, value, copy = true) => value ? html`<div class="pay-row">
      <span class="muted small">${label}</span><strong>${value}</strong>
      ${copy ? html`<button type="button" class="btn ghost sm" data-act="pay-copy" data-value="${value}">Copiar</button>` : html`<span></span>`}</div>` : "";
  openSheet(html`
  <h2 class="display-m">Pagar por transferencia</h2>
  <form class="form" data-form="pay-send" id="payForm">
    <fieldset class="pay-amount">
      <legend>¿Cuánto vas a transferir?</legend>
      <label class="check"><input type="radio" name="choice" value="all" checked data-input="pay-choice"> Todo mi saldo (${fmtMoney(b)})</label>
      <label class="check"><input type="radio" name="choice" value="other" data-input="pay-choice"> Otro monto</label>
      <input type="number" name="other" min="1" max="${b}" step="1" inputmode="numeric" placeholder="¿Cuánto?" hidden data-input="pay-other" aria-label="Otro monto">
    </fieldset>
    <section class="pay-box">
      ${row("Alias", i.alias)}${row("CVU", i.cvu)}${row("Titular", i.holder, false)}${row("Banco", i.bank, false)}
      <div class="pay-row"><span class="muted small">Monto</span><strong id="payAmountText">${fmtMoney(b)}</strong>
        <button type="button" class="btn ghost sm" data-act="pay-copy" data-value="${String(b)}" id="payAmountCopy">Copiar</button></div>
    </section>
    <p class="small">Hacé la transferencia desde tu banco o billetera y después tocá «Ya transferí».</p>
    <label>Adjuntar comprobante (opcional)<input type="file" name="receipt" accept="image/*,application/pdf"></label>
    <label>Nota (opcional)<input name="note" maxlength="200" placeholder="Ej: transferí desde la cuenta de mi hermana"></label>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Ya transferí</button>
    </div>
  </form>`);
});

onInput("pay-choice", paintAmount);
onInput("pay-other", paintAmount);

onAction("pay-copy", async d => {
  if (!d.value) return toast("Elegí primero el monto");
  try { await navigator.clipboard.writeText(d.value); toast("Copiado"); } catch { toast(d.value); }
});

/** Receipt -> { blob, ext, type } (images become a JPEG of at most 1600px; PDFs up to 3 MB). */
async function prepareReceipt(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_FILE) throw new Error("El PDF pesa más de 3 MB");
    return { blob: file, ext: "pdf", type: "application/pdf" };
  }
  let blob;
  try { blob = await C.resizeImage(file, 1600); } catch { throw new Error("No pude leer la imagen del comprobante"); }
  if (blob.size > MAX_FILE) throw new Error("La imagen pesa más de 3 MB");
  return { blob, ext: "jpg", type: "image/jpeg" };
}

onForm("pay-send", async (f, form) => {
  const S = C.S();
  const amount = chosenAmount(form);
  if (!amount) return toast(`Poné un monto mayor a $0 y hasta ${fmtMoney(C.balance())}`);
  let receipt_path = null, shareFile = null;
  const file = f.receipt && f.receipt.size ? f.receipt : null;
  if (file) {
    let r;
    try { r = await prepareReceipt(file); } catch (e) { return toast(e.message); }
    shareFile = new File([r.blob], `comprobante-valijapp.${r.ext}`, { type: r.type });
    const path = `${S.userId}/receipt-${Date.now()}.${r.ext}`;
    const up = await S.sb.storage.from("receipts").upload(path, r.blob, { contentType: r.type, upsert: false });
    if (up.error) return toast("No se pudo subir el comprobante: " + up.error.message);
    receipt_path = path;
  }
  const note = (f.note || "").trim().slice(0, 200) || null;
  const { data, error } = await S.sb.from("payment_requests")
    .insert({ client_id: S.clientId, amount, note, receipt_path }).select(REQUEST_COLS).single();
  if (error) {
    // don't leave an orphan receipt behind (errors ignored: the report failing is what matters)
    if (receipt_path) await S.sb.storage.from("receipts").remove([receipt_path]).catch(() => {});
    if (/too_many_pending/.test(error.message)) return toast("Ya tenés 5 pagos esperando confirmación. Esperá a que los revisemos.");
    return toast("No se pudo informar el pago: " + error.message);
  }
  S.requests.unshift(data);
  C.render();
  showSent(amount, shareFile);
});

// ---------- after reporting: send the receipt by WhatsApp without digging through the gallery ----------
let pendingShare = null;

function showSent(amount, file) {
  const S = C.S();
  const who = S.me.display_name ? `${S.me.display_name} (clienta N° ${S.clientId})` : `la clienta N° ${S.clientId}`;
  const text = `Hola! Soy ${who}. Te transferí ${fmtMoney(amount)} desde ValijApp.` + (file ? " Te mando el comprobante." : "");
  // Web Share with files works on Android Chrome and iPhone Safari; desktop falls back to a plain wa.me link
  const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  pendingShare = canShareFile ? { file, text } : null;
  openSheet(html`
  <h2 class="display-m">¡Listo!</h2>
  <p>Te avisamos cuando se acredite.</p>
  ${canShareFile
    ? html`<button type="button" class="btn whatsapp block" data-act="pay-share">${icon("chat")} Mandar comprobante por WhatsApp</button>
      <p class="muted small">Se abre «Compartir»: elegí WhatsApp y el chat de ValijApp.</p>`
    : html`<a class="btn whatsapp block" href="${waTo(SUPPORT_WA, text)}" target="_blank" rel="noopener">${icon("chat")} Avisar por WhatsApp</a>`}
  <button type="button" class="btn ghost block" data-act="sheet-close">Cerrar</button>`);
}

onAction("pay-share", async () => {
  if (!pendingShare) return;
  try {
    await navigator.share({ files: [pendingShare.file], text: pendingShare.text });
    closeSheet();
  } catch (e) {
    if (e && e.name !== "AbortError") toast("No se pudo abrir «Compartir». Mandalo desde «Consultas y pagos».");
  }
});

onAction("pay-cancel", async d => {
  if (!confirm("¿Cancelar este pago informado?")) return;
  const S = C.S();
  const { data, error } = await S.sb.from("payment_requests").delete().eq("id", d.id).select("id");
  if (error || !data || data.length !== 1) return toast("No se pudo cancelar (¿ya lo confirmaron?)");
  const req = S.requests.find(r => r.id === d.id);
  if (req && req.receipt_path) await S.sb.storage.from("receipts").remove([req.receipt_path]).catch(() => {});
  S.requests = S.requests.filter(r => r.id !== d.id);
  toast("Pago informado cancelado");
  C.render();
});

