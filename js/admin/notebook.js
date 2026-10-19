// "Cuaderno" layout for long admin lists (Clientas, Movimientos): ring binding, ruled rows,
// handwritten title. Desktop shows it as a table (column headers); phones get compact two-line rows.
import { html } from "../dom.js";

/**
 * @param title    handwritten title ("Cartera de clientas")
 * @param meta     right side of the header (count, Descargar…)
 * @param cols     column headers [{ label, cls }] (desktop only)
 * @param listId   id of the <ul> that holds the rows (repainted by the views)
 * @param rows     row markup
 * @param kind     css modifier: "clients" | "movs"
 * @param side     optional markup on the right edge (A–Z index)
 */
export function notebook({ title, meta, cols, listId, rows, kind, side = "" }) {
  return html`<section class="notebook nb-${kind}" aria-label="${title}">
    <header class="nb-head">
      <h2 class="nb-title">${title}</h2>
      <div class="nb-meta">${meta}</div>
    </header>
    <div class="nb-page">
      <div class="nb-table" role="table" aria-label="${title}">
        <div class="nb-cols" role="row">${cols.map(c => html`<span class="nb-cell ${c.cls}" role="columnheader">${c.label}</span>`)}</div>
        <ul class="nb-rows" id="${listId}" role="rowgroup">${rows}</ul>
      </div>
      ${side}
    </div>
  </section>`;
}

/** First letter used by the A–Z index (accents removed; anything else goes under "#"). */
export function initialOf(name) {
  const ch = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

/** A–Z index strip; only letters present in `names` (in the order they appear in A–Z). */
export function azStrip(names, id = "azStrip") {
  const present = new Set(names.map(initialOf));
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"].filter(l => present.has(l));
  return html`<nav class="nb-az" id="${id}" aria-label="Índice alfabético">
    <button type="button" data-act="az-jump" data-letter="" aria-label="Ir al principio de la lista">Todos</button>
    ${letters.map(l => html`<button type="button" data-act="az-jump" data-letter="${l}" aria-label="${l === "#" ? "Ir a nombres que no empiezan con letra" : "Ir a la letra " + l}">${l}</button>`)}
  </nav>`;
}
