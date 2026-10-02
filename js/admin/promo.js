// Cupones and Difusiones.
import { html, mount, onAction, onForm, onInput, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must } from "../supabase.js";
import { fmtMoney, fmtDate, fmtDateTime } from "../format.js";
import { todayISO } from "../calc.js";
import { norm } from "../legacy.js";
import { S, map, clientById, upsertLocal, removeLocal, deleteOne } from "./store.js";
import { rerender } from "./app.js";

// =================== Coupons ===================
function couponStatus(c) {
  const today = todayISO();
  if (!c.active) return ["Pausado", "neutral"];
  if (c.endsOn && today > c.endsOn) return ["Vencido", "owes"];
  if (c.startsOn && today < c.startsOn) return ["Programado", "credit"];
  return ["Activo", "paid"];
}
const valueText = c => c.kind === "percent" ? `${c.value}%` : fmtMoney(c.value);

export function vCoupons() {
  const list = [...S.coupons].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return html`
  <header class="view-head">
    <h1 class="display-l">Cupones</h1>
    <div class="head-actions"><button class="btn primary" data-act="coupon-new">Nuevo cupón</button></div>
  </header>
  <p class="hint">Las clientas ven sus cupones en la app. Cuando te muestran el código, lo elegís al anotar la venta y el descuento se calcula solo.</p>
  ${list.length ? html`<div class="coupon-grid">${list.map(c => {
    const [label, tone] = couponStatus(c);
    const uses = S.movements.filter(m => m.couponId === c.id);
    const targets = S.couponTargets.get(c.id) || [];
    return html`<article class="coupon admin">
      <div class="coupon-top"><span class="chip ${tone}">${label}</span><span class="coupon-value">${valueText(c)}</span></div>
      <div class="coupon-title">${c.title}</div>
      <div class="coupon-foot"><span class="coupon-code">${c.code}</span>
        <span class="small muted">${c.startsOn ? fmtDate(c.startsOn) : "ya"} → ${c.endsOn ? fmtDate(c.endsOn) : "sin fin"}</span></div>
      <p class="small muted">${c.allClients ? "Para todas" : `Para ${targets.length} clienta${targets.length === 1 ? "" : "s"}`} · usado ${uses.length} ${uses.length === 1 ? "vez" : "veces"}${uses.length ? ` (−${fmtMoney(uses.reduce((a, m) => a + m.discountAmount, 0))})` : ""}</p>
      <div class="btn-row">
        <button class="btn ghost sm" data-act="coupon-toggle" data-id="${c.id}">${c.active ? "Pausar" : "Activar"}</button>
        <button class="btn ghost sm" data-act="coupon-edit" data-id="${c.id}">${icon("edit")} Editar</button>
      </div>
    </article>`;
  })}</div>` : html`<section class="empty"><p>Todavía no hay cupones.</p><button class="btn primary" data-act="coupon-new">Crear el primero</button></section>`}`;
}

function targetChips(ids) {
  return ids.map(id => {
    const c = clientById(id);
    return html`<button type="button" class="chip removable" data-act="ms-toggle" data-id="${id}">${c ? c.name : "N° " + id} ✕</button>`;
  });
}

