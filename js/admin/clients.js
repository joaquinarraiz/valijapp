// Clientas: list, profile drawer, create/edit/delete. Login tools live in access.js.
import { html, mount, onAction, onForm, onInput, openSheet, closeSheet, toast, avatar, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must, avatarUrl } from "../supabase.js";
import { fmtMoney, fmtDate, waLink, waDigits } from "../format.js";
import { clientSummaries, daysSince } from "../calc.js";
import { norm } from "../legacy.js";
import { APP_URL } from "../config.js";
import { S, map, clientById, upsertLocal, removeLocal, deleteOne } from "./store.js";
import { rerender } from "./app.js";
import { movementRow, saleSheet, paymentSheet } from "./movements.js";
import { scheduleBackup } from "./sync.js";
import { stat } from "../ui.js";
import { accessBlock, hydrateAccess, passwordField, suggestPassword, createAccess, revokeAccess } from "./access.js";
import { drawerPayments } from "./payments.js";
import { exportButton } from "./export.js";

const CHIPS = [["todas", "Todas"], ["deben", "Deben"], ["aldia", "Al día"], ["inactivas", "Inactivas"], ["sinacceso", "Sin acceso"], ["conacceso", "Con acceso"]];
const SORTS = [["deuda", "Mayor deuda"], ["nombre", "Nombre (A-Z)"], ["numero", "N° de clienta"], ["reciente", "Última compra (reciente primero)"], ["compras", "Más compraron"]];
const PREFS_KEY = "valijapp_clients_view";

// remember sort + chip per device
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (CHIPS.some(([id]) => id === p.chip)) S.filters.clientChip = p.chip;
    if (SORTS.some(([id]) => id === p.sort)) S.filters.clientSort = p.sort;
  } catch { /* storage unavailable */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ chip: S.filters.clientChip, sort: S.filters.clientSort })); } catch { /* ignore */ }
}
loadPrefs();
if (!S.filters.clientSort) S.filters.clientSort = "deuda";

const byName = (a, b) => a.c.name.localeCompare(b.c.name, "es", { sensitivity: "base" });
const SORTERS = {
  deuda: (a, b) => b.s.debt - a.s.debt || byName(a, b),
  nombre: byName,
  numero: (a, b) => a.c.id - b.c.id,
  // clients without purchases go last
  reciente: (a, b) => (a.s.last ? 0 : 1) - (b.s.last ? 0 : 1) || (b.s.last || "").localeCompare(a.s.last || "") || byName(a, b),
  compras: (a, b) => b.s.bought - a.s.bought || byName(a, b)
};

function chipMatch(chip, c, s) {
  const days = Number(S.settings.inactiveDays) || 45; // same rule as the dashboard
  switch (chip) {
    case "deben": return s.debt > 0;
    case "aldia": return s.debt <= 0;
    case "inactivas": return !!s.last && daysSince(s.last) >= days;
    case "sinacceso": return !c.userId;
    case "conacceso": return !!c.userId;
    default: return true;
  }
}

export function rows() {
  const sums = clientSummaries(S.movements);
  const t = norm(S.filters.clientText);
  const digits = t.replace(/\D/g, "");
  return S.clients
    .map(c => ({ c, s: sums.get(c.id) || { debt: 0, bought: 0, last: null } }))
    .filter(({ c, s }) =>
      (!t || norm(c.name).includes(t) || norm(c.displayName).includes(t) || (digits && (c.phone || "").replace(/\D/g, "").includes(digits)) || norm(c.address).includes(t) || String(c.id) === t) &&
      chipMatch(S.filters.clientChip, c, s))
    .sort(SORTERS[S.filters.clientSort] || SORTERS.deuda);
}

const countText = n => n === S.clients.length ? String(n) : `${n} / ${S.clients.length}`;

