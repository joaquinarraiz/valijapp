/**
 * Legacy (v1, localStorage) <-> v2 conversions. Pure functions, no DOM, no Supabase.
 * Legacy state shape is documented in docs/legacy-features.md.
 */

export const LS_KEY = "valijapp_v1";

export function norm(s) {
  return (s || "").toString().trim().toUpperCase().replace(/\s+/g, " ");
}

/** Small deterministic string hash (FNV-1a, 32 bit) used for rows that have no legacy id. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable key for a legacy row: its uid if it has one, otherwise a content hash plus
 * occurrence number (so two identical rows stay two rows, and re-imports never duplicate).
 * A uid repeated inside the same file gets a suffix: "x", "x#2", "x#3"...
 */
function keyMaker(prefix) {
  const seen = {};
  return (item, contentFields) => {
    const hasId = item.id != null && String(item.id).trim() !== "";
    const base = hasId
      ? String(item.id).trim()
      : prefix + ":" + hash(contentFields.map(f => String(item[f] ?? "")).join("|"));
    seen[base] = (seen[base] || 0) + 1;
    if (hasId) return seen[base] === 1 ? base : base + "#" + seen[base];
    return base + ":" + seen[base];
  };
}

const INT4_MAX = 2147483647;
export const CASH_KINDS = ["RETIRO", "PRESTAMO", "DEVOLUCION", "INGRESO", "GASTO", "AJUSTE"];

/**
 * Parses a money value. Accepts numbers and strings like "$1.500", "1.500,50" (es-AR), "1500.5", "-5000".
 * Returns null when it is not a finite number.
 */
export function parseMoney(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  let t = String(v).replace(/[$\s]/g, "").trim();
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");          // 1.500,50 -> 1500.50
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");      // 1.500.000 -> 1500000
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

/** Returns the date when it is a real YYYY-MM-DD date, else null. */
export function isoDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** Client number valid for an int4 primary key, else null. */
export function clientNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isInteger(x) && x >= 1 && x <= INT4_MAX ? x : null;
}

/** "préstamo " -> "PRESTAMO"; null when it is not a known cash kind. */
export function cashKind(v) {
  const k = norm(v).normalize("NFD").replace(/[̀-ͯ]/g, "");
  return CASH_KINDS.includes(k) ? k : null;
}

/** Validates that something looks like a legacy state. */
export function isLegacyState(s) {
  return !!s && typeof s === "object" && Array.isArray(s.movimientos) && Array.isArray(s.clientas);
}

/**
 * Converts the legacy state into v2 rows. Clients are keyed by normalized name (legacy links
 * movements to clients by name, not by number). Movements reference `clientKey`.
 * Invalid rows never throw: they are returned in `skipped` ({ type, reason, row }).
 */
