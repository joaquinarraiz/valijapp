// Client app: Mi cuenta, Cupones, Novedades, Perfil.
import { html, mount, onAction, onForm, onInput, toast, $, avatar } from "./dom.js";
import { must, avatarUrl } from "./supabase.js";
import { fmtMoney, fmtDate } from "./format.js";
import { couponIsValid, todayISO } from "./calc.js";
import { installCard, installSection, onInstallChange } from "./install.js";
import { logout } from "./auth.js";
import { icon } from "./icons.js";
import { luggageTag as tagCard } from "./ui.js";
import { SUPPORT_WA, waTo } from "./contact.js";

let S = null; // { app, sb, clientId, userId, me, movements, coupons, targets, broadcasts, reads, tab }

const TABS = [
  { id: "cuenta", label: "Mi cuenta", icon: "wallet" },
  { id: "cupones", label: "Cupones", icon: "ticket" },
  { id: "novedades", label: "Novedades", icon: "bell" },
  { id: "perfil", label: "Perfil", icon: "user" }
];

export async function startClient(app, sb, clientId) {
  const { data: { user } } = await sb.auth.getUser();
  S = { app, sb, clientId, userId: user.id, tab: "cuenta" };
  await load();
  render();
  onInstallChange(() => { if (S.tab === "cuenta" || S.tab === "perfil") render(); });
}

async function load() {
  const sb = S.sb;
  const [me, movements, coupons, targets, broadcasts, reads] = await Promise.all([
    sb.from("clients").select("id, display_name, phone, address, email, avatar_path").eq("id", S.clientId).single(),
    sb.from("movements").select("id, date, detail, total, paid, coupon_id, discount_amount").eq("client_id", S.clientId).order("date", { ascending: false }).order("created_at", { ascending: false }),
    sb.from("coupons").select("id, code, title, kind, value, starts_on, ends_on, all_clients, active"),
    sb.from("coupon_targets").select("coupon_id"),
    sb.from("broadcasts").select("id, title, body, emoji, starts_at, ends_at, pinned").order("pinned", { ascending: false }).order("starts_at", { ascending: false }),
    sb.from("broadcast_reads").select("broadcast_id")
  ]).then(rs => rs.map(must));
  Object.assign(S, { me, movements, coupons, targets: targets.map(t => t.coupon_id), broadcasts, reads: new Set(reads.map(r => r.broadcast_id)) });
}

const balance = () => S.movements.reduce((a, m) => a + Number(m.total) - Number(m.paid), 0);
const unread = () => S.broadcasts.filter(b => !S.reads.has(b.id));
const validCoupons = () => S.coupons.filter(c => couponIsValid(
  { active: c.active, startsOn: c.starts_on, endsOn: c.ends_on, allClients: c.all_clients },
  { date: todayISO(), clientId: S.clientId, targets: S.targets.includes(c.id) ? [S.clientId] : [] }));
const couponValueText = c => c.kind === "percent" ? `${Number(c.value)}% off` : `${fmtMoney(c.value)} off`;

function render() {
  const n = unread().length;
  const nav = TABS.map(t => html`
    <button class="nav-item ${S.tab === t.id ? "on" : ""}" data-act="c-tab" data-tab="${t.id}" aria-current="${S.tab === t.id ? "page" : "false"}">
      ${icon(t.icon)}<span>${t.label}</span>${t.id === "novedades" && n ? html`<b class="badge">${n}</b>` : ""}
    </button>`);
  const name = S.me.display_name || "";
  mount(S.app, html`
  <div class="shell client-shell">
    <header class="topbar">
      <div class="brand-lockup small"><img src="icons/icon.svg" alt="" width="28" height="28"><span>ValijApp</span></div>
      <button class="avatar-btn" data-act="c-tab" data-tab="perfil" aria-label="Perfil">${avatar(avatarUrl(S.sb, S.me.avatar_path), name || "Yo", "sm")}</button>
    </header>
    <nav class="bottom-nav top-on-desktop" aria-label="Secciones">${nav}</nav>
    <main class="content narrow" id="view">${view()}</main>
  </div>`);
  if (S.tab === "novedades") markRead();
}

function view() {
  if (S.tab === "cupones") return vCoupons();
  if (S.tab === "novedades") return vNews();
  if (S.tab === "perfil") return vProfile();
  return vAccount();
}

