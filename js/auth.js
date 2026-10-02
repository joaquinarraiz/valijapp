import { html, mount, onAction, onForm, toast } from "./dom.js";
import { ADMIN_EMAIL, ADMIN_ALIAS } from "./config.js";
import { must } from "./supabase.js";
import { FORGOT_PASSWORD_WA, waTo } from "./contact.js";

let ctx = null; // { app, sb, done }
let mode = "client"; // client | admin

function hero() {
  return html`
  <div class="login-hero">
    <div class="brand-lockup"><img src="icons/icon.svg" alt="" width="44" height="44"><span>ValijApp</span></div>
    <p class="login-tagline">Tu cuenta de ropa, siempre a mano.</p>
  </div>`;
}

function clientForm() {
  return html`
  <form data-form="login-client" class="form" autocomplete="on">
    <label>Usuario (tu número de clienta)<input name="number" inputmode="numeric" pattern="[0-9]*" required autocomplete="username" placeholder="Ej: 43"></label>
    <label>Contraseña<input name="password" type="password" required autocomplete="current-password" minlength="6"></label>
    <button class="btn primary block" type="submit">Entrar</button>
    <button class="link-btn muted-link" type="button" data-act="forgot-password">¿Te olvidaste la contraseña?</button>
  </form>`;
}

function adminForm() {
  return html`
  <form data-form="login-admin" class="form" autocomplete="on">
    <label>Usuario<input name="user" required autocomplete="username" autocapitalize="none" placeholder="ale"></label>
    <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn primary block" type="submit">Entrar</button>
  </form>`;
}

function render() {
  const tabs = html`
    <div class="seg" role="tablist">
      <button role="tab" aria-selected="${mode === "client"}" class="${mode === "client" ? "on" : ""}" data-act="login-mode" data-mode="client">Soy clienta</button>
      <button role="tab" aria-selected="${mode === "admin"}" class="${mode === "admin" ? "on" : ""}" data-act="login-mode" data-mode="admin">Administración</button>
    </div>`;
  mount(ctx.app, html`
  <main class="center-screen login">
    ${hero()}
    <div class="login-card">
      ${tabs}
      ${mode === "admin" ? adminForm() : clientForm()}
    </div>
  </main>`);
}

export function renderLogin(app, sb, done) {
  ctx = { app, sb, done };
  render();
}

onAction("login-mode", d => { mode = d.mode; render(); });

onAction("forgot-password", (_d, el) => {
  const typed = parseInt(el.form?.number?.value, 10);
  const who = typed > 0 ? `la clienta N° ${typed}` : "clienta";
  window.open(waTo(FORGOT_PASSWORD_WA, `Hola! Soy ${who} y me olvidé la contraseña de ValijApp 🙈`), "_blank", "noopener");
});

onForm("login-client", async f => {
  const number = parseInt(f.number, 10);
  if (!number) return toast("Escribí tu número de clienta");
  const email = must(await ctx.sb.rpc("client_login_email", { p_client_id: number }));
  if (!email) {
    toast("Ese número todavía no tiene acceso. Pedíselo a ValijApp.");
    return;
  }
  const { error } = await ctx.sb.auth.signInWithPassword({ email, password: f.password });
  if (error) return toast("Número o contraseña incorrectos");
  ctx.done();
});

onForm("login-admin", async f => {
  const user = f.user.trim().toLowerCase();
  const email = user === ADMIN_ALIAS ? ADMIN_EMAIL : user;
  if (!email.includes("@")) return toast("Usuario desconocido");
  const { error } = await ctx.sb.auth.signInWithPassword({ email, password: f.password });
  if (error) return toast("Usuario o contraseña incorrectos");
  ctx.done();
});

/** Used by both apps. */
export async function logout(sb) {
  // local: logging out on one device must not kill the sessions open on the others
  await sb.auth.signOut({ scope: "local" });
  location.reload();
}
