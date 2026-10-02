// Uploads a legacy (v1) state into Supabase. Idempotent: only adds what is missing, never duplicates.
// Invalid rows are skipped one by one and saved in a migration report (table migration_reports).
import { must } from "../supabase.js";
import { convertLegacy, norm } from "../legacy.js";
import { S, loadAll } from "./store.js";

const CHUNK = 500;
const MAX_REPORTED = 500;

function chunks(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

/**
 * Writes rows in chunks. If a chunk fails, retries row by row so one bad row never blocks the rest.
 * `write(rows)` must return the rows actually written. Failed rows go to `skipped`.
 */
async function writeResilient(rows, write, type, skipped) {
  const written = [];
  for (const part of chunks(rows)) {
    try {
      written.push(...await write(part));
    } catch (chunkError) {
      console.warn(type, "chunk failed, retrying row by row", chunkError);
      for (const row of part) {
        try { written.push(...await write([row])); }
        catch (e) { skipped.push({ type, reason: e.message || String(e), row }); }
      }
    }
  }
  return written;
}

/** Inserts rows skipping existing legacy_id (ON CONFLICT DO NOTHING). Returns how many were new. */
async function addMissing(table, rows, type, skipped) {
  const written = await writeResilient(rows,
    async part => must(await S.sb.from(table).upsert(part, { onConflict: "legacy_id", ignoreDuplicates: true }).select("id")),
    type, skipped);
  return written.length;
}

/**
 * @param legacy v1 state object
 * @param onStep progress callback (text)
 * @param applySettings copy v1 "ajustes" the first time (not for Excel files, which do not carry them)
 * @param source label saved in the report ("navegador", "json", "excel", "sheets")
 * @returns { summary, skipped }
 */
export async function migrateLegacy(legacy, onStep = () => {}, { applySettings = true, source = "navegador" } = {}) {
  onStep("Leyendo lo que ya está en la nube…");
  await loadAll(); // always compare against fresh data, never a stale screen

  const conv = convertLegacy(legacy);
  const skipped = [...conv.skipped];
  const summary = { clients: 0, movements: 0, trips: 0, cash: 0, places: 0, skipped: 0, settings: false };

  // ---- clients: match by legacy_key first, then by normalized name ----
  onStep("Clientas…");
  const idByKey = new Map();
  for (const c of S.clients) if (c.legacyKey) idByKey.set(c.legacyKey, c.id);
  for (const c of S.clients) if (!idByKey.has(norm(c.name))) idByKey.set(norm(c.name), c.id);
  const taken = new Set(S.clients.map(c => c.id));
  const withNumber = [], withoutNumber = [];
  for (const c of conv.clients) {
    if (idByKey.has(c.key)) continue;
    const row = { legacy_key: c.key, name: c.name, phone: c.phone || null, address: c.address || null };
    if (c.legacyNumber && !taken.has(c.legacyNumber)) { taken.add(c.legacyNumber); withNumber.push({ id: c.legacyNumber, ...row }); }
    else withoutNumber.push(row);
  }
  for (const rows of [withNumber, withoutNumber]) {
    const written = await writeResilient(rows,
      async part => must(await S.sb.from("clients_admin").insert(part).select("id, legacy_key")),
      "clienta", skipped);
    written.forEach(r => idByKey.set(r.legacy_key, r.id));
    summary.clients += written.length;
  }

  // rows whose legacy id is actually a v2 uuid (re-import of a v2 backup) already exist
  const known = arr => new Set(arr.flatMap(x => [x.id, x.legacyId]).filter(Boolean));

  onStep("Movimientos…");
  const knownMov = known(S.movements);
  const movRows = [];
  for (const m of conv.movements) {
    if (knownMov.has(m.legacyId)) continue;
    if (!idByKey.has(m.clientKey)) { skipped.push({ type: "movimiento", reason: "no se pudo crear la clienta " + m.clientKey, row: m }); continue; }
    movRows.push({ legacy_id: m.legacyId, client_id: idByKey.get(m.clientKey), date: m.date, detail: m.detail, total: m.total, paid: m.paid });
  }
  summary.movements = await addMissing("movements", movRows, "movimiento", skipped);

  onStep("Viajes…");
  const knownTrips = known(S.trips);
  summary.trips = await addMissing("trips", conv.trips.filter(t => !knownTrips.has(t.legacyId))
    .map(t => ({ legacy_id: t.legacyId, name: t.name, starts_on: t.startsOn, investment: t.investment })), "viaje", skipped);

  // cash keeps the v1 array order: rows are inserted in order, so the identity `seq` follows it
  onStep("Caja…");
  const knownCash = known(S.cash);
  summary.cash = await addMissing("cash_movements", conv.cash.filter(c => !knownCash.has(c.legacyId))
    .map(c => ({ legacy_id: c.legacyId, kind: c.kind, person: c.person, date: c.date, amount: c.amount, note: c.note })), "caja", skipped);

  onStep("Lugares…");
  const knownPlaces = known(S.places);
  summary.places = await addMissing("places", conv.places.filter(p => !knownPlaces.has(p.legacyId))
    .map(p => ({ legacy_id: p.legacyId, name: p.name, mall: p.mall, aisle: p.aisle, stand: p.stand, phone: p.phone, notes: p.notes })), "lugar", skipped);

  // settings only the first time (later runs never overwrite what was changed in v2)
  if (applySettings && !S.settings.legacyImportedAt) {
    onStep("Ajustes…");
    const s = conv.settings;
    try {
      must(await S.sb.from("settings").update({
        partner1_name: s.partner1Name, partner1_pct: s.partner1Pct, partner2_name: s.partner2Name, partner2_pct: s.partner2Pct,
        inactive_days: s.inactiveDays, cash_since: s.cashSince, cash_initial: s.cashInitial,
        sheets_url: S.settings.sheetsUrl || s.sheetsUrl || "", legacy_imported_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", 1));
      summary.settings = true;
    } catch (e) {
      skipped.push({ type: "ajustes", reason: e.message || String(e), row: s });
    }
  }

  summary.skipped = skipped.length;
  onStep("Guardando el informe…");
  try {
    must(await S.sb.from("migration_reports").insert({ source, summary, skipped: skipped.slice(0, MAX_REPORTED) }));
  } catch (e) {
    console.warn("migration report not saved", e);
  }

  onStep("Recargando…");
  await loadAll();
  return { summary, skipped };
}
