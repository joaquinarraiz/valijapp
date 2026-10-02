// Formatting helpers, identical to the legacy app. Pure (no DOM).

export function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return "$" + Math.round(n).toLocaleString("es-AR");
}

/** "YYYY-MM-DD" -> "dd/mm/yy" */
export function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d + "/" + m + "/" + y.slice(2);
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return fmtDate(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")) +
    " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function initials(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

/** Keeps only digits; adds Argentina's 549 prefix when a local number is given. */
export function waDigits(phone) {
  let d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("54")) d = "549" + d.replace(/^0/, "");
  return d;
}

export function waLink(phone, text) {
  const d = waDigits(phone);
  return "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "");
}