function clientRow({ c, s }) {
  return html`<li><button class="row client-row" data-act="client-open" data-id="${c.id}">
    ${avatar(avatarUrl(S.sb, c.avatarPath), c.name)}
    <span class="row-main">
      <span class="row-title">${c.name}${c.userId ? html` <span class="dot-ok" title="Tiene acceso a la app"></span>` : ""}</span>
      <span class="row-sub">N° ${c.id}${c.displayName ? html` · “${c.displayName}”` : ""}${s.last ? html` · compró ${fmtDate(s.last)}` : ""}</span>
    </span>
    <span class="row-amounts">${s.debt > 0 ? html`<span class="amt owes">${fmtMoney(s.debt)}</span>` : s.debt < 0 ? html`<span class="amt credit">a favor ${fmtMoney(-s.debt)}</span>` : html`<span class="amt muted">al día</span>`}</span>
  </button></li>`;
}

export function vClients() {
  const list = rows();
  return html`
  <header class="view-head">
    <h1 class="display-l">Clientas <span class="count" id="clientCount">${countText(list.length)}</span></h1>
    <div class="head-actions">${exportButton("clientas")}<button class="btn primary" data-act="client-new">Nueva clienta</button></div>
  </header>
  <div class="toolbar">
    <label class="search">${icon("search")}<input type="search" placeholder="Nombre, teléfono, dirección o N°" value="${S.filters.clientText}" data-input="client-search" aria-label="Buscar clienta"></label>
    <select data-input="client-sort" aria-label="Ordenar">
      ${SORTS.map(([id, label]) => html`<option value="${id}" ${S.filters.clientSort === id ? "selected" : ""}>${label}</option>`)}
    </select>
  </div>
  <div class="chips" role="group" aria-label="Filtro">
    ${CHIPS.map(([id, label]) => html`<button class="filter-chip ${S.filters.clientChip === id ? "on" : ""}" data-act="client-chip" data-chip="${id}" aria-pressed="${S.filters.clientChip === id}">${label}</button>`)}
  </div>
  <ul class="rows card flush" id="clientList">${list.map(clientRow)}</ul>
  <section class="empty" id="clientEmpty" ${list.length ? "hidden" : ""}><p>No encontré clientas con ese filtro.</p></section>`;
}

function repaintList() {
  const list = rows();
  mount($("#clientList"), list.map(clientRow));
  $("#clientCount").textContent = countText(list.length);
  $("#clientEmpty").hidden = list.length > 0;
}

let t;
onInput("client-search", v => {
  S.filters.clientText = v;
  clearTimeout(t);
  t = setTimeout(repaintList, 100);
});
onAction("client-chip", d => { S.filters.clientChip = d.chip; savePrefs(); rerender(); });
onInput("client-sort", v => { S.filters.clientSort = v; savePrefs(); repaintList(); });
onAction("client-open", d => openClientDrawer(Number(d.id)));
onAction("client-new", () => clientFormSheet());

// ---------- drawer ----------
function greeting(c) {
  return c.displayName ? `¡Hola ${c.displayName}!` : "¡Hola!";
}
function reminderMessage(c, debt) {
  return `${greeting(c)} Te escribo de ValijApp 🧳 Tu saldo pendiente es de ${fmtMoney(debt)}. Podés ver el detalle cuando quieras en ${APP_URL}. ¡Gracias!`;
}

