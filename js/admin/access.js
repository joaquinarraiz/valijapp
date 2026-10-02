// Client login management (admin): create / change password / remove access.
// The work happens in the Edge Function `admin-client-auth` (service role, never in the browser).
// Admin-set passwords are kept in public.client_credentials (admin-only) so they can be resent.
import { html, onAction, onForm, openSheet, closeSheet, toast, $ } from "../dom.js";
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

async function callAuth(body) {
  const { data, error } = await S.sb.functions.invoke(FN, { body });
  if (error) {
    let code = "network";
    try { const j = await error.context.json(); code = j.error || code; } catch { /* not JSON */ }
    throw new Error(ERRORS[code] || code);
  }
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

// ---------- drawer block ----------
export function accessBlock(c) {
  const cred = S.credentials.get(c.id);
  if (!c.userId) {
    return html`<section class="card">
      <h3 class="h3">${icon("key")} Acceso a la app <span class="chip">Sin acceso</span></h3>
      <p class="muted small">Creale un usuario para que vea su cuenta, sus cupones y las novedades.</p>
      <button class="btn primary" data-act="access-form" data-id="${c.id}" data-mode="create">Crear acceso</button>
    </section>`;
  }
  const hasPhone = !!waDigits(c.phone);
  return html`<section class="card">
    <h3 class="h3">${icon("key")} Acceso a la app <span class="chip paid">Con acceso</span></h3>
    <div class="cred-row"><span>Usuario: <strong>${c.id}</strong></span>
      <button class="btn ghost sm" data-act="access-copy" data-what="user" data-id="${c.id}">Copiar</button></div>
    ${cred ? html`<div class="cred-row"><span>Contraseña: <strong class="pw" id="pw-${c.id}">•••••••</strong></span>
        <span class="btn-row tight">
          <button class="btn ghost sm" data-act="access-reveal" data-id="${c.id}">Ver</button>
          <button class="btn ghost sm" data-act="access-copy" data-what="password" data-id="${c.id}">Copiar</button>
        </span></div>`
      : html`<p class="small muted">La clienta eligió su propia contraseña.</p>`}
    <div class="btn-row">
      ${cred ? (hasPhone
        ? html`<a class="btn whatsapp" href="${waLink(c.phone, accessMessage(c, cred.password))}" target="_blank" rel="noopener">${icon("chat")} Enviar por WhatsApp</a>`
        : html`<button class="btn ghost" data-act="access-copy" data-what="message" data-id="${c.id}">Copiar mensaje</button>`) : ""}
      <button class="btn ghost" data-act="access-form" data-id="${c.id}" data-mode="set_password">Cambiar contraseña</button>
      <button class="btn danger-ghost" data-act="access-revoke" data-id="${c.id}">Quitar acceso</button>
    </div>
  </section>`;
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
    <label>Contraseña
      <span class="pw-field">
        <input name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password" spellcheck="false">
        <button type="button" class="btn ghost sm" data-act="access-toggle">Mostrar</button>
        <button type="button" class="btn ghost sm" data-act="access-suggest">Generar</button>
      </span>
    </label>
    <p class="small muted">Mínimo 8 caracteres. “Generar” arma una fácil de dictar (dos palabras y dos números).</p>
    <div class="form-actions">
      <button type="button" class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" type="submit">${create ? "Crear acceso" : "Guardar contraseña"}</button>
    </div>
  </form>`, backToDrawer(c.id));
  if (create) { const f = $("#accessForm"); f.password.value = suggestPassword(); f.password.type = "text"; f.querySelector("[data-act=access-toggle]").textContent = "Ocultar"; }
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
    const res = await callAuth({ action: f.mode, client_id: id, password: f.password });
    if (f.mode === "create") {
      const row = must(await S.sb.from("clients_admin").select("*").eq("id", id).single());
      upsertLocal(S.clients, map.client(row));
    }
    if (res.stored) S.credentials.set(id, { password: f.password, setAt: new Date().toISOString() });
    else S.credentials.delete(id);
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
    await callAuth({ action: "revoke", client_id: c.id });
    Object.assign(c, { userId: null, authEmail: null, avatarPath: null });
    S.credentials.delete(c.id);
    toast("Acceso quitado");
    rerender();
    openClientDrawer(c.id);
  } catch (e) {
    toast(e.message);
  }
});

onAction("access-reveal", (d, el) => {
  const cred = S.credentials.get(Number(d.id));
  const span = $("#pw-" + d.id);
  if (!cred || !span) return;
  const showing = el.textContent === "Ocultar";
  span.textContent = showing ? "•••••••" : cred.password;
  el.textContent = showing ? "Ver" : "Ocultar";
});

onAction("access-copy", async d => {
  const c = clientById(d.id);
  const cred = S.credentials.get(c.id);
  const text = d.what === "user" ? String(c.id) : d.what === "password" ? cred && cred.password : cred && accessMessage(c, cred.password);
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast("Copiado"); } catch { toast("No pude copiar"); }
});
