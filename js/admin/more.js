// Más: settings, places, Excel, Google Sheets backup, migration, JSON backup, logout.
import { html, mount, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must } from "../supabase.js";
import { fmtDate, fmtDateTime } from "../format.js";
import { todayISO } from "../calc.js";
import { LS_KEY, isLegacyState, toLegacyState, workbookToLegacy, norm } from "../legacy.js";
import { logout } from "../auth.js";
import { S, map, upsertLocal, removeLocal, deleteOne } from "./store.js";
import { rerender, renderShell } from "./app.js";
import { migrateLegacy } from "./migrate.js";
import { paymentSettingsForm, pendingInfo } from "./payments.js";
import { exportXlsx, loadXlsx } from "./xlsx.js";
import { askSheets, explainSheetsError, validSheetsUrl, pushBackup, scheduleBackup } from "./sync.js";

// ---------- legacy localStorage ----------
function readLegacyLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return isLegacyState(s) ? s : null;
  } catch { return null; }
}

/** Card offering to upload the v1 data found in this browser. */
export function migrationCard(onlyIfPending = false) {
  const legacy = readLegacyLocal();
  if (!legacy) return onlyIfPending ? "" : html`<p class="small muted">No hay datos de la versión anterior guardados en este navegador.</p>`;
  if (onlyIfPending && S.settings.legacyImportedAt) return "";
  return html`<section class="card migrate-card">
    <h2 class="h3">${icon("cloud")} Migrar mis datos a la nube</h2>
    <p>Este navegador tiene los datos de la ValijApp anterior: <strong>${legacy.clientas.length}</strong> clientas, <strong>${legacy.movimientos.length}</strong> movimientos, <strong>${(legacy.caja || []).length}</strong> movimientos de caja y <strong>${(legacy.viajes || []).length}</strong> viajes.</p>
    <p class="small muted">Se suben a Supabase sin duplicar nada (podés tocarlo varias veces). La copia de este navegador no se toca.</p>
    <button class="btn primary" data-act="migrate-local">Migrar mis datos a la nube</button>
  </section>`;
}

async function runMigration(legacy, label, opts = {}) {
  openSheet(html`<h2 class="display-m">${label}</h2><p id="migStep" class="muted">Preparando…</p>`);
  try {
    const { summary: sum, skipped } = await migrateLegacy(legacy, step => { const el = $("#migStep"); if (el) el.textContent = step; }, opts);
    openSheet(html`<h2 class="display-m">¡Listo!</h2>
      <ul class="summary">
        <li><strong>${sum.clients}</strong> clientas nuevas</li>
        <li><strong>${sum.movements}</strong> movimientos nuevos</li>
        <li><strong>${sum.trips}</strong> viajes nuevos</li>
        <li><strong>${sum.cash}</strong> movimientos de caja nuevos</li>
        <li><strong>${sum.places}</strong> lugares nuevos</li>
        ${sum.settings ? html`<li>Ajustes (socios, %, caja) copiados</li>` : ""}
        ${sum.skipped ? html`<li class="owes">${sum.skipped} filas no se pudieron subir</li>` : ""}
      </ul>
      ${skipped.length ? skippedList(skipped) : ""}
      <p class="small muted">Lo que ya estaba en la nube no se duplicó. Los datos de este navegador siguen intactos. Este informe queda guardado en Más → Ver informes de migración.</p>
      <button class="btn primary block" data-act="sheet-close">Ver mis datos</button>`, { onClose: () => renderShell() });
    scheduleBackup();
  } catch (e) {
    console.error(e);
    openSheet(html`<h2 class="display-m">No se pudo terminar</h2><p>${e.message || String(e)}</p>
      <p class="small muted">Lo que ya se subió quedó guardado. Podés volver a intentarlo: no se duplica nada.</p>
      <button class="btn primary block" data-act="sheet-close">Cerrar</button>`, { onClose: () => renderShell() });
  }
}

