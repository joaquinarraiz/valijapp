// "Descargar" (Excel / PDF / JPG) for admin sections. Each view registers a builder that returns
// what it is currently showing (filters, search, sort respected; "Ver más" limits ignored).
// report = { title, subtitle, filename, sections: [{ heading, columns: [{ label, align?, money? }], rows: [[...]], totals? }] }
import { html, onAction, toast } from "../dom.js";
import { icon } from "../icons.js";
import { fmtMoney } from "../format.js";
import { todayISO } from "../calc.js";
import { loadXlsx } from "./xlsx.js";

const PDF_LIB = new URL("../vendor/jspdf-4.2.1-autotable-5.0.8.esm.js", import.meta.url).href;
const builders = {};

/** Registers the report builder of a section ("movimientos", "clientas", "caja", "pagos"). */
export function registerExport(kind, build) { builders[kind] = build; }

/** Small "Descargar" button + menu for a view header. */
export function exportButton(kind) {
  return html`<div class="dl">
    <button class="btn ghost sm" data-act="dl-toggle" aria-haspopup="menu" aria-expanded="false">${icon("download")} Descargar</button>
    <div class="dl-menu" role="menu" hidden>
      <button role="menuitem" data-act="dl-run" data-kind="${kind}" data-format="xlsx">Excel (.xlsx)</button>
      <button role="menuitem" data-act="dl-run" data-kind="${kind}" data-format="pdf">PDF</button>
      <button role="menuitem" data-act="dl-run" data-kind="${kind}" data-format="jpg">Imagen (.jpg)</button>
    </div>
  </div>`;
}

