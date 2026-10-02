// Client login management (admin): create / change password / remove access.
// The work happens in the Edge Function `admin-client-auth` (service role, never in the browser).
// Admin-set passwords are kept in public.client_credentials (admin-only) so they can be resent.
// They are NEVER bulk-loaded: one row is read on demand (Ver / Copiar / Enviar por WhatsApp).
import { html, mount, onAction, onForm, openSheet, closeSheet, toast, $ } from "../dom.js";
import { icon } from "../icons.js";
import { must } from "../supabase.js";
import { waLink, waDigits } from "../format.js";
import { APP_URL } from "../config.js";
import { S, map, clientById, upsertLocal } from "./store.js";
import { openClientDrawer } from "./clients.js";
import { rerender } from "./app.js";

const FN = "admin-client-auth";

const ERRORS = {
  not_authenticated: "Tu sesión venció. Volvé a entrar.",
  not_admin: "Esta cuenta no es de administración.",
  invalid_client_id: "Número de clienta inválido.",
  invalid_password: "La contraseña tiene que tener entre 8 y 72 caracteres.",
  client_not_found: "No encontré esa clienta.",
  already_has_access: "Esa clienta ya tiene acceso.",
  no_access: "Esa clienta no tiene acceso.",
  auth_error: "Supabase no aceptó el cambio (¿contraseña muy débil o filtrada?).",
  db_error: "Error de la base de datos. Probá de nuevo.",
  network: "No pude hablar con el servidor. ¿Está publicada la función admin-client-auth?"
};

async function invokeAuth(body) {
  const { data, error } = await S.sb.functions.invoke(FN, { body });
  if (!error) return { data, code: null };
  let code = "network";
  try { const j = await error.context.json(); code = j.error || code; } catch { /* not JSON */ }
  return { data: null, code };
}

export async function callAuth(body) {
  let { data, code } = await invokeAuth(body);
  if (code === "not_authenticated") {
    // the session may have been revoked elsewhere while its token still looks valid: refresh once and retry
    const { error: refreshError } = await S.sb.auth.refreshSession();
    if (!refreshError) ({ data, code } = await invokeAuth(body));
    if (code === "not_authenticated") {
      await S.sb.auth.signOut({ scope: "local" });
      setTimeout(() => location.reload(), 1500);
    }
  }
  if (code) throw new Error(ERRORS[code] || code);
  if (!data || !data.ok) throw new Error(ERRORS[data && data.error] || "No se pudo completar");
  return data;
}

// ---------- readable random passwords: two words + two digits ----------
const WORDS = ["sol", "luna", "mar", "rio", "flor", "nube", "lago", "pino", "roca", "brisa", "playa", "cielo", "monte",
  "campo", "valle", "isla", "faro", "ola", "arena", "hoja", "rosa", "lima", "menta", "coco", "pera", "uva", "kiwi",
  "mango", "trigo", "miel", "cafe", "jazmin", "lirio", "tigre", "gato", "zorro", "puma", "loro", "pato", "oso"];