function rowText(row) {
  if (!row || typeof row !== "object") return String(row ?? "");
  const r = row;
  return [r.fecha || r.date, r.nombre || r.clientKey || r.name, r.tipo || r.kind, r.detalle || r.detail,
    r.total ?? "", r.pago ?? r.paid ?? "", r.monto ?? r.amount ?? ""].filter(x => x !== undefined && x !== null && x !== "").join(" · ");
}

function skippedList(skipped) {
  return html`<details class="guide" open><summary>${skipped.length} filas sin subir</summary>
    <ul class="rows small">${skipped.slice(0, 200).map(x => html`<li class="skip-row"><strong>${x.type}</strong>: ${x.reason}<br><span class="muted">${rowText(x.row)}</span></li>`)}</ul>
    ${skipped.length > 200 ? html`<p class="small muted">…y ${skipped.length - 200} más.</p>` : ""}
  </details>`;
}

const SOURCE_LABEL = { navegador: "Navegador", json: "Respaldo JSON", excel: "Excel", sheets: "Google Sheets" };

onAction("reports-open", async () => {
  openSheet(html`<h2 class="display-m">Informes de migración</h2><p class="muted">Cargando…</p>`, { wide: true });
  try {
    const list = must(await S.sb.from("migration_reports").select("*").order("created_at", { ascending: false }).limit(10));
    openSheet(html`<h2 class="display-m">Informes de migración</h2>
      ${list.length ? list.map(r => html`<section class="card">
        <h3 class="h3">${SOURCE_LABEL[r.source] || r.source} <span class="count">${fmtDateTime(r.created_at)}</span></h3>
        <p class="small">${r.summary.clients || 0} clientas · ${r.summary.movements || 0} movimientos · ${r.summary.trips || 0} viajes · ${r.summary.cash || 0} caja · ${r.summary.places || 0} lugares nuevos${r.summary.settings ? " · ajustes copiados" : ""}</p>
        ${(r.skipped || []).length ? skippedList(r.skipped) : html`<p class="small paid">Sin filas salteadas.</p>`}
      </section>`) : html`<p class="muted">Todavía no hay informes.</p>`}`, { wide: true });
  } catch (e) {
    openSheet(html`<h2 class="display-m">Informes de migración</h2><p>${e.message}</p>`);
  }
});

onAction("migrate-local", () => {
  const legacy = readLegacyLocal();
  if (legacy) runMigration(legacy, "Migrando tus datos…", { source: "navegador" });
});

