// Google Sheets backup through the legacy Apps Script web app (google/Code.gs of v1).
// Supabase is the source of truth; the sheet receives a full copy in the v1 format.
import { S } from "./store.js";
import { toLegacyState } from "../legacy.js";
import { $ } from "../dom.js";

let timer = null;

export function syncLabel() {
  if (!S.settings || !S.settings.sheetsUrl) return "Sin copia en Sheets";
  return { pending: "Guardando copia…", ok: "Copia en Sheets al día", error: "Copia en Sheets falló", off: "Copia en Sheets" }[S.sync] || "Copia en Sheets";
}

function paintBadge() {
  for (const id of ["syncBadge", "syncBadgePhone"]) {
    const el = $("#" + id);
    if (el) { el.textContent = syncLabel(); el.dataset.state = S.sync; }
  }
}

/** Legacy fetch helper with the same error codes as v1. */
export async function askSheets(url, options) {
  let r;
  try { r = await fetch(url, options); } catch { throw new Error("NO_LLEGA"); }
  const text = await r.text();
  if (text.trim().startsWith("<")) throw new Error("PIDE_LOGIN");
  try { return JSON.parse(text); } catch { throw new Error("RESPUESTA_RARA"); }
}

export function explainSheetsError(e) {
  if (e.message === "PIDE_LOGIN" || e.message === "NO_LLEGA") {
    return "El script de Google no deja entrar. En Apps Script → Implementar → Administrar implementaciones → lápiz → “Quién tiene acceso”: Cualquier persona. La dirección tiene que terminar en /exec.";
  }
  if (e.message === "RESPUESTA_RARA") return "El script contestó algo raro. Volvé a pegar el Code.gs completo y hacé una implementación nueva.";
  return e.message || "No pude conectar con Google";
}

export function validSheetsUrl(url) {
  if (!url.startsWith("https://script.google.com/")) return "Esa dirección no arranca con https://script.google.com/";
  if (!url.endsWith("/exec")) return "La dirección tiene que terminar en /exec (la de “Aplicación web”).";
  return null;
}

export async function pushBackup() {
  const url = S.settings.sheetsUrl;
  if (!url) return;
  clearTimeout(timer); timer = null;
  S.sync = "pending"; paintBadge();
  try {
    const state = toLegacyState({ clients: S.clients, movements: S.movements, trips: S.trips, cash: S.cash, places: S.places, settings: S.settings });
    const j = await askSheets(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ accion: "guardar", datos: state }) });
    if (!j.ok) throw new Error(j.error || "error");
    S.sync = "ok";
  } catch (e) {
    console.warn("Sheets backup", e);
    S.sync = "error";
    throw e;
  } finally {
    paintBadge();
  }
}

/** Called after every change: waits 2.5 s (like v1) and sends a full copy. */
export function scheduleBackup() {
  if (!S.settings || !S.settings.sheetsUrl) return;
  clearTimeout(timer);
  S.sync = "pending"; paintBadge();
  timer = setTimeout(() => pushBackup().catch(() => {}), 2500);
}
