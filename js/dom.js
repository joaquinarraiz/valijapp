// Tiny DOM toolkit: escaped HTML templates, delegated actions, toast and sheet.

class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Marks a string as trusted markup. Only use with literals written in this codebase. */
export const raw = s => new SafeHTML(String(s));

function renderValue(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

/** Tagged template: every interpolation is escaped unless it is itself html`` / raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = renderValue(content);
}

// ---------- delegated events ----------
const actions = {};
const forms = {};
const inputs = {};

/** Registers handlers: data-act="name" (click), data-form="name" (submit), data-input="name" (input/change). */
export function onAction(name, fn) { actions[name] = fn; }
export function onForm(name, fn) { forms[name] = fn; }
export function onInput(name, fn) { inputs[name] = fn; }

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-act][role=button]")) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener("submit", e => {
  const fn = forms[e.target.dataset.form];
  if (!fn) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const btn = e.target.querySelector("[type=submit]");
  if (btn) btn.disabled = true;
  Promise.resolve(fn(data, e.target)).catch(err => toast(errorText(err))).finally(() => { if (btn) btn.disabled = false; });
});
const inputHandler = e => {
  const fn = inputs[e.target.dataset.input];
  if (fn) fn(e.target.value, e.target, e);
};
document.addEventListener("input", inputHandler);
document.addEventListener("change", e => { if (e.target.type === "checkbox" || e.target.tagName === "SELECT") inputHandler(e); });

export function errorText(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sin conexión. Revisá internet y probá de nuevo.";
  if (/JWT|session/i.test(m)) return "Tu sesión venció. Volvé a entrar.";
  return "No se pudo guardar: " + m;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); t.hidden = true; }, 2800);
}

// ---------- sheet (modal on desktop, bottom sheet on phones) ----------
let lastFocus = null;
export function openSheet(content, { wide = false, onClose = null } = {}) {
  const back = $("#sheetBack");
  const box = $("#sheet");
  lastFocus = document.activeElement;
  box.className = "sheet" + (wide ? " wide" : "");
  mount(box, html`<button class="sheet-x" data-act="sheet-close" aria-label="Cerrar">✕</button>${content}`);
  back.hidden = false;
  requestAnimationFrame(() => back.classList.add("open"));
  back._onClose = onClose;
  const first = box.querySelector("input:not([type=hidden]):not([disabled]), select, textarea");
  if (first && window.matchMedia("(min-width: 900px)").matches) first.focus();
  else box.focus();
}
export function closeSheet() {
  const back = $("#sheetBack");
  if (back.hidden) return;
  back.classList.remove("open");
  back.hidden = true;
  if (back._onClose) back._onClose();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
export function sheetIsOpen() { return !$("#sheetBack").hidden; }

onAction("sheet-close", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
document.addEventListener("click", e => { if (e.target.id === "sheetBack") closeSheet(); });

/** Avatar with initials fallback. */
export function avatar(url, name, size = "") {
  return url
    ? html`<img class="avatar ${size}" src="${url}" alt="" loading="lazy">`
    : html`<span class="avatar ${size}" aria-hidden="true">${initialsOf(name)}</span>`;
}
function initialsOf(name) {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

export function setBusy(on) {
  document.body.classList.toggle("busy", !!on);
}