function couponSheet(id) {
  const c = id ? S.coupons.find(x => x.id === id) : null;
  const targets = c ? [...(S.couponTargets.get(c.id) || [])] : [];
  openSheet(html`
  <h2 class="display-m">${c ? "Editar cupón" : "Nuevo cupón"}</h2>
  <form class="form" data-form="coupon-save" id="couponForm">
    <input type="hidden" name="id" value="${c ? c.id : ""}">
    <div class="grid-2">
      <label>Código<input name="code" required maxlength="24" pattern="[A-Za-z0-9_-]+" value="${c ? c.code : ""}" placeholder="Ej: PRIMAVERA10" style="text-transform:uppercase"></label>
      <label>Título<input name="title" required maxlength="80" value="${c ? c.title : ""}" placeholder="Ej: 10% en tu próxima compra"></label>
      <label>Tipo<select name="kind"><option value="percent" ${c && c.kind === "percent" ? "selected" : ""}>Porcentaje (%)</option><option value="fixed" ${c && c.kind === "fixed" ? "selected" : ""}>Monto fijo ($)</option></select></label>
      <label>Valor<input type="number" name="value" min="0" step="1" required value="${c ? c.value : ""}" placeholder="Ej: 10"></label>
      <label>Desde<input type="date" name="starts_on" value="${c ? c.startsOn || "" : todayISO()}"></label>
      <label>Hasta<input type="date" name="ends_on" value="${c ? c.endsOn || "" : ""}"></label>
    </div>
    <label class="check"><input type="checkbox" name="all_clients" ${!c || c.allClients ? "checked" : ""} data-input="coupon-all"> Para todas las clientas</label>
    <div class="multi" id="couponTargets" ${!c || c.allClients ? "hidden" : ""}>
      <input type="hidden" name="targets" value="${targets.join(",")}">
      <div class="multi-chips">${targetChips(targets)}</div>
      <label class="search">${icon("search")}<input type="search" placeholder="Agregar clienta…" data-input="ms-q" autocomplete="off" aria-label="Buscar clienta"></label>
      <div class="picker-list" id="msList"></div>
    </div>
    <label class="check"><input type="checkbox" name="active" ${!c || c.active ? "checked" : ""}> Activo</label>
    <div class="form-actions">
      ${c ? html`<button type="button" class="btn danger-ghost" data-act="coupon-delete" data-id="${c.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">Guardar cupón</button>
    </div>
  </form>`);
}
onAction("coupon-new", () => couponSheet());
onAction("coupon-edit", d => couponSheet(d.id));
onInput("coupon-all", (_v, el) => { $("#couponTargets").hidden = el.checked; });

function currentTargets() {
  const v = $("#couponForm").targets.value;
  return v ? v.split(",").map(Number) : [];
}
function paintTargets(ids) {
  $("#couponForm").targets.value = ids.join(",");
  mount($("#couponForm .multi-chips"), targetChips(ids));
}
onInput("ms-q", v => {
  const t = norm(v);
  const sel = new Set(currentTargets());
  const list = t ? S.clients.filter(c => !sel.has(c.id) && (norm(c.name).includes(t) || String(c.id) === t || norm(c.displayName).includes(t))).slice(0, 8) : [];
  mount($("#msList"), list.map(c => html`<button type="button" class="picker-opt" data-act="ms-toggle" data-id="${c.id}"><span>${c.name}</span><small class="muted">N° ${c.id}</small></button>`));
});
onAction("ms-toggle", d => {
  const id = Number(d.id);
  const ids = currentTargets();
  paintTargets(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const q = $("#couponForm [data-input=ms-q]");
  q.value = ""; mount($("#msList"), ""); q.focus();
});

onForm("coupon-save", async f => {
  const row = {
    code: (f.code || "").trim().toUpperCase().replace(/\s+/g, ""), title: f.title.trim(), kind: f.kind,
    value: Math.max(0, parseFloat(f.value) || 0), starts_on: f.starts_on || null, ends_on: f.ends_on || null,
    all_clients: !!f.all_clients, active: !!f.active
  };
  if (!row.code || !row.title) return toast("Completá código y título");
  if (row.kind === "percent" && row.value > 100) return toast("El porcentaje no puede pasar de 100");
  if (row.starts_on && row.ends_on && row.ends_on < row.starts_on) return toast("La fecha “hasta” es anterior a “desde”");
  const targets = f.targets ? f.targets.split(",").map(Number) : [];
  if (!row.all_clients && !targets.length) return toast("Elegí al menos una clienta o marcá “Para todas”");
  let saved;
  try {
    saved = must(f.id
      ? await S.sb.from("coupons").update(row).eq("id", f.id).select().single()
      : await S.sb.from("coupons").insert(row).select().single());
  } catch (e) {
    return toast(/duplicate|unique/i.test(e.message) ? "Ya existe un cupón con ese código" : "No se pudo guardar: " + e.message);
  }
  const coupon = map.coupon(saved);
  // one RPC = one transaction: the target list is replaced atomically
  try {
    must(await S.sb.rpc("set_coupon_targets", { p_coupon_id: coupon.id, p_client_ids: row.all_clients ? [] : targets }));
  } catch (e) {
    upsertLocal(S.coupons, coupon);
    return toast("El cupón se guardó pero no las clientas elegidas: " + e.message);
  }
  S.couponTargets.set(coupon.id, row.all_clients ? [] : targets);
  upsertLocal(S.coupons, coupon);
  closeSheet(); rerender();
  toast("Cupón guardado");
});

onAction("coupon-toggle", async d => {
  const c = S.coupons.find(x => x.id === d.id);
  try { must(await S.sb.from("coupons").update({ active: !c.active }).eq("id", c.id)); } catch (e) { return toast("No se pudo cambiar: " + e.message); }
  c.active = !c.active;
  rerender();
  toast(c.active ? "Cupón activado" : "Cupón pausado");
});

onAction("coupon-delete", async d => {
  const used = S.movements.filter(m => m.couponId === d.id).length;
  if (!confirm(used ? `Este cupón se usó ${used} veces. Las ventas quedan con su descuento pero sin el cupón. ¿Borrarlo igual?` : "¿Borrar este cupón?")) return;
  try { await deleteOne("coupons", d.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.coupons, d.id);
  S.movements.forEach(m => { if (m.couponId === d.id) m.couponId = null; });
  closeSheet(); rerender();
  toast("Cupón borrado");
});

// =================== Broadcasts ===================
function toLocalInput(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function broadcastStatus(b) {
  const now = Date.now();
  if (new Date(b.startsAt).getTime() > now) return ["Programada", "credit"];
  if (b.endsAt && new Date(b.endsAt).getTime() <= now) return ["Terminada", "neutral"];
  return ["Visible", "paid"];
}

export function vBroadcasts() {
  const activated = S.clients.filter(c => c.userId).length;
  const list = [...S.broadcasts].sort((a, b) => (b.pinned - a.pinned) || (b.startsAt || "").localeCompare(a.startsAt || ""));
  return html`
  <header class="view-head">
    <h1 class="display-l">Difusiones</h1>
    <div class="head-actions"><button class="btn primary" data-act="bc-new">Nueva difusión</button></div>
  </header>
  <p class="hint">Mensajes que les aparecen a todas las clientas en “Novedades”. Las fijadas salen además arriba de todo en “Mi cuenta”.</p>
  ${list.map(b => {
    const [label, tone] = broadcastStatus(b);
    return html`<article class="news admin">
      <div class="news-emoji" aria-hidden="true">${b.emoji || "✨"}</div>
      <div class="news-text">
        <h2 class="h3">${b.title} <span class="chip ${tone}">${label}</span>${b.pinned ? html` <span class="chip">Fijada</span>` : ""}</h2>
        <p class="news-body">${b.body}</p>
        <p class="small muted">${fmtDateTime(b.startsAt)}${b.endsAt ? " → " + fmtDateTime(b.endsAt) : ""} · leída por ${S.readCounts.get(b.id) || 0} de ${activated} clientas con acceso</p>
      </div>
      <button class="icon-btn" data-act="bc-edit" data-id="${b.id}" aria-label="Editar difusión">${icon("edit")}</button>
    </article>`;
  })}
  ${!list.length ? html`<section class="empty"><p>Todavía no mandaste ninguna difusión.</p><button class="btn primary" data-act="bc-new">Escribir la primera</button></section>` : ""}`;
}

function broadcastSheet(id) {
  const b = id ? S.broadcasts.find(x => x.id === id) : null;
  openSheet(html`
  <h2 class="display-m">${b ? "Editar difusión" : "Nueva difusión"}</h2>
  <form class="form" data-form="bc-save">
    <input type="hidden" name="id" value="${b ? b.id : ""}">
    <div class="grid-emoji">
      <label>Emoji<input name="emoji" maxlength="8" value="${b ? b.emoji : "🧳"}"></label>
      <label>Título<input name="title" required maxlength="80" value="${b ? b.title : ""}" placeholder="Ej: ¡Llegó ropa nueva!"></label>
    </div>
    <label>Mensaje<textarea name="body" rows="4" maxlength="1000" placeholder="Contales qué hay de nuevo">${b ? b.body : ""}</textarea></label>
    <div class="grid-2">
      <label>Se muestra desde<input type="datetime-local" name="starts_at" required value="${toLocalInput(b ? b.startsAt : new Date())}"></label>
      <label>Hasta (opcional)<input type="datetime-local" name="ends_at" value="${toLocalInput(b ? b.endsAt : null)}"></label>
    </div>
    <label class="check"><input type="checkbox" name="pinned" ${b && b.pinned ? "checked" : ""}> Fijarla arriba en “Mi cuenta”</label>
    <div class="form-actions">
      ${b ? html`<button type="button" class="btn danger-ghost" data-act="bc-delete" data-id="${b.id}">${icon("trash")} Borrar</button>` : ""}
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">${b ? "Guardar" : "Publicar"}</button>
    </div>
  </form>`);
}
onAction("bc-new", () => broadcastSheet());
onAction("bc-edit", d => broadcastSheet(d.id));

onForm("bc-save", async f => {
  const row = {
    title: f.title.trim(), body: (f.body || "").trim(), emoji: (f.emoji || "").trim(),
    starts_at: new Date(f.starts_at).toISOString(), ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null, pinned: !!f.pinned
  };
  if (!row.title) return toast("Falta el título");
  if (row.ends_at && row.ends_at <= row.starts_at) return toast("La fecha “hasta” tiene que ser después de “desde”");
  const saved = must(f.id
    ? await S.sb.from("broadcasts").update(row).eq("id", f.id).select().single()
    : await S.sb.from("broadcasts").insert(row).select().single());
  upsertLocal(S.broadcasts, map.broadcast(saved));
  closeSheet(); rerender();
  toast(f.id ? "Difusión guardada" : "Difusión publicada");
});

onAction("bc-delete", async d => {
  if (!confirm("¿Borrar esta difusión? Las clientas dejan de verla.")) return;
  try { await deleteOne("broadcasts", d.id); } catch (e) { return toast("No se pudo borrar: " + e.message); }
  removeLocal(S.broadcasts, d.id);
  closeSheet(); rerender();
  toast("Difusión borrada");
});