function vAccount() {
  const b = balance();
  const pinned = S.broadcasts.find(x => x.pinned);
  const hello = S.me.display_name ? `¡Hola, ${S.me.display_name}!` : "¡Hola!";
  const tag = b > 0 ? tagCard({ label: "Tu saldo", amount: fmtMoney(b), sub: "Es lo que te queda por pagar", tone: "owes" })
    : b < 0 ? tagCard({ label: "Tenés a favor", amount: fmtMoney(-b), sub: "Se descuenta de tu próxima compra", tone: "credit" })
      : tagCard({ label: "Tu saldo", amount: fmtMoney(0), sub: "Estás al día. ¡Gracias!", tone: "clear" });
  return html`
    <h1 class="display-l">${hello}</h1>
    ${pinned ? html`<button class="pinned-banner" data-act="c-tab" data-tab="novedades"><span>${pinned.emoji || "📌"}</span><strong>${pinned.title}</strong><span class="muted small">Ver</span></button>` : ""}
    ${tag}
    ${supportButton()}
    ${installCard()}
    <section class="card">
      <h2 class="h3">Tus movimientos</h2>
      ${S.movements.length ? html`<ul class="rows">${S.movements.map(m => movementRow(m))}</ul>` : html`<p class="muted">Todavía no hay compras anotadas.</p>`}
    </section>`;
}

function movementRow(m) {
  const coupon = m.coupon_id ? S.coupons.find(c => c.id === m.coupon_id) : null;
  const isPayment = Number(m.total) === 0;
  return html`
  <li class="row">
    <div class="row-main">
      <div class="row-title">${isPayment ? "Pago" : m.detail || "Compra"}</div>
      <div class="row-sub">${fmtDate(m.date)}${Number(m.discount_amount) > 0 ? html` · <span class="chip coupon">Cupón ${coupon ? coupon.code : ""} −${fmtMoney(m.discount_amount)}</span>` : ""}</div>
    </div>
    <div class="row-amounts">
      ${Number(m.total) ? html`<div class="amt owes">${fmtMoney(m.total)}</div>` : ""}
      ${Number(m.paid) ? html`<div class="amt paid">−${fmtMoney(m.paid)} pagado</div>` : ""}
    </div>
  </li>`;
}

function supportText() {
  const who = S.me.display_name ? `${S.me.display_name} (clienta N° ${S.clientId})` : `la clienta N° ${S.clientId}`;
  return `Hola! Soy ${who}. Mi saldo en ValijApp es ${fmtMoney(balance())}. `;
}

function supportButton() {
  return html`<a class="btn whatsapp support-btn" href="${waTo(SUPPORT_WA, supportText())}" target="_blank" rel="noopener">${icon("chat")} Consultas y pagos</a>`;
}

function vCoupons() {
  const list = validCoupons();
  const used = S.movements.filter(m => m.coupon_id);
  return html`
    <h1 class="display-l">Cupones</h1>
    ${list.length ? html`<div class="coupon-grid">${list.map(c => html`
      <article class="coupon">
        <div class="coupon-value">${couponValueText(c)}</div>
        <div class="coupon-title">${c.title}</div>
        <div class="coupon-foot">
          <button class="coupon-code" data-act="c-copy" data-code="${c.code}" aria-label="Copiar código">${c.code}</button>
          <span class="small muted">${c.ends_on ? "Vence " + fmtDate(c.ends_on) : "Sin vencimiento"}</span>
        </div>
        <p class="small muted">Mostrale el código a ValijApp cuando compres.</p>
      </article>`)}</div>`
      : html`<section class="empty"><p>No tenés cupones disponibles ahora.</p><p class="muted small">Cuando haya uno para vos, aparece acá.</p></section>`}
    ${used.length ? html`<section class="card"><h2 class="h3">Cupones que usaste</h2><ul class="rows">${used.map(m => movementRow(m))}</ul></section>` : ""}`;
}

function vNews() {
  return html`
    <h1 class="display-l">Novedades</h1>
    ${S.broadcasts.length ? S.broadcasts.map(b => html`
      <article class="news ${b.pinned ? "pinned" : ""} ${S.reads.has(b.id) ? "" : "unread"}">
        <div class="news-emoji" aria-hidden="true">${b.emoji || "✨"}</div>
        <div>
          <h2 class="h3">${b.title}${b.pinned ? html` <span class="chip">Fijada</span>` : ""}</h2>
          <p class="news-body">${b.body}</p>
          <div class="small muted">${fmtDate(b.starts_at)}${b.ends_at ? " · hasta " + fmtDate(b.ends_at) : ""}</div>
        </div>
      </article>`) : html`<section class="empty"><p>No hay novedades por ahora.</p></section>`}`;
}