export function openClientDrawer(id) {
  const c = clientById(id);
  if (!c) return;
  const movs = S.movements.filter(m => m.clientId === id).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const s = clientSummaries(movs).get(id) || { debt: 0, bought: 0, last: null };
  const hasPhone = !!waDigits(c.phone);
  openSheet(html`
  <div class="drawer">
    <header class="drawer-head">
      ${avatar(avatarUrl(S.sb, c.avatarPath), c.name, "xl")}
      <div>
        <h2 class="display-m">${c.name}</h2>
        <p class="muted">N° ${c.id}${c.displayName ? html` · se hace llamar <strong>${c.displayName}</strong>` : ""}</p>
      </div>
    </header>
    <div class="stats three">
      ${stat({ label: "Debe", value: fmtMoney(s.debt), tone: s.debt > 0 ? "owes" : "paid" })}
      ${stat({ label: "Compró en total", value: fmtMoney(s.bought) })}
      ${stat({ label: "Última compra", value: s.last ? fmtDate(s.last) : "—", sub: s.last ? `hace ${daysSince(s.last)} días` : "" })}
    </div>
    <div class="btn-row">
      <button class="btn sale" data-act="drawer-sale" data-id="${c.id}">Anotar venta</button>
      <button class="btn pay" data-act="drawer-pay" data-id="${c.id}">Anotar pago</button>
      ${hasPhone ? html`<a class="btn whatsapp" href="${waLink(c.phone)}" target="_blank" rel="noopener">${icon("chat")} WhatsApp</a>` : ""}
      ${hasPhone && s.debt > 0 ? html`<a class="btn ghost" href="${waLink(c.phone, reminderMessage(c, s.debt))}" target="_blank" rel="noopener">Recordarle el saldo</a>` : ""}
      <button class="btn ghost" data-act="client-edit" data-id="${c.id}">${icon("edit")} Editar datos</button>
    </div>
    <section class="card contact">
      ${c.phone ? html`<a href="tel:${c.phone.replace(/[^\d+]/g, "")}">${icon("phone")} ${c.phone}</a>` : html`<span class="muted">${icon("phone")} Sin teléfono</span>`}
      ${c.address ? html`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon("pin")} ${c.address}</a>` : html`<span class="muted">${icon("pin")} Sin dirección</span>`}
      ${c.email ? html`<a href="mailto:${c.email}">${icon("mail")} ${c.email}</a>` : ""}
      ${c.notes ? html`<p class="notes">${c.notes}</p>` : ""}
    </section>
    ${drawerPayments(c.id)}
    ${accessBlock(c)}
    <section class="card flush">
      <h3 class="h3 pad">Estado de cuenta <span class="count">${movs.length}</span></h3>
      ${movs.length ? html`<ul class="rows">${movs.map(m => movementRow(m, false, String(c.id)))}</ul>` : html`<p class="muted pad">Sin movimientos todavía.</p>`}
    </section>
  </div>`, { wide: true });
  hydrateAccess(c);
}

onAction("drawer-sale", d => saleSheet(Number(d.id), d.id));
onAction("drawer-pay", d => paymentSheet(Number(d.id), d.id));
onAction("client-edit", d => clientFormSheet(Number(d.id)));

// ---------- create / edit ----------
const nextNumber = () => S.clients.reduce((a, c) => Math.max(a, c.id || 0), 0) + 1;

/** Creates a client with just a name (used by "Anotar venta" with a new name). */
export async function createClientNamed(name) {
  const row = must(await S.sb.from("clients_admin").insert({ name: norm(name) }).select().single());
  const c = map.client(row);
  S.clients.push(c);
  return c;
}