function closeMenus(except = null) {
  document.querySelectorAll(".dl-menu").forEach(m => {
    if (m === except) return;
    m.hidden = true;
    m.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}
onAction("dl-toggle", (_d, el) => {
  const menu = el.nextElementSibling;
  closeMenus(menu);
  menu.hidden = !menu.hidden;
  el.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", e => { if (!e.target.closest(".dl")) closeMenus(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });

onAction("dl-run", async d => {
  closeMenus();
  const build = builders[d.kind];
  if (!build) return;
  try {
    if (d.format !== "xlsx") toast("Generando…");
    await exportReport(build(), d.format);
  } catch (e) {
    console.error(e);
    toast("No se pudo generar el archivo: " + (e.message || e));
  }
});

// ---------- helpers ----------
export function nowAR() {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(new Date()).replace(",", "");
}
const cellText = (col, v) => v === null || v === undefined || v === "" ? "" : col.money ? fmtMoney(v) : String(v);
const fileBase = r => `ValijApp - ${r.filename} - ${todayISO()}`.replace(/[\\/:*?"<>|]/g, "-");

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function exportReport(report, format) {
  if (format === "xlsx") return downloadBlob(await toXlsx(report), fileBase(report) + ".xlsx");
  if (format === "pdf") return downloadBlob(await toPdf(report), fileBase(report) + ".pdf");
  const images = await toJpgs(report);
  for (let i = 0; i < images.length; i++) {
    const suffix = images.length > 1 ? ` (${i + 1} de ${images.length})` : "";
    downloadBlob(images[i], fileBase(report) + suffix + ".jpg");
    if (i < images.length - 1) await new Promise(r => setTimeout(r, 400)); // browsers throttle bursts
  }
  if (images.length > 1) toast(`Se descargaron ${images.length} imágenes`);
}

// ---------- XLSX ----------
export async function toXlsx(report) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const sec of report.sections) {
    const aoa = [sec.columns.map(c => c.label), ...sec.rows];
    if (sec.totals) aoa.push(sec.totals);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    sec.columns.forEach((c, ci) => {
      if (!c.money) return;
      for (let ri = 1; ri < aoa.length; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (cell && cell.t === "n") cell.z = '"$"#,##0';
      }
    });
    ws["!cols"] = sec.columns.map((c, ci) => ({
      wch: Math.min(48, Math.max(c.label.length, ...aoa.slice(1).map(r => cellText(c, r[ci]).length)) + 2)
    }));
    let name = (sec.sheet || sec.heading || "Hoja").replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
    for (let n = 2; used.has(name); n++) name = name.slice(0, 27) + " " + n;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- PDF ----------
// Standard PDF fonts are Latin-1: replace typographic characters and drop anything else (e.g. emoji).
const pdfSafe = s => String(s).replace(/[—–]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/−/g, "-").replace(/[^\x00-\xFF]/g, "");

export async function toPdf(report) {
  let lib;
  try { lib = await import(PDF_LIB); } catch { throw new Error("no pude cargar la librería de PDF"); }
  const { jsPDF, autoTable } = lib;
  const wide = report.sections.some(s => s.columns.length > 7);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: wide ? "landscape" : "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const stamp = nowAR();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(51, 70, 168);
  doc.text("ValijApp", M, M + 8);
  doc.setFontSize(13); doc.setTextColor(28, 26, 59);
  doc.text(pdfSafe(report.title), M, M + 28);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(107, 104, 144);
  doc.text(pdfSafe(`Generado el ${stamp}`), W - M, M + 8, { align: "right" });
  let y = M + 42;
  if (report.subtitle) {
    const lines = doc.splitTextToSize(pdfSafe(report.subtitle), W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 11 + 8;
  }
  for (const sec of report.sections) {
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(28, 26, 59);
    doc.text(pdfSafe(`${sec.heading} (${sec.rows.length})`), M, y + 10);
    const columnStyles = {};
    sec.columns.forEach((c, i) => { if (c.align === "right" || c.money) columnStyles[i] = { halign: "right" }; });
    autoTable(doc, {
      startY: y + 16,
      margin: { left: M, right: M, top: M, bottom: 40 },
      head: [sec.columns.map(c => pdfSafe(c.label))],
      body: sec.rows.map(r => sec.columns.map((c, i) => pdfSafe(cellText(c, r[i])))),
      foot: sec.totals ? [sec.columns.map((c, i) => pdfSafe(cellText(c, sec.totals[i])))] : undefined,
      showFoot: "lastPage",
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", textColor: [28, 26, 59] },
      headStyles: { fillColor: [51, 70, 168], textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [242, 193, 78], textColor: [43, 34, 10], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 246, 252] },
      columnStyles
    });
    y = doc.lastAutoTable.finalY + 24;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(107, 104, 144);
    const H = doc.internal.pageSize.getHeight();
    doc.text(pdfSafe(`ValijApp · ${report.title}`), M, H - 18);
    doc.text(`Página ${p} de ${pages}`, W - M, H - 18, { align: "right" });
  }
  return doc.output("blob");
}

// ---------- JPG (drawn on a canvas, no html2canvas) ----------
const ROWS_PER_IMAGE = 40;
const C = { bg: "#FFFFFF", ink: "#1C1A3B", muted: "#6B6890", line: "#E3E1F0", zebra: "#F7F6FC", head: "#3346A8", total: "#F2C14E", totalInk: "#2B220A" };

export async function toJpgs(report) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
  const W = 1080, PAD = 40, ROW = 34, HEAD = 38;
  const font = (w, px) => `${w} ${px}px Figtree, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  const stamp = nowAR();
  const chunks = [];
  for (const sec of report.sections) {
    const n = Math.max(1, Math.ceil(sec.rows.length / ROWS_PER_IMAGE));
    for (let i = 0; i < n; i++) chunks.push({ sec, part: i + 1, of: n, rows: sec.rows.slice(i * ROWS_PER_IMAGE, (i + 1) * ROWS_PER_IMAGE), last: i === n - 1 });
  }
  const blobs = [];
  for (const ch of chunks) {
    const { sec } = ch;
    // column widths from content (bold, so totals fit). Money columns are never cut:
    // first the font shrinks (down to 11px), then only text columns give up space.
    const avail = W - 2 * PAD;
    const isNum = c => c.money || c.align === "right";
    const naturalAt = px => {
      measure.font = font(800, px);
      return sec.columns.map((c, ci) => {
        const texts = [c.label, ...sec.rows.map(r => cellText(c, r[ci])), sec.totals ? cellText(c, sec.totals[ci]) : ""];
        return Math.min(isNum(c) ? 999 : 340, Math.max(...texts.map(t => measure.measureText(t).width)) + 18);
      });
    };
    let fs = 15;
    let natural = naturalAt(fs);
    let total = natural.reduce((a, b) => a + b, 0);
    if (total > avail) { fs = Math.max(11, Math.floor(15 * avail / total)); natural = naturalAt(fs); total = natural.reduce((a, b) => a + b, 0); }
    let widths = natural;
    if (total > avail) {
      const fixed = natural.reduce((a, w, i) => a + (isNum(sec.columns[i]) ? w : 0), 0);
      const flex = total - fixed;
      const room = Math.max(60, avail - fixed);
      widths = natural.map((w, i) => isNum(sec.columns[i]) ? w : Math.max(40, w * room / flex));
    } else {
      widths = natural.map(w => w + (avail - total) / natural.length);
    }
    const rowsCount = ch.rows.length + (ch.last && sec.totals ? 1 : 0);
    const top = 150;
    const H = top + HEAD + Math.max(1, rowsCount) * ROW + PAD + 30;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = C.head; g.fillRect(0, 0, W, 8);
    g.textBaseline = "middle";
    g.fillStyle = C.head; g.font = font(800, 30); g.fillText("ValijApp", PAD, 48);
    g.fillStyle = C.muted; g.font = font(500, 15); g.textAlign = "right"; g.fillText(`Generado el ${stamp}`, W - PAD, 48); g.textAlign = "left";
    g.fillStyle = C.ink; g.font = font(700, 22);
    g.fillText(`${report.title}${sec.heading !== report.title ? " · " + sec.heading : ""}${ch.of > 1 ? ` (${ch.part} de ${ch.of})` : ""}`, PAD, 90, avail);
    if (report.subtitle) { g.fillStyle = C.muted; g.font = font(500, 15); g.fillText(report.subtitle, PAD, 120, avail); }
    // header row
    let x = PAD;
    g.fillStyle = C.head; g.fillRect(PAD, top, avail, HEAD);
    g.font = font(700, fs - 1); g.fillStyle = "#FFFFFF";
    sec.columns.forEach((c, ci) => { drawCell(g, c.label, x, top + HEAD / 2, widths[ci], c.money || c.align === "right"); x += widths[ci]; });
    // body
    const draw = (r, idx, isTotal) => {
      const y = top + HEAD + idx * ROW;
      g.fillStyle = isTotal ? C.total : idx % 2 ? C.zebra : C.bg;
      g.fillRect(PAD, y, avail, ROW);
      g.font = font(isTotal ? 800 : 500, fs);
      g.fillStyle = isTotal ? C.totalInk : C.ink;
      let cx = PAD;
      sec.columns.forEach((c, ci) => { drawCell(g, cellText(c, r[ci]), cx, y + ROW / 2, widths[ci], c.money || c.align === "right"); cx += widths[ci]; });
      g.fillStyle = C.line; g.fillRect(PAD, y + ROW - 1, avail, 1);
    };
    ch.rows.forEach((r, i) => draw(r, i, false));
    if (ch.last && sec.totals) draw(sec.totals, ch.rows.length, true);
    if (!ch.rows.length) { g.fillStyle = C.muted; g.font = font(500, 15); g.fillText("Sin datos", PAD + 10, top + HEAD + ROW / 2); }
    blobs.push(await new Promise((ok, fail) => canvas.toBlob(b => b ? ok(b) : fail(new Error("no pude crear la imagen")), "image/jpeg", 0.9)));
  }
  return blobs;
}

function drawCell(g, text, x, y, w, right) {
  const max = w - 16;
  let t = text;
  if (g.measureText(t).width > max) {
    while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
    t += "…";
  }
  if (right) { g.textAlign = "right"; g.fillText(t, x + w - 8, y); g.textAlign = "left"; }
  else g.fillText(t, x + 8, y);
}