// ---------- view ----------
export function vMore() {
  const s = S.settings;
  return html`
  <header class="view-head"><h1 class="display-l">Más</h1></header>
  <div class="tiles only-phone">
    <button class="tile" data-act="go" data-view="pagos">${icon("wallet")}<span>Pagos informados${pendingInfo().count ? html` <b class="badge static">${pendingInfo().count}</b>` : ""}</span></button>
    <button class="tile" data-act="go" data-view="cupones">${icon("ticket")}<span>Cupones</span></button>
    <button class="tile" data-act="go" data-view="difusiones">${icon("megaphone")}<span>Difusiones</span></button>
    <button class="tile" data-act="go" data-view="lugares">${icon("store")}<span>Lugares</span></button>
  </div>
  <button class="tile wide-tile not-phone" data-act="go" data-view="lugares">${icon("store")}<span>Lugares donde compramos (${S.places.length})</span>${icon("chevron")}</button>

  ${paymentSettingsForm()}

  <form class="card form" data-form="settings-save">
    <h2 class="h3">${icon("sliders")} Reparto de lo cobrado</h2>
    <p class="hint">El resto queda en la caja para reinvertir en el próximo viaje.</p>
    <div class="grid-2">
      <label>Socio 1<input name="p1n" value="${s.partner1Name}" required></label>
      <label>% para socio 1<input type="number" name="p1p" min="0" max="100" step="0.5" value="${s.partner1Pct}"></label>
      <label>Socio 2<input name="p2n" value="${s.partner2Name}" required></label>
      <label>% para socio 2<input type="number" name="p2p" min="0" max="100" step="0.5" value="${s.partner2Pct}"></label>
      <label>Días para “hace tiempo no compra”<input type="number" name="days" min="1" value="${s.inactiveDays}"></label>
    </div>
    <button class="btn ghost" type="submit">Guardar ajustes</button>
  </form>

  <section class="card">
    <h2 class="h3">${icon("download")} Excel</h2>
    <p class="hint">Descargá todo en el mismo formato de siempre (CLIENTES, CUENTA CORRIENTE, RESUMEN, VIAJES, LUGARES, CAJA). Si subís un Excel, se agrega lo que falte: no se borra ni se duplica nada.</p>
    <div class="btn-row">
      <button class="btn primary" data-act="xlsx-export">Descargar Excel con todo</button>
      <label class="btn ghost">Subir Excel<input type="file" accept=".xlsx,.xls" data-input="xlsx-import" hidden></label>
    </div>
  </section>

  <section class="card">
    <h2 class="h3">${icon("cloud")} Copia en Google Sheets</h2>
    <p class="hint">Si ya tenían la hoja de Google conectada, pegá la misma dirección: después de cada cambio se manda una copia completa. Los datos de verdad ahora viven en Supabase.</p>
    <form class="form" data-form="sheets-save">
      <label>Dirección del script de Google<input name="url" value="${s.sheetsUrl}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <div class="btn-row">
        <button class="btn ghost" type="submit">Conectar y probar</button>
        <button class="btn ghost" type="button" data-act="sheets-push" ${s.sheetsUrl ? "" : "disabled"}>Guardar copia ahora</button>
        <button class="btn ghost" type="button" data-act="sheets-pull" ${s.sheetsUrl ? "" : "disabled"}>Traer de la hoja</button>
      </div>
    </form>
    <details class="guide"><summary>Cómo conectar la hoja (una sola vez)</summary>
      <ol class="steps">
        <li>Entrá a sheets.google.com y creá una hoja nueva llamada <strong>ValijApp</strong>.</li>
        <li>Menú <strong>Extensiones → Apps Script</strong>.</li>
        <li>Pegá todo el contenido de <code>google/Code.gs</code> de la app anterior.</li>
        <li><strong>Implementar → Nueva implementación</strong> → tipo <strong>Aplicación web</strong> → “Quién tiene acceso”: <strong>Cualquier persona</strong>.</li>
        <li>Autorizá los permisos, copiá la URL que termina en <code>/exec</code> y pegala acá.</li>
      </ol>
    </details>
  </section>

  <section class="card">
    <h2 class="h3">${icon("upload")} Versión anterior y respaldos</h2>
    ${migrationCard(false)}
    <div class="btn-row">
      <label class="btn ghost">Importar respaldo (.json)<input type="file" accept=".json,application/json" data-input="json-import" hidden></label>
      <button class="btn ghost" data-act="json-export">Descargar respaldo (.json)</button>
      <button class="btn ghost" data-act="reports-open">Ver informes de migración</button>
    </div>
    <p class="small muted">${s.legacyImportedAt ? "Datos anteriores migrados el " + fmtDate(s.legacyImportedAt.slice(0, 10)) + "." : "Todavía no se migraron datos de la versión anterior."}</p>
  </section>

  <button class="btn danger-ghost block" data-act="admin-logout">${icon("logout")} Cerrar sesión</button>
  <p class="small muted center">ValijApp 🧳 hecha con cariño para ${s.partner1Name} y ${s.partner2Name}</p>`;
}

onAction("admin-logout", () => logout(S.sb));

