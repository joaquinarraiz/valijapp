// "Ajustar lo que cobra": manual change of what a partner gets in a trip period (cash kind AJUSTE_SOCIO).
// It never moves the cash box; it only changes that partner's share (and the period's "sobró").
import { html, mount, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { fmtMoney } from "../format.js";
import { tripOfDate, tripStats, withdrawnIn, adjustmentForTarget, PARTNER_ADJUST, todayISO } from "../calc.js";
import { signedMoney } from "../partner-text.js";
import { S, map, calcData, partnerName, upsertLocal } from "./store.js";
import { rerender } from "./app.js";
import { scheduleBackup } from "./sync.js";

/** What a partner can still collect in the trip period of `date` (share incl. adjustments − withdrawals in the period). */
export function owedOn(date, person, excludeId = null) {
  const data = calcData();
  if (excludeId) data.cash = data.cash.filter(c => c.id !== excludeId);
  const trip = tripOfDate(data.trips, date);
  if (!trip) return null;
  const st = tripStats(data, trip);
  const share = person === "J" ? st.share1 : st.share2;
  return { trip, owed: share - withdrawnIn(data.cash, person, st.from, st.to) };
}

const isMissingMigration = e => /cash_movements_kind_check|partner_adjust|violates check constraint/i.test((e && e.message) || "");

export function adjustSheet(id = null) {
  const c = id ? S.cash.find(x => x.id === id) : null;
  const s = S.settings;
  openSheet(html`
  <h2 class="display-m">${c ? "Editar ajuste de socio" : "Ajustar lo que cobra"}</h2>
  <p class="hint">Cambia solo lo que le corresponde cobrar a cada uno en el viaje de esa fecha. La plata de la caja no se mueve.</p>
  <form class="form" data-form="adjust-save" id="adjustForm">
    <input type="hidden" name="id" value="${c ? c.id : ""}">
    <label>Socio
      <select name="who" data-input="adjust-preview">
        <option value="J" ${c && c.person === "J" ? "selected" : ""}>${s.partner1Name}</option>
        <option value="M" ${c && c.person === "M" ? "selected" : ""}>${s.partner2Name}</option>
        ${c ? "" : html`<option value="both">Aplicar a los dos</option>`}
      </select></label>
    <fieldset class="pay-amount">
      <legend>¿Cómo?</legend>
      <label class="check"><input type="radio" name="mode" value="target" ${c ? "" : "checked"} data-input="adjust-preview"> Que le quede por cobrar $…</label>
      <label class="check"><input type="radio" name="mode" value="delta" ${c ? "checked" : ""} data-input="adjust-preview"> Sumar o restar $… (con un menos adelante para restar)</label>
    </fieldset>
    <div class="grid-2">
      <label>Monto ($)<input type="number" name="amount" step="0.01" required value="${c ? c.amount : ""}" data-input="adjust-preview"></label>
      <label>Fecha<input type="date" name="date" required value="${c ? c.date : todayISO()}" data-input="adjust-preview"></label>
    </div>
    <label>Nota<input name="note" maxlength="120" value="${c ? c.note : "Ajuste manual"}"></label>
    <div id="adjustPreview" class="pay-box small"></div>
    <div class="form-actions">
      ${c ? html`<button type="button" class="btn danger-ghost" data-act="cash-delete" data-id="${c.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar ajuste</button>
    </div>
  </form>`);
  paintPreview();
}

/** Computes the rows to save: [{ person, delta, before, after, trip }] or an error string. */
function plan(f) {
  const amount = parseFloat(f.amount.value);
  const date = f.date.value;
  if (!date || isNaN(amount)) return "Completá monto y fecha";
  const people = f.who.value === "both" ? ["J", "M"] : [f.who.value];
  const editingId = f.id.value || null;
  const out = [];
  for (const person of people) {
    const cur = owedOn(date, person, editingId);
    if (!cur) return "No hay ningún viaje cargado para esa fecha";
    const delta = f.mode.value === "target" ? adjustmentForTarget(amount, cur.owed) : amount;
    out.push({ person, delta, before: cur.owed, after: cur.owed + delta, trip: cur.trip });
  }
  return out;
}

function paintPreview() {
  const f = $("#adjustForm");
  if (!f) return;
  const p = plan(f);
  mount($("#adjustPreview"), typeof p === "string"
    ? html`<p class="muted">${p}</p>`
    : p.map(x => html`<p><strong>${partnerName(x.person)}</strong>: por cobrar ${fmtMoney(x.before)} → <strong>${fmtMoney(x.after)}</strong>
        ${x.delta ? html`(ajuste ${signedMoney(x.delta)})` : html`<span class="muted">(sin cambios)</span>`}
        <span class="muted">· viaje ${x.trip.name}</span></p>`));
}
onInput("adjust-preview", paintPreview);

onForm("adjust-save", async (_f, form) => {
  const p = plan(form);
  if (typeof p === "string") return toast(p);
  const todo = p.filter(x => x.delta !== 0);
  if (!todo.length) return toast("No hay nada que ajustar");
  const note = (form.note.value || "").trim().toUpperCase() || "AJUSTE MANUAL";
  try {
    for (const x of todo) {
      const row = { kind: PARTNER_ADJUST, person: x.person, date: form.date.value, amount: x.delta, note };
      const { data, error } = form.id.value
        ? await S.sb.from("cash_movements").update(row).eq("id", form.id.value).select().single()
        : await S.sb.from("cash_movements").insert(row).select().single();
      if (error) throw error;
      upsertLocal(S.cash, map.cash(data));
    }
  } catch (e) {
    rerender();
    return toast(isMissingMigration(e) ? "Falta actualizar la base (migración de ajustes de socio)" : "No se pudo guardar: " + (e.message || e));
  }
  closeSheet(); rerender(); scheduleBackup();
  toast(todo.map(x => `${partnerName(x.person)}: por cobrar ${fmtMoney(x.after)}`).join(" · "));
});

onAction("adjust-new", () => adjustSheet());