export function clientFormSheet(id = null) {
  const c = id ? clientById(id) : null;
  openSheet(html`
  <h2 class="display-m">${c ? "Editar clienta" : "Nueva clienta"}</h2>
  <form class="form" data-form="client-save">
    <input type="hidden" name="old_id" value="${c ? c.id : ""}">
    <div class="grid-2">
      <label>N°<input type="number" name="id" min="1" step="1" value="${c ? c.id : nextNumber()}" required></label>
      <label>Nombre (cómo la anotás vos)<input name="name" required maxlength="80" value="${c ? c.name : ""}" placeholder="Ej: MARIA JARDIN"></label>
      <label>Teléfono (con código de área)<input name="phone" type="tel" maxlength="30" value="${c ? c.phone : ""}" placeholder="Ej: 54 9 2235 12-3456"></label>
      <label>Dirección<input name="address" maxlength="120" value="${c ? c.address : ""}" placeholder="Ej: Colón 3450, dpto 2"></label>
      <label>Email<input name="email" type="email" maxlength="120" value="${c ? c.email : ""}"></label>
    </div>
    <label>Notas (solo las ves vos)<textarea name="notes" rows="2" maxlength="500">${c ? c.notes : ""}</textarea></label>
    ${c ? "" : html`<fieldset class="access-new">
      <legend>Acceso a la app</legend>
      <label class="check"><input type="checkbox" name="give_access" data-input="client-give-access"> Darle acceso ahora</label>
      <div id="newAccessPw" hidden>
        <label>Contraseña (su usuario va a ser el N°) ${passwordField({ value: suggestPassword(), required: false })}</label>
        <p class="small muted">Mínimo 8 caracteres. Después de guardar te muestro el botón para mandárselo por WhatsApp.</p>
      </div>
    </fieldset>`}
    ${c && c.displayName ? html`<p class="small muted">Ella se puso de nombre “${c.displayName}”. Eso no cambia cómo la ves vos.</p>` : ""}
    <div class="form-actions">
      ${c ? html`<button type="button" class="btn danger-ghost" data-act="client-delete" data-id="${c.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar</button>
    </div>
  </form>`, c ? {
    onClose: () => setTimeout(() => {
      const back = S.lastSavedClientId ?? c.id;
      S.lastSavedClientId = null;
      if (clientById(back)) openClientDrawer(back);
    })
  } : {});
}

onInput("client-give-access", (_v, el) => {
  const box = $("#newAccessPw");
  box.hidden = !el.checked;
  box.querySelector("[name=password]").required = el.checked;
});

onForm("client-save", async f => {
  const name = norm(f.name);
  const id = Number(f.id);
  const oldId = f.old_id ? Number(f.old_id) : null;
  if (!name) return toast("Falta el nombre");
  if (!id) return toast("Falta el número");
  if (S.clients.some(x => norm(x.name) === name && x.id !== oldId)) return toast("Ya existe una clienta con ese nombre");
  if (S.clients.some(x => x.id === id && x.id !== oldId)) return toast(`El N° ${id} ya es de otra clienta`);
  const giveAccess = !oldId && !!f.give_access;
  if (giveAccess && (f.password || "").length < 8) return toast("La contraseña tiene que tener al menos 8 caracteres");
  const patch = { id, name, phone: f.phone.trim() || null, address: f.address.trim() || null, email: f.email.trim() || null, notes: f.notes.trim() || null };
  let row;
  if (oldId) {
    row = must(await S.sb.from("clients_admin").update(patch).eq("id", oldId).select().single());
    if (oldId !== id) S.movements.forEach(m => { if (m.clientId === oldId) m.clientId = id; });
    removeLocal(S.clients, oldId);
  } else {
    row = must(await S.sb.from("clients_admin").insert(patch).select().single());
  }
  const c = map.client(row);
  upsertLocal(S.clients, c);
  S.lastSavedClientId = c.id;
  closeSheet(); rerender(); scheduleBackup();
  if (giveAccess) {
    // the client is already saved; access is a second step that may fail on its own
    try {
      await createAccess(c.id, f.password);
      toast("Clienta guardada y con acceso. Mandale los datos por WhatsApp.");
    } catch (e) {
      toast("La clienta se guardó, pero no se pudo crear el acceso: " + e.message);
    }
    rerender();
    openClientDrawer(c.id);
    return;
  }
  if (!oldId) openClientDrawer(c.id);
  toast("Clienta guardada");
});

onAction("client-delete", async d => {
  const c = clientById(d.id);
  const n = S.movements.filter(m => m.clientId === c.id).length;
  if (!confirm(`¿Borrar a ${c.name}?` + (n ? ` Tiene ${n} movimientos que también se borran.` : "") + (c.userId ? " También se le quita el acceso a la app." : ""))) return;
  if (c.userId) {
    try { await revokeAccess(c.id); } catch (e) { return toast("No se borró: no se pudo quitar su acceso (" + e.message + ")"); }
  }
  try { await deleteOne("clients_admin", c.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  S.movements = S.movements.filter(m => m.clientId !== c.id);
  removeLocal(S.clients, c.id);
  closeSheet(); rerender(); scheduleBackup();
  toast("Clienta borrada");
});