async function markRead() {
  const ids = unread().map(b => b.id);
  if (!ids.length) return;
  const { error } = await S.sb.from("broadcast_reads").upsert(ids.map(id => ({ broadcast_id: id, client_id: S.clientId })), { onConflict: "broadcast_id,client_id", ignoreDuplicates: true });
  if (error) return console.warn(error);
  ids.forEach(id => S.reads.add(id));
  const badge = $(".nav-item .badge");
  if (badge) badge.remove();
}

function vProfile() {
  const me = S.me;
  return html`
    <h1 class="display-l">Perfil</h1>
    <section class="card profile-head">
      ${avatar(avatarUrl(S.sb, me.avatar_path), me.display_name || "Yo", "xl")}
      <div>
        <label class="btn ghost">Cambiar foto<input type="file" accept="image/*" data-input="c-avatar" hidden></label>
        <p class="small muted">Tu usuario: <strong>${S.clientId}</strong></p>
      </div>
    </section>
    <form class="card form" data-form="c-profile">
      <h2 class="h3">Tus datos</h2>
      <label>¿Cómo querés que te llamemos?<input name="display_name" maxlength="60" value="${me.display_name || ""}"></label>
      <label>Teléfono<input name="phone" type="tel" maxlength="30" value="${me.phone || ""}"></label>
      <label>Dirección<input name="address" maxlength="120" value="${me.address || ""}"></label>
      <label>Email<input name="email" type="email" maxlength="120" value="${me.email || ""}"></label>
      <button class="btn primary" type="submit">Guardar cambios</button>
    </form>
    <form class="card form" data-form="c-password">
      <h2 class="h3">Cambiar contraseña</h2>
      <label>Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label>
      <label>Nueva contraseña<input name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></label>
      <label>Repetila<input name="password2" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn ghost" type="submit">Cambiar contraseña</button>
    </form>
    ${supportButton()}
    <section class="card"><h2 class="h3">Agregá ValijApp a tu inicio</h2>${installSection()}</section>
    <button class="btn danger-ghost block" data-act="c-logout">Cerrar sesión</button>`;
}

onAction("c-tab", d => { S.tab = d.tab; render(); window.scrollTo(0, 0); });
onAction("c-logout", () => logout(S.sb));
onAction("c-copy", async d => {
  try { await navigator.clipboard.writeText(d.code); toast("Código copiado"); } catch { toast(d.code); }
});

onForm("c-profile", async f => {
  const patch = {
    display_name: f.display_name.trim() || null, phone: f.phone.trim() || null,
    address: f.address.trim() || null, email: f.email.trim() || null
  };
  must(await S.sb.from("clients").update(patch).eq("id", S.clientId));
  Object.assign(S.me, patch);
  toast("Datos guardados");
  render();
});

onForm("c-password", async (f, form) => {
  if (f.password !== f.password2) return toast("Las contraseñas no coinciden");
  if (f.password.length < 8) return toast("La contraseña tiene que tener al menos 8 caracteres");
  if (f.password === f.current) return toast("La nueva contraseña tiene que ser distinta");
  // re-check the current password before changing it
  const { data: { user } } = await S.sb.auth.getUser();
  const { error: wrong } = await S.sb.auth.signInWithPassword({ email: user.email, password: f.current });
  if (wrong) return toast("La contraseña actual no es correcta");
  const { error } = await S.sb.auth.updateUser({ password: f.password });
  if (error) return toast("No se pudo cambiar: " + error.message);
  // the copy ValijApp had (if it set the previous one) is no longer valid: forget it
  let { error: forgetError } = await S.sb.rpc("forget_my_stored_password");
  if (forgetError) ({ error: forgetError } = await S.sb.rpc("forget_my_stored_password"));
  form.reset();
  toast(forgetError ? "Contraseña cambiada (avisale a ValijApp que la cambiaste)" : "Contraseña cambiada");
});

/** Resizes an image file to a JPEG of at most 512px per side. */
export async function resizeImage(file, max = 512) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob(b => b ? ok(b) : fail(new Error("No pude leer la foto")), "image/jpeg", 0.85));
}

onInput("c-avatar", async (_v, input) => {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    toast("Subiendo foto…");
    const blob = await resizeImage(file);
    const path = `${S.userId}/avatar-${Date.now()}.jpg`;
    must(await S.sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
    const old = S.me.avatar_path;
    must(await S.sb.from("clients").update({ avatar_path: path }).eq("id", S.clientId));
    if (old && old.startsWith(S.userId + "/")) await S.sb.storage.from("avatars").remove([old]);
    S.me.avatar_path = path;
    toast("Foto actualizada");
    render();
  } catch (e) {
    console.error(e);
    toast("No se pudo subir la foto: " + (e.message || e));
  }
});
