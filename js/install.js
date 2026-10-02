// "Agregá ValijApp a tu inicio" guide: iOS (Safari share sheet) vs Android (native prompt or browser menu).
import { html, onAction, toast } from "./dom.js";

let deferredPrompt = null;
let listeners = [];
const DISMISS_KEY = "valijapp_install_dismissed";

export function initInstall() {
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach(fn => fn());
  });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; listeners.forEach(fn => fn()); });
}

export function onInstallChange(fn) { listeners = [fn]; }

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

function steps() {
  const p = platform();
  if (p === "ios") {
    return html`<ol class="steps">
      <li>Abrí esta página en <strong>Safari</strong>.</li>
      <li>Tocá <strong>Compartir</strong> <span class="kbd" aria-hidden="true">⬆︎</span> (abajo en el medio).</li>
      <li>Elegí <strong>Agregar a inicio</strong> y después <strong>Agregar</strong>.</li>
    </ol>`;
  }
  if (deferredPrompt) {
    return html`<p class="small">Con un toque queda como una app más en tu celu.</p>
      <button class="btn primary" data-act="install-now">Instalar ValijApp</button>`;
  }
  if (p === "android") {
    return html`<ol class="steps">
      <li>Abrí esta página en <strong>Chrome</strong>.</li>
      <li>Tocá el menú <span class="kbd" aria-hidden="true">⋮</span> arriba a la derecha.</li>
      <li>Elegí <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.</li>
    </ol>`;
  }
  return html`<p class="small">Abrila desde tu celular: en iPhone con Safari (Compartir → Agregar a inicio) y en Android con Chrome (menú ⋮ → Instalar app).</p>`;
}

/** Dismissible card for "Mi cuenta". Empty when installed or dismissed. */
export function installCard() {
  if (isStandalone() || dismissed()) return "";
  return html`<section class="card install-card">
    <button class="icon-btn corner" data-act="install-dismiss" aria-label="Ocultar">✕</button>
    <h3 class="h3">Agregá ValijApp a tu inicio</h3>
    ${steps()}
  </section>`;
}

/** Permanent entry for "Perfil". */
export function installSection() {
  if (isStandalone()) return html`<p class="small muted">Ya estás usando ValijApp instalada. 👌</p>`;
  return steps();
}

onAction("install-dismiss", () => {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
  document.querySelector(".install-card")?.remove();
  toast("Lo encontrás siempre en Perfil.");
});

onAction("install-now", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  listeners.forEach(fn => fn());
});
