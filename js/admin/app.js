// Admin shell: navigation (bottom bar on phones, sidebar on desktop), FAB and view router.
import { html, mount, onAction, openSheet, closeSheet, $ } from "../dom.js";
import { icon } from "../icons.js";
import { S, loadAll } from "./store.js";
import { vHome } from "./home.js";
import { vClients } from "./clients.js";
import { vMovements, saleSheet, paymentSheet } from "./movements.js";
import { vCash, cashSheet } from "./cash.js";
import { vCoupons, vBroadcasts } from "./promo.js";
import { vMore, vPlaces } from "./more.js";
import { clientFormSheet } from "./clients.js";
import { syncLabel } from "./sync.js";
import { vPayments, loadPaymentRequests, pendingInfo } from "./payments.js";

const NAV = [
  { id: "inicio", label: "Inicio", icon: "home", phone: true },
  { id: "clientas", label: "Clientas", icon: "users", phone: true },
  { id: "movimientos", label: "Movimientos", icon: "list", phone: true },
  { id: "caja", label: "Caja & Socios", short: "Caja", icon: "box", phone: true },
  { id: "pagos", label: "Pagos informados", icon: "wallet" },
  { id: "cupones", label: "Cupones", icon: "ticket" },
  { id: "difusiones", label: "Difusiones", icon: "megaphone" },
  { id: "mas", label: "Más", icon: "dots", phone: true }
];

const VIEWS = {
  inicio: vHome, clientas: vClients, movimientos: vMovements, caja: vCash,
  cupones: vCoupons, difusiones: vBroadcasts, mas: vMore, lugares: vPlaces, pagos: vPayments
};

export async function startAdmin(app, sb) {
  S.app = app; S.sb = sb;
  mount(app, html`<div class="boot"><span class="boot-tag" aria-hidden="true"></span><span>Cargando tus datos…</span></div>`);
  try {
    await loadAll();
    await loadPaymentRequests(); // optional feature: never blocks the app
  } catch (e) {
    console.error(e);
    mount(app, html`<main class="center-screen"><div class="login-card"><h1 class="display-m">No pude cargar los datos</h1>
      <p class="muted">${e.message || String(e)}</p><p class="small muted">¿Corriste <code>supabase/schema.sql</code> y te agregaste a <code>admins</code>?</p>
      <button class="btn primary" data-act="reload">Reintentar</button> <button class="btn ghost" data-act="admin-logout">Cerrar sesión</button></div></main>`);
    return;
  }
  renderShell();
}

function navItems(cls) {
  const current = S.view === "lugares" || (cls !== "side" && S.view === "pagos") ? "mas" : S.view;
  const pending = pendingInfo().count;
  // pending transfers badge: on "Pagos informados" (sidebar) and on "Más" (phone bar, where Pagos lives)
  const badgeFor = id => pending && (id === "pagos" || (cls !== "side" && id === "mas"))
    ? html`<b class="badge" aria-label="${pending} pagos por confirmar">${pending}</b>` : "";
  return NAV.filter(n => cls === "side" || n.phone).map(n => html`
    <button class="nav-item ${current === n.id ? "on" : ""}" data-act="go" data-view="${n.id}" aria-current="${current === n.id ? "page" : "false"}">
      ${icon(n.icon)}<span>${cls === "side" ? n.label : n.short || n.label}</span>${badgeFor(n.id)}
    </button>`);
}

export function renderShell() {
  mount(S.app, html`
  <div class="shell admin-shell">
    <aside class="sidebar" aria-label="Secciones">
      <div class="brand-lockup"><img src="icons/icon.svg" alt="" width="34" height="34"><span>ValijApp</span></div>
      <nav>${navItems("side")}</nav>
      <div class="sidebar-foot"><span id="syncBadge" class="sync">${syncLabel()}</span></div>
    </aside>
    <header class="topbar only-phone">
      <div class="brand-lockup small"><img src="icons/icon.svg" alt="" width="28" height="28"><span>ValijApp</span></div>
      <span id="syncBadgePhone" class="sync">${syncLabel()}</span>
    </header>
    <main class="content" id="view"></main>
    <nav class="bottom-nav only-phone" aria-label="Secciones">${navItems("bottom")}</nav>
    <button class="fab" data-act="fab" aria-label="Anotar">${icon("plus")}<span>Anotar</span></button>
  </div>`);
  renderView();
}

/** Re-renders only the current view (keeps the shell). */
export function renderView() {
  const el = $("#view");
  if (!el) return renderShell();
  mount(el, (VIEWS[S.view] || vHome)());
}

export function rerender() {
  renderView();
}

export function go(view) {
  S.view = view;
  renderShell();
  window.scrollTo(0, 0);
}

onAction("go", d => go(d.view));
onAction("fab", () => openSheet(html`
  <h2 class="display-m">¿Qué querés anotar?</h2>
  <div class="fab-menu">
    <button class="fab-opt sale" data-act="fab-pick" data-what="sale"><b>Anotar venta</b><span>Lo que se llevó y cuánto pagó</span></button>
    <button class="fab-opt pay" data-act="fab-pick" data-what="pay"><b>Anotar pago</b><span>Plata que trajo a cuenta</span></button>
    <button class="fab-opt" data-act="fab-pick" data-what="client"><b>Nueva clienta</b><span>Número, nombre y teléfono</span></button>
    <button class="fab-opt" data-act="fab-pick" data-what="cash"><b>Movimiento de caja</b><span>Retiro, préstamo, gasto…</span></button>
  </div>`));
onAction("fab-pick", d => {
  closeSheet();
  if (d.what === "sale") saleSheet();
  else if (d.what === "pay") paymentSheet();
  else if (d.what === "client") clientFormSheet();
  else cashSheet(null, "RETIRO");
});