function pick(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
export function suggestPassword() {
  const cap = w => w[0].toUpperCase() + w.slice(1);
  let a = WORDS[pick(WORDS.length)], b = WORDS[pick(WORDS.length)];
  while (b === a) b = WORDS[pick(WORDS.length)];
  return cap(a) + cap(b) + String(pick(90) + 10);
}

function firstName(c) {
  if (c.displayName) return c.displayName;
  const w = (c.name || "").trim().split(/\s+/)[0] || "";
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "";
}
export function accessMessage(c, password) {
  return `Hola${firstName(c) ? " " + firstName(c) : ""}! Ya podés entrar a ValijApp 🧳\n👉 ${APP_URL}\nUsuario: ${c.id}\nContraseña: ${password}\nDespués podés cambiarla desde tu Perfil.`;
}

/** Password input with Mostrar/Ocultar + Generar (shared by "Crear acceso" and "Nueva clienta"). */
export function passwordField({ value = "", required = true } = {}) {
  return html`<span class="pw-field">
    <input name="password" type="${value ? "text" : "password"}" minlength="8" maxlength="72" ${required ? "required" : ""} autocomplete="new-password" spellcheck="false" value="${value}">
    <button type="button" class="btn ghost sm" data-act="access-toggle">${value ? "Ocultar" : "Mostrar"}</button>
    <button type="button" class="btn ghost sm" data-act="access-suggest">Generar</button>
  </span>`;
}

// ---------- stored password, on demand ----------
// The password set in this session (memory only), so it can be sent right away without a query.
let justSet = null; // { id, password }

/** Is there a stored admin-set password? Cheap query without the password column. */
async function hasStoredPassword(id) {
  const { data, error } = await S.sb.from("client_credentials").select("client_id, set_at").eq("client_id", id).maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Reads the stored password of ONE client, only when the admin asks for it. */
async function storedPassword(id) {
  if (justSet && justSet.id === id) return justSet.password;
  const { data, error } = await S.sb.from("client_credentials").select("password").eq("client_id", id).maybeSingle();
  if (error) throw error;
  return data ? data.password : null;
}

/** Creates the login of a client. Throws with a Spanish message. */
export async function createAccess(id, password) {
  const res = await callAuth({ action: "create", client_id: id, password });
  const row = must(await S.sb.from("clients_admin").select("*").eq("id", id).single());
  upsertLocal(S.clients, map.client(row));
  justSet = { id, password };
  return res;
}

/** Removes the login of a client (the Edge Function deletes the auth user). Throws on failure. */
export async function revokeAccess(id) {
  await callAuth({ action: "revoke", client_id: id });
  const c = clientById(id);
  if (c) Object.assign(c, { userId: null, authEmail: null, avatarPath: null });
  if (justSet && justSet.id === id) justSet = null;
}

// ---------- drawer block ----------
export function accessBlock(c) {
  if (!c.userId) {
    return html`<section class="card">
      <h3 class="h3">${icon("key")} Acceso a la app <span class="chip">Sin acceso</span></h3>
      <p class="muted small">Creale un usuario para que vea su cuenta, sus cupones y las novedades.</p>
      <button class="btn primary" data-act="access-form" data-id="${c.id}" data-mode="create">Crear acceso</button>
    </section>`;
  }
  return html`<section class="card">
    <h3 class="h3">${icon("key")} Acceso a la app <span class="chip paid">Con acceso</span></h3>
    <div class="cred-row"><span>Usuario: <strong>${c.id}</strong></span>
      <button class="btn ghost sm" data-act="access-copy" data-what="user" data-id="${c.id}">Copiar</button></div>
    <div id="credState-${c.id}"><p class="small muted">Revisando contraseña…</p></div>
    <div class="btn-row">
      <button class="btn ghost" data-act="access-form" data-id="${c.id}" data-mode="set_password">Cambiar contraseña</button>
      <button class="btn danger-ghost" data-act="access-revoke" data-id="${c.id}">Quitar acceso</button>
    </div>
  </section>`;
}

/** Called after the drawer is shown: fills the password row for that one client. */
export async function hydrateAccess(c) {
  if (!c.userId || !$("#credState-" + c.id)) return;
  let stored;
  try {
    stored = (justSet && justSet.id === c.id) || await hasStoredPassword(c.id);
  } catch (e) {
    console.warn("client_credentials", e);
    stored = false;
  }
  const box = $("#credState-" + c.id);
  if (!box) return; // drawer changed meanwhile
  const hasPhone = !!waDigits(c.phone);
  mount(box, stored
    ? html`<div class="cred-row"><span>Contraseña: <strong class="pw" id="pw-${c.id}">•••••••</strong></span>
        <span class="btn-row tight">
          <button class="btn ghost sm" data-act="access-reveal" data-id="${c.id}">Ver</button>
          <button class="btn ghost sm" data-act="access-copy" data-what="password" data-id="${c.id}">Copiar</button>
        </span></div>
      <div class="btn-row">${hasPhone
        ? html`<button class="btn whatsapp" data-act="access-wa" data-id="${c.id}">${icon("chat")} Enviar por WhatsApp</button>`
        : html`<button class="btn ghost" data-act="access-copy" data-what="message" data-id="${c.id}">Copiar mensaje</button>`}</div>`
    : html`<p class="small muted">La clienta eligió su propia contraseña.</p>`);
}

const backToDrawer = id => ({ onClose: () => setTimeout(() => openClientDrawer(Number(id))) });

onAction("access-form", d => {
  const c = clientById(d.id);
  const create = d.mode === "create";
  openSheet(html`
  <h2 class="display-m">${create ? "Crear acceso" : "Cambiar contraseña"}</h2>
  <p class="muted">${c.name} · usuario <strong>${c.id}</strong></p>
  <form class="form" data-form="access-save" id="accessForm" autocomplete="off">
    <input type="hidden" name="id" value="${c.id}">
    <input type="hidden" name="mode" value="${d.mode}">
    <label>Contraseña ${passwordField({ value: create ? suggestPassword() : "" })}</label>
    <p class="small muted">Mínimo 8 caracteres. “Generar” arma una fácil de dictar (dos palabras y dos números).</p>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">${create ? "Crear acceso" : "Guardar contraseña"}</button>
    </div>
  </form>`, backToDrawer(c.id));
});

onAction("access-toggle", (_d, el) => {
  const input = el.closest(".pw-field").querySelector("input");
  input.type = input.type === "password" ? "text" : "password";
  el.textContent = input.type === "password" ? "Mostrar" : "Ocultar";
});
onAction("access-suggest", (_d, el) => {
  const input = el.closest(".pw-field").querySelector("input");
  input.value = suggestPassword();
  input.type = "text";
  el.parentElement.querySelector("[data-act=access-toggle]").textContent = "Ocultar";
});

onForm("access-save", async f => {
  const id = Number(f.id);
  if ((f.password || "").length < 8) return toast(ERRORS.invalid_password);
  try {
    if (f.mode === "create") await createAccess(id, f.password);
    else {
      await callAuth({ action: "set_password", client_id: id, password: f.password });
      justSet = { id, password: f.password };
    }
    toast(f.mode === "create" ? "Acceso creado" : "Contraseña cambiada");
    rerender();
    closeSheet(); // its onClose reopens the drawer
  } catch (e) {
    toast(e.message);
  }
});

onAction("access-revoke", async d => {
  const c = clientById(d.id);
  if (!confirm(`¿Quitarle el acceso a ${c.name}? No va a poder entrar más hasta que le crees uno nuevo. Sus compras y pagos no se borran.`)) return;
  try {
    await revokeAccess(c.id);
    toast("Acceso quitado");
    rerender();
    openClientDrawer(c.id);
  } catch (e) {
    toast(e.message);
  }
});

async function passwordOrToast(id) {
  try {
    const pw = await storedPassword(id);
    if (!pw) toast("No hay contraseña guardada para esta clienta");
    return pw;
  } catch (e) {
    toast("No pude leer la contraseña: " + (e.message || e));
    return null;
  }
}

onAction("access-reveal", async (d, el) => {
  const span = $("#pw-" + d.id);
  if (!span) return;
  if (el.textContent === "Ocultar") { span.textContent = "•••••••"; el.textContent = "Ver"; return; }
  const pw = await passwordOrToast(Number(d.id));
  if (!pw) return;
  span.textContent = pw;
  el.textContent = "Ocultar";
});

onAction("access-copy", async d => {
  const c = clientById(d.id);
  let text;
  if (d.what === "user") text = String(c.id);
  else {
    const pw = await passwordOrToast(c.id);
    if (!pw) return;
    text = d.what === "password" ? pw : accessMessage(c, pw);
  }
  try { await navigator.clipboard.writeText(text); toast("Copiado"); } catch { toast("No pude copiar"); }
});

onAction("access-wa", async d => {
  const c = clientById(d.id);
  // open the tab synchronously (popup blockers), then point it at WhatsApp once the password is read
  const win = window.open("", "_blank");
  const pw = await passwordOrToast(c.id);
  if (!pw) { if (win) win.close(); return; }
  const url = waLink(c.phone, accessMessage(c, pw));
  if (win) { win.opener = null; win.location.href = url; } else location.href = url;
});
