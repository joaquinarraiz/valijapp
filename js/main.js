import { isConfigured, getSupabase, must } from "./supabase.js";
import { html, mount, $, toast, onAction } from "./dom.js";
import { renderLogin } from "./auth.js";
import { initInstall } from "./install.js";

const app = $("#app");

function renderSetupNeeded() {
  mount(app, html`
  <main class="center-screen">
    <div class="login-card">
      <div class="brand-lockup"><img src="icons/icon.svg" alt="" width="48" height="48"><span>ValijApp</span></div>
      <h1 class="display-m">Falta configurar Supabase</h1>
      <p class="muted">La app ya está instalada pero todavía no sabe a qué base de datos conectarse.</p>
      <ol class="steps">
        <li>Abrí <code>js/config.js</code>.</li>
        <li>Pegá la <strong>Project URL</strong> y la clave <strong>anon / publishable</strong> de tu proyecto (Supabase → Project Settings → API).</li>
        <li>Poné el email de administración en <code>ADMIN_EMAIL</code>.</li>
        <li>Subí el cambio a GitHub y Netlify lo publica solo.</li>
      </ol>
      <p class="muted small">Los pasos completos están en el README.</p>
    </div>
  </main>`);
}

export async function route() {
  if (!isConfigured()) return renderSetupNeeded();
  let sb;
  try {
    sb = await getSupabase();
  } catch (e) {
    console.error(e);
    mount(app, html`<main class="center-screen"><div class="login-card"><h1 class="display-m">Sin conexión</h1>
      <p class="muted">No pude cargar la app. Revisá internet y volvé a intentar.</p>
      <button class="btn primary" data-act="reload">Reintentar</button></div></main>`);
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin(app, sb, route);
  let role;
  try {
    role = must(await sb.rpc("my_role"));
  } catch (e) {
    console.error(e);
    toast("No pude leer tu cuenta. ¿Corriste supabase/schema.sql?");
    return renderLogin(app, sb, route);
  }
  if (role.is_admin) {
    const { startAdmin } = await import("./admin/app.js");
    return startAdmin(app, sb);
  }
  if (role.client_id) {
    const { startClient } = await import("./client.js");
    return startClient(app, sb, role.client_id);
  }
  // logged in but not linked to anything (e.g. access was reset)
  await sb.auth.signOut({ scope: "local" });
  toast("Esa cuenta ya no tiene acceso. Escribile a ValijApp.");
  return renderLogin(app, sb, route);
}

onAction("reload", () => location.reload());

initInstall();
route();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e));
}
