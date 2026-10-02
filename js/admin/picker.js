// Searchable client picker used in sale / payment / movement forms.
import { html, mount, onAction, onInput } from "../dom.js";
import { S, clientById } from "./store.js";
import { norm } from "../legacy.js";

/**
 * Renders the picker. On pick it fires a "picked" CustomEvent on the .picker element (detail = clientId | null).
 * allowNew: offers "Nueva clienta: <typed name>" (fills the hidden new_name field).
 */
export function clientPicker({ selectedId = null, allowNew = false } = {}) {
  const c = selectedId ? clientById(selectedId) : null;
  return html`
  <div class="picker" data-allow-new="${allowNew ? "1" : ""}">
    <label>Clienta
      <input type="search" class="picker-q" data-input="picker-q" autocomplete="off" placeholder="Buscá por nombre o número" value="${c ? c.name : ""}" ${selectedId ? "" : "autofocus"}>
    </label>
    <input type="hidden" name="client_id" value="${c ? c.id : ""}">
    <input type="hidden" name="new_name" value="">
    <div class="picker-list" role="listbox"></div>
  </div>`;
}

function matches(q) {
  const t = norm(q);
  if (!t) return [];
  const num = /^\d+$/.test(t) ? Number(t) : null;
  return S.clients
    .filter(c => (num !== null && c.id === num) || norm(c.name).includes(t) || norm(c.displayName).includes(t) || (c.phone || "").replace(/\D/g, "").includes(t))
    .sort((a, b) => (norm(a.name).startsWith(t) ? 0 : 1) - (norm(b.name).startsWith(t) ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

onInput("picker-q", (value, input) => {
  const picker = input.closest(".picker");
  picker.querySelector("[name=client_id]").value = "";
  picker.querySelector("[name=new_name]").value = "";
  const list = matches(value);
  const exact = S.clients.some(c => norm(c.name) === norm(value));
  const allowNew = picker.dataset.allowNew === "1" && norm(value) && !exact;
  mount(picker.querySelector(".picker-list"), html`
    ${list.map(c => html`<button type="button" role="option" class="picker-opt" data-act="picker-pick" data-id="${c.id}">
      <span>${c.name}${c.displayName ? html` <small class="muted">· ${c.displayName}</small>` : ""}</span><small class="muted">N° ${c.id}</small></button>`)}
    ${allowNew ? html`<button type="button" class="picker-opt new" data-act="picker-new">+ Nueva clienta: <strong>${norm(value)}</strong></button>` : ""}`);
  picker.dispatchEvent(new CustomEvent("picked", { detail: null }));
});

onAction("picker-pick", (d, el) => {
  const picker = el.closest(".picker");
  const c = clientById(d.id);
  picker.querySelector("[name=client_id]").value = c.id;
  picker.querySelector(".picker-q").value = c.name;
  mount(picker.querySelector(".picker-list"), "");
  picker.dispatchEvent(new CustomEvent("picked", { detail: c.id }));
});

onAction("picker-new", (d, el) => {
  const picker = el.closest(".picker");
  const q = picker.querySelector(".picker-q");
  q.value = norm(q.value);
  picker.querySelector("[name=new_name]").value = q.value;
  mount(picker.querySelector(".picker-list"), html`<p class="small muted">Se va a crear la clienta <strong>${q.value}</strong> al guardar.</p>`);
  picker.dispatchEvent(new CustomEvent("picked", { detail: null }));
});