export function convertLegacy(state) {
  if (!isLegacyState(state)) throw new Error("El archivo no tiene el formato de ValijApp");
  const skipped = [];
  const skip = (type, reason, row) => skipped.push({ type, reason, row });
  const clients = [];
  const byKey = new Map();
  const addClient = (c, fromMovement) => {
    const key = norm(c.nombre);
    if (!key) return;
    const number = clientNumber(fromMovement ? c.nro : c.id);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.phone && c.telefono) existing.phone = String(c.telefono).trim();
      if (!existing.address && c.direccion) existing.address = String(c.direccion).trim();
      if (existing.legacyNumber == null && number != null) existing.legacyNumber = number;
      return;
    }
    const row = {
      key, legacyNumber: number, name: key,
      phone: c.telefono ? String(c.telefono).trim() : "",
      address: c.direccion ? String(c.direccion).trim() : ""
    };
    byKey.set(key, row);
    clients.push(row);
  };
  state.clientas.forEach(c => {
    if (!c || !norm(c.nombre)) return skip("clienta", "sin nombre", c);
    addClient(c, false);
  });
  state.movimientos.forEach(m => { if (m && norm(m.nombre)) addClient({ nombre: m.nombre, nro: m.nro }, true); });

  // two legacy clients sharing a number: only the first keeps it, the rest get a new one
  const usedNumbers = new Set();
  for (const c of clients) {
    if (c.legacyNumber == null || usedNumbers.has(c.legacyNumber)) c.legacyNumber = null;
    else usedNumbers.add(c.legacyNumber);
  }

  const amountOrZero = v => (v === "" || v === null || v === undefined ? 0 : parseMoney(v));

  const movKey = keyMaker("m");
  const movements = [];
  for (const m of state.movimientos) {
    if (!m || !norm(m.nombre)) { skip("movimiento", "sin nombre de clienta", m); continue; }
    const legacyId = movKey(m, ["fecha", "nombre", "detalle", "total", "pago"]);
    const date = isoDate(m.fecha);
    const total = amountOrZero(m.total);
    const paid = amountOrZero(m.pago);
    if (!date) { skip("movimiento", "fecha inválida o vacía", m); continue; }
    if (total === null || paid === null) { skip("movimiento", "monto inválido", m); continue; }
    if (total < 0 || paid < 0) { skip("movimiento", "monto negativo", m); continue; }
    movements.push({ legacyId, clientKey: norm(m.nombre), date, detail: m.detalle ? String(m.detalle) : "", total, paid });
  }

  const tripKey = keyMaker("v");
  const trips = [];
  for (const v of state.viajes || []) {
    if (!v) continue;
    const legacyId = tripKey(v, ["nombre", "desde", "inversion"]);
    const startsOn = isoDate(v.desde);
    const investment = amountOrZero(v.inversion);
    if (!startsOn) { skip("viaje", "fecha inválida o vacía", v); continue; }
    if (investment === null) { skip("viaje", "inversión inválida", v); continue; }
    trips.push({ legacyId, name: v.nombre ? String(v.nombre) : "", startsOn, investment });
  }

  const cashKey = keyMaker("c");
  const cash = [];
  for (const c of state.caja || []) {
    if (!c) continue;
    const legacyId = cashKey(c, ["fecha", "tipo", "persona", "monto", "nota"]);
    const kind = cashKind(c.tipo);
    const date = isoDate(c.fecha);
    const amount = parseMoney(c.monto);
    if (!kind) { skip("caja", "tipo desconocido", c); continue; }
    if (!date) { skip("caja", "fecha inválida o vacía", c); continue; }
    if (amount === null) { skip("caja", "monto inválido", c); continue; }
    cash.push({ legacyId, kind, person: c.persona ? String(c.persona) : "", date, amount, note: c.nota ? String(c.nota) : "" });
  }

  const placeKey = keyMaker("l");
  const places = [];
  for (const l of state.lugares || []) {
    if (!l || !l.nombre) { skip("lugar", "sin nombre", l); continue; }
    places.push({
      legacyId: placeKey(l, ["nombre", "shopping", "pasillo", "stand"]),
      name: String(l.nombre), mall: l.shopping || "", aisle: l.pasillo || "", stand: l.stand != null ? String(l.stand) : "",
      phone: l.telefono || "", notes: l.notas || ""
    });
  }

  const a = state.ajustes || {};
  const pct = (v, d) => { const x = parseMoney(v); return x === null || x < 0 || x > 100 ? d : x; };
  const settings = {
    partner1Name: a.nombreJoaco || "JOACO",
    partner1Pct: pct(a.pctJoaco, 25),
    partner2Name: a.nombreMama || "ALE",
    partner2Pct: pct(a.pctMama, 25),
    inactiveDays: clientNumber(a.diasInactiva) || 45,
    cashSince: isoDate(a.cajaDesde),
    cashInitial: parseMoney(a.saldoInicial) ?? 0,
    sheetsUrl: a.scriptUrl || ""
  };

  return { clients, movements, trips, cash, places, settings, skipped };
}

const n = v => Number(v) || 0;

/**
 * v2 data -> legacy state (used for the Google Sheets backup and the JSON backup download).
 * Row ids are the v2 legacy_id when present, otherwise the uuid, so re-importing never duplicates.
 */
export function toLegacyState(data) {
  const clientById = new Map(data.clients.map(c => [c.id, c]));
  const s = data.settings;
  return {
    clientas: data.clients.map(c => ({ id: c.id, nombre: c.name, telefono: c.phone || "", direccion: c.address || "" })),
    movimientos: data.movements.map(m => {
      const c = clientById.get(m.clientId);
      return { id: m.legacyId || m.id, fecha: m.date, nro: m.clientId, nombre: c ? c.name : "", detalle: m.detail || "", total: n(m.total), pago: n(m.paid) };
    }),
    viajes: data.trips.map(v => ({ id: v.legacyId || v.id, nombre: v.name, desde: v.startsOn, inversion: n(v.investment) })),
    lugares: (data.places || []).map(l => ({ id: l.legacyId || l.id, nombre: l.name, shopping: l.mall, pasillo: l.aisle, stand: l.stand, telefono: l.phone, notas: l.notes })),
    caja: data.cash.map(c => ({ id: c.legacyId || c.id, fecha: c.date, tipo: c.kind, persona: c.person || "", monto: n(c.amount), nota: c.note || "" })),
    ajustes: {
      pctJoaco: n(s.partner1Pct), pctMama: n(s.partner2Pct), nombreJoaco: s.partner1Name, nombreMama: s.partner2Name,
      diasInactiva: n(s.inactiveDays) || 45, scriptUrl: s.sheetsUrl || "", cajaDesde: s.cashSince || null, saldoInicial: n(s.cashInitial)
    },
    updatedAt: Date.now()
  };
}

// ---------- XLSX import (legacy format, plus optional ID columns written by v2 exports) ----------
function cellDate(v) {
  if (v instanceof Date) return v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) {
    const [d, m, y] = v.split("/");
    return (y.length === 2 ? "20" + y : y) + "-" + m.padStart(2, "0") + "-" + d.padStart(2, "0");
  }
  return null;
}
function cellNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const x = parseMoney(v);
  return x === null ? String(v) : x; // left as text so convertLegacy reports the row as invalid
}