onForm("settings-save", async f => {
  const p1 = parseFloat(f.p1p) || 0, p2 = parseFloat(f.p2p) || 0;
  if (p1 + p2 > 100) return toast("Los porcentajes suman más de 100");
  const row = {
    partner1_name: f.p1n.trim() || "JOACO", partner1_pct: p1, partner2_name: f.p2n.trim() || "ALE", partner2_pct: p2,
    inactive_days: parseInt(f.days) || 45, updated_at: new Date().toISOString()
  };
  const saved = must(await S.sb.from("settings").update(row).eq("id", 1).select().single());
  S.settings = map.settings(saved);
  rerender(); scheduleBackup();
  toast("Ajustes guardados");
});

// ---------- Excel ----------
onAction("xlsx-export", async () => {
  try { await exportXlsx(); toast("Excel descargado"); } catch (e) { toast("No pude armar el Excel: " + e.message); }
});

onInput("xlsx-import", async (_v, input) => {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const legacy = workbookToLegacy(XLSX, wb, { partner2Name: S.settings.partner2Name, fallbackTrips: S.trips });
    await runMigration(legacy, "Subiendo el Excel…", { applySettings: false, source: "excel" });
  } catch (e) {
    console.error(e);
    toast("No pude leer ese Excel: " + e.message);
  }
});

