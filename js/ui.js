// Shared presentational pieces (client + admin).
import { html } from "./dom.js";

/**
 * The luggage tag: ValijApp's signature card for "the one number that matters".
 * tone: owes | credit | clear | box | negative
 */
export function luggageTag({ label, amount, sub = "", tone = "box", act = null, children = "" }) {
  const attrs = act ? html` data-act="${act}" role="button" tabindex="0"` : "";
  return html`
  <section class="tag-card ${tone} ${act ? "clickable" : ""}"${attrs}>
    <span class="tag-hole" aria-hidden="true"></span>
    <svg class="tag-string" viewBox="0 0 120 60" aria-hidden="true"><path d="M2 58C30 50 40 8 70 10s34 30 48 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
    <div class="tag-label">${label}</div>
    <div class="tag-amount">${amount}</div>
    ${sub ? html`<div class="tag-sub">${sub}</div>` : ""}
    ${children}
  </section>`;
}

export function stat({ label, value, sub = "", tone = "" }) {
  return html`<div class="stat ${tone}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ""}</div>`;
}