/**
 * Reads a workbook (SheetJS) in the legacy export format into a legacy state.
 * `partner2Name` maps "QUIEN" in CAJA back to M; anything else is J (legacy behaviour).
 */
export function workbookToLegacy(XLSX, wb, { partner2Name = "ALE", fallbackTrips = [] } = {}) {
  const rows = name => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) : null;
  const out = { clientas: [], movimientos: [], viajes: [], ajustes: {} };

  const fc = rows("CLIENTES") || rows("CLIENTAS");
  if (fc) {
    const head = (fc[0] || []).map(norm);
    const colDir = head.indexOf("DIRECCION");
    for (let i = 1; i < fc.length; i++) {
      const [nro, nombre, tel] = fc[i] || [];
      if (!nombre) continue;
      out.clientas.push({ id: nro ? parseInt(nro) : null, nombre: norm(nombre), telefono: tel ? String(tel).trim() : "", direccion: colDir >= 0 && fc[i][colDir] ? String(fc[i][colDir]).trim() : "" });
    }
  }

  const fm = rows("CUENTA CORRIENTE");
  if (!fm) throw new Error("No encontré la hoja 'CUENTA CORRIENTE'");
  const idCol = (fm[0] || []).map(norm).indexOf("ID");
  for (let i = 1; i < fm.length; i++) {
    const f = fm[i];
    if (!f || !f[2]) continue;
    out.movimientos.push({
      id: idCol >= 0 && f[idCol] ? String(f[idCol]) : undefined,
      fecha: cellDate(f[0]), nro: f[1] ? parseInt(f[1]) : null, nombre: norm(f[2]),
      detalle: f[3] ? String(f[3]).trim() : "", total: cellNum(f[4]), pago: cellNum(f[5])
    });
    if (f[8] && String(f[8]).toUpperCase().startsWith("INVERSION")) {
      out.viajes.push({ nombre: norm(String(f[8]).replace(/INVERSION/i, "")), desde: null, inversion: Math.abs(cellNum(f[9])) });
    }
  }

  const fl = rows("LUGARES");
  if (fl) {
    const idc = (fl[0] || []).map(norm).indexOf("ID");
    out.lugares = [];
    for (let i = 1; i < fl.length; i++) {
      const [nombre, shopping, pasillo, stand, tel, notas] = fl[i] || [];
      if (!nombre) continue;
      out.lugares.push({ id: idc >= 0 && fl[i][idc] ? String(fl[i][idc]) : undefined, nombre: norm(nombre), shopping: norm(shopping || ""), pasillo: norm(pasillo || ""), stand: stand != null ? String(stand).trim().toUpperCase() : "", telefono: tel ? String(tel).trim() : "", notas: notas ? String(notas).trim().toUpperCase() : "" });
    }
  }

  const fcj = rows("CAJA");
  if (fcj) {
    const idc = (fcj[0] || []).map(norm).indexOf("ID");
    out.caja = [];
    for (let i = 1; i < fcj.length; i++) {
      const [fecha, tipo, quien, monto, nota] = fcj[i] || [];
      if (!tipo) continue;
      const t = norm(tipo);
      if (t === "SALDO INICIAL") { out.ajustes.saldoInicial = cellNum(monto); out.ajustes.cajaDesde = cellDate(fecha); continue; }
      if (!["RETIRO", "PRESTAMO", "DEVOLUCION", "INGRESO", "GASTO", "AJUSTE"].includes(t) || !monto) continue;
      let persona = norm(quien || "");
      if (t === "RETIRO") persona = persona === norm(partner2Name) ? "M" : "J";
      out.caja.push({ id: idc >= 0 && fcj[i][idc] ? String(fcj[i][idc]) : undefined, fecha: cellDate(fecha), tipo: t, persona, monto: cellNum(monto), nota: nota ? String(nota).trim().toUpperCase() : "" });
    }
  }

  const fv = rows("VIAJES");
  if (fv) {
    const idc = (fv[0] || []).map(norm).indexOf("ID");
    out.viajes = [];
    for (let i = 1; i < fv.length; i++) {
      const [nombre, desde, inv] = fv[i] || [];
      if (!nombre) continue;
      out.viajes.push({ id: idc >= 0 && fv[i][idc] ? String(fv[i][idc]) : undefined, nombre: norm(nombre), desde: cellDate(desde), inversion: cellNum(inv) });
    }
  }
  // trips without a date: reuse the date of an existing trip with a similar name, else first movement date
  const firstDate = out.movimientos.map(m => m.fecha).filter(Boolean).sort()[0] || null;
  for (const v of out.viajes) {
    if (v.desde) continue;
    const old = fallbackTrips.find(x => norm(x.name).includes(v.nombre) || v.nombre.includes(norm(x.name)));
    v.desde = old ? old.startsOn : firstDate;
  }
  if (!out.movimientos.length) throw new Error("El Excel no tiene movimientos");
  return out;
}