// ---------- JSON backup ----------
onAction("json-export", () => {
  const state = toLegacyState({ clients: S.clients, movements: S.movements, trips: S.trips, cash: S.cash, places: S.places, settings: S.settings });
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ValijApp respaldo ${fmtDate(todayISO()).replace(/\//g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

onInput("json-import", async (_v, input) => {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const legacy = isLegacyState(parsed) ? parsed : isLegacyState(parsed && parsed.datos) ? parsed.datos : null;
    if (!legacy) return toast("Ese archivo no es un respaldo de ValijApp");
    await runMigration(legacy, "Importando el respaldo…", { source: "json" });
  } catch (e) {
    toast("No pude leer el archivo: " + e.message);
  }
});

// ---------- Google Sheets ----------
onForm("sheets-save", async f => {
  const url = (f.url || "").trim();
  if (url) {
    const err = validSheetsUrl(url);
    if (err) return toast(err);
    try {
      const j = await askSheets(url + "?accion=probar");
      if (!j.ok) throw new Error(j.error || "error");
    } catch (e) { return alert(explainSheetsError(e)); }
  }
  must(await S.sb.from("settings").update({ sheets_url: url, updated_at: new Date().toISOString() }).eq("id", 1));
  S.settings.sheetsUrl = url;
  renderShell();
  if (!url) return toast("Copia en Sheets desactivada");
  try { await pushBackup(); toast("¡Conectado! La hoja ya tiene una copia de todo"); } catch (e) { alert(explainSheetsError(e)); }
});

onAction("sheets-push", async () => {
  try { await pushBackup(); toast("Copia guardada en tu hoja de Google"); } catch (e) { alert(explainSheetsError(e)); }
});

onAction("sheets-pull", async () => {
  try {
    const j = await askSheets(S.settings.sheetsUrl + "?accion=cargar");
    if (!j.ok) throw new Error(j.error || "error");
    if (!isLegacyState(j.datos)) return toast("La hoja está vacía todavía.");
    if (!confirm("Se agrega a la nube lo que esté en la hoja y falte acá. No se borra nada. ¿Seguimos?")) return;
    await runMigration(j.datos, "Trayendo de la hoja…", { source: "sheets" });
  } catch (e) { alert(explainSheetsError(e)); }
});

// ---------- Lugares ----------
export function vPlaces() {
  const t = norm(S.filters.placeText || "");
  const list = [...S.places]
    .filter(l => !t || norm([l.name, l.mall, l.aisle, l.stand, l.notes].join(" ")).includes(t))
    .sort((a, b) => (a.mall || "").localeCompare(b.mall || "") || (a.name || "").localeCompare(b.name || ""));
  return html`
  <header class="view-head">
    <h1 class="display-l">Lugares <span class="count">${S.places.length}</span></h1>
    <div class="head-actions"><button class="btn ghost" data-act="go" data-view="mas">Volver</button><button class="btn primary" data-act="place-new">Nuevo lugar</button></div>
  </header>
  <p class="hint">Los puestos que van descubriendo en La Salada (o donde sea) para encontrarlos rápido en el próximo viaje.</p>
  <div class="toolbar"><label class="search">${icon("search")}<input type="search" value="${S.filters.placeText || ""}" placeholder="Nombre, shopping, pasillo, qué venden…" data-input="place-search" aria-label="Buscar lugar"></label></div>
  <ul class="rows card flush" id="placeList">${list.map(l => html`<li><button class="row" data-act="place-edit" data-id="${l.id}">
    <span class="row-main"><span class="row-title">${l.name}</span>
      <span class="row-sub">${[l.mall, l.aisle, l.stand ? "stand " + l.stand : ""].filter(Boolean).join(" · ") || "—"}${l.notes ? " · " + l.notes : ""}</span></span>
    ${l.phone ? html`<span class="small muted">${l.phone}</span>` : ""}
  </button></li>`)}</ul>
  ${!list.length ? html`<section class="empty"><p>${S.places.length ? "No encontré lugares con esa búsqueda." : "Todavía no cargaste ningún lugar."}</p></section>` : ""}`;
}
let pt;
onInput("place-search", v => { S.filters.placeText = v; clearTimeout(pt); pt = setTimeout(() => { rerender(); const i = $("[data-input=place-search]"); i.focus(); i.setSelectionRange(v.length, v.length); }, 250); });

function placeSheet(id) {
  const l = id ? S.places.find(x => x.id === id) : null;
  openSheet(html`
  <h2 class="display-m">${l ? "Editar lugar" : "Nuevo lugar"}</h2>
  <form class="form" data-form="place-save">
    <input type="hidden" name="id" value="${l ? l.id : ""}">
    <div class="grid-2">
      <label>Nombre del puesto / local<input name="name" required value="${l ? l.name : ""}" placeholder="Ej: EL GALLEGO REMERAS"></label>
      <label>Shopping / feria<input name="mall" value="${l ? l.mall : ""}" placeholder="Ej: PUNTA MOGOTE"></label>
      <label>Pasillo<input name="aisle" value="${l ? l.aisle : ""}" placeholder="Ej: PASILLO 14"></label>
      <label>N° de stand<input name="stand" value="${l ? l.stand : ""}" placeholder="Ej: 235"></label>
      <label>Teléfono (opcional)<input name="phone" value="${l ? l.phone : ""}"></label>
      <label>Notas<input name="notes" value="${l ? l.notes : ""}" placeholder="Ej: JEANS BUENOS, ACEPTA TRANSFERENCIA"></label>
    </div>
    <div class="form-actions">
      ${l ? html`<button type="button" class="btn danger-ghost" data-act="place-delete" data-id="${l.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar</button>
    </div>
  </form>`);
}
onAction("place-new", () => placeSheet());
onAction("place-edit", d => placeSheet(d.id));
onForm("place-save", async f => {
  const row = { name: norm(f.name), mall: norm(f.mall), aisle: norm(f.aisle), stand: (f.stand || "").trim().toUpperCase(), phone: (f.phone || "").trim(), notes: (f.notes || "").trim().toUpperCase() };
  if (!row.name) return toast("Ponele un nombre al lugar");
  const saved = must(f.id ? await S.sb.from("places").update(row).eq("id", f.id).select().single() : await S.sb.from("places").insert(row).select().single());
  upsertLocal(S.places, map.place(saved));
  closeSheet(); rerender(); scheduleBackup();
  toast("Lugar guardado");
});
onAction("place-delete", async d => {
  if (!confirm("¿Borrar este lugar?")) return;
  try { await deleteOne("places", d.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.places, d.id);
  closeSheet(); rerender(); scheduleBackup();
  toast("Lugar borrado");
});

