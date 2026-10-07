// Inicio: the legacy dashboard, redesigned.
import { html, onAction } from "../dom.js";
import { fmtMoney } from "../format.js";
import { dashboard, daysSince, monthStats, monthLabel, todayISO } from "../calc.js";
import { luggageTag, stat } from "../ui.js";
import { S, calcData, clientName, partnerName } from "./store.js";
import { go } from "./app.js";
import { cashRow, cashSheet } from "./cash.js";
import { migrationCard } from "./more.js";
import { paymentsHomeCard } from "./payments.js";

export function vHome() {
  const d = dashboard(calcData());
  const st = d.current;
  const month = monthStats(calcData(), todayISO().slice(0, 7)); // current calendar month (informative)
  const p1 = S.settings.partner1Name, p2 = S.settings.partner2Name;
  const lastCash = [...S.cash].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  const notActivated = S.clients.filter(c => !c.userId).length;
  // money of the current trip still reserved for open loans (the full breakdown lives in Caja & Socios)
  const openReserve = st ? Math.min(d.loanPool, st.deducted) : 0;
  const partnerCard = (name, share, withdrawn, tone) => stat({
    label: `${name} · período`, value: fmtMoney(share - withdrawn), tone,
    sub: `ganó ${fmtMoney(share)}${withdrawn ? " · ya retiró " + fmtMoney(withdrawn) : ""}${openReserve > 0 ? " · se reservan " + fmtMoney(openReserve) + " para préstamos abiertos" : ""}`
  });

  return html`
  ${migrationCard(true)}
  ${paymentsHomeCard()}
  <div class="home-hero">
    ${luggageTag({
      label: "Plata en la caja", amount: fmtMoney(d.cash.balance), tone: d.cash.balance >= 0 ? "box" : "negative", act: "go-caja",
      sub: "ya descontado lo que cobró cada uno y lo invertido · tocá para ver el detalle"
    })}
    <div class="quick">
      <button class="btn sale big" data-act="sale-new">Anotar venta</button>
      <button class="btn pay big" data-act="pay-new">Anotar pago</button>
      <button class="btn ghost" data-act="client-new">Nueva clienta</button>
    </div>
  </div>

  <div class="stats">
    ${stat({ label: "Deuda total", value: fmtMoney(d.totalDebt), sub: `${d.debtors.length} clientas deben`, tone: "owes" })}
    ${stat({ label: "Cobrado histórico", value: fmtMoney(d.collectedHistoric), tone: "paid" })}
    ${stat({ label: `Vendido ${monthLabel(month.month)}`, value: fmtMoney(month.sold), sub: "mes calendario", tone: "month-sold" })}
    ${stat({ label: `Cobrado ${monthLabel(month.month)}`, value: fmtMoney(month.collected), sub: `${month.movements} movimientos este mes`, tone: "month-paid" })}
    ${st ? partnerCard(p1, st.share1, d.withdrawn1, "p1") : ""}
    ${st ? partnerCard(p2, st.share2, d.withdrawn2, "p2") : ""}
    ${d.totalLoans > 0 ? stat({ label: "Préstamos a devolver", value: fmtMoney(d.totalLoans), sub: d.loans.map(([q, v]) => q + ": " + fmtMoney(v)).join(" · ") + ` · reservado ${fmtMoney(d.loanPool)} de ${fmtMoney(d.loanOutstanding)}`, tone: "owes" }) : ""}
  </div>

  <section class="card">
    <h2 class="h3">Retiros y préstamos</h2>
    <p class="hint">Si alguno retira plata antes de tiempo, anotalo acá: se descuenta solo de lo que le queda por cobrar del período. Si alguien les presta plata para comprar más, anotala como préstamo y después la devolución. Mientras haya un préstamo sin devolver, nadie cobra su %: la devolución se descuenta de lo cobrado antes de repartir.</p>
    <div class="btn-row">
      <button class="btn ghost" data-act="cash-new" data-kind="RETIRO">Anotar retiro</button>
      <button class="btn ghost" data-act="cash-new" data-kind="PRESTAMO">Anotar préstamo</button>
      <button class="btn ghost" data-act="cash-new" data-kind="DEVOLUCION">Anotar devolución</button>
      <button class="btn ghost" data-act="go-caja">Ver la caja</button>
    </div>
    ${lastCash.length ? html`<ul class="rows">${lastCash.map(c => cashRow(c, false))}</ul>` : html`<p class="muted small">Todavía no hay retiros ni préstamos anotados.</p>`}
  </section>

  <div class="two-col">
    <section class="card">
      <h2 class="h3">Las que más deben</h2>
      <ol class="rank">${d.debtors.slice(0, 10).map(x => html`<li><button data-act="client-open" data-id="${x.clientId}"><span>${clientName(x.clientId)}</span><strong class="owes">${fmtMoney(x.debt)}</strong></button></li>`)}</ol>
      ${!d.debtors.length ? html`<p class="muted">Nadie debe nada 🎉</p>` : ""}
    </section>
    <section class="card">
      <h2 class="h3">Las que más compraron</h2>
      <ol class="rank">${d.topBuyers.map(x => html`<li><button data-act="client-open" data-id="${x.clientId}"><span>${clientName(x.clientId)}</span><strong>${fmtMoney(x.bought)}</strong></button></li>`)}</ol>
    </section>
  </div>

  <div class="two-col">
    <section class="card">
      <h2 class="h3">Hace tiempo no compran <span class="count">${d.inactiveDays}+ días</span></h2>
      <p class="hint">Buenas candidatas para mandarles fotos de la ropa nueva 😉</p>
      <ul class="rank plain">${d.inactive.map(x => html`<li><button data-act="client-open" data-id="${x.clientId}"><span>${clientName(x.clientId)}</span><span class="muted small">hace ${daysSince(x.last)} días</span></button></li>`)}</ul>
      ${!d.inactive.length ? html`<p class="muted">¡Todas compraron hace poco!</p>` : ""}
    </section>
    <section class="card">
      <h2 class="h3">Clientas sin acceso <span class="count">${notActivated}</span></h2>
      <p class="hint">Todavía no tienen usuario. Creáselo desde su ficha (Acceso a la app) y mandáselo por WhatsApp.</p>
      <button class="btn ghost" data-act="see-not-activated">Ver la lista</button>
    </section>
  </div>
  <p class="small muted center">Socios: ${partnerName("J")} ${S.settings.partner1Pct}% · ${partnerName("M")} ${S.settings.partner2Pct}%</p>`;
}

onAction("go-caja", () => { S.cashTab = "caja"; go("caja"); });
onAction("cash-new", d => cashSheet(null, d.kind));
onAction("see-not-activated", () => { S.filters.clientChip = "sinacceso"; go("clientas"); });
