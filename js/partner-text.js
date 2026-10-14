// Pure text for the partner cards on Inicio (kept apart from the DOM so it can be tested).
import { fmtMoney } from "./format.js";

/** "−$19.875" / "+$5.000" */
export function signedMoney(n) {
  return (n < 0 ? "−" : "+") + fmtMoney(Math.abs(n));
}

/** Subtitle of a partner card. share already includes the manual adjustment. */
export function partnerCardSub({ share, adjust = 0, withdrawn = 0, openReserve = 0 }) {
  return `ganó ${fmtMoney(share)}${adjust ? " (ajuste " + signedMoney(adjust) + ")" : ""}` +
    (withdrawn ? " · ya retiró " + fmtMoney(withdrawn) : "") +
    (openReserve > 0 ? " · se reservan " + fmtMoney(openReserve) + " para préstamos abiertos" : "");
}
