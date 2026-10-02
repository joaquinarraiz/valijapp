// Admin in-memory store: everything is loaded once and calculations run on the client (like v1).
import { fetchAll, must } from "../supabase.js";
import { norm } from "../legacy.js";

export const S = {
  sb: null, app: null,
  view: "inicio", cashTab: "caja",
  clients: [], movements: [], trips: [], cash: [], places: [],
  settings: null, coupons: [], couponTargets: new Map(), broadcasts: [], readCounts: new Map(),
  filters: { clientText: "", clientChip: "todas", clientSort: "deuda", movText: "", movTrip: "", movLimit: 100 },
  sync: "off" // off | pending | ok | error (Google Sheets backup)
};

// ---------- row <-> object mappers ----------
export const map = {
  client: r => ({
    id: r.id, legacyKey: r.legacy_key, name: r.name, displayName: r.display_name, phone: r.phone || "", address: r.address || "",
    email: r.email || "", avatarPath: r.avatar_path, notes: r.notes || "", userId: r.user_id, authEmail: r.auth_email, createdAt: r.created_at
  }),
  movement: r => ({
    id: r.id, legacyId: r.legacy_id, clientId: r.client_id, date: r.date, detail: r.detail || "", total: Number(r.total), paid: Number(r.paid),
    couponId: r.coupon_id, discountAmount: Number(r.discount_amount || 0), createdAt: r.created_at
  }),
  trip: r => ({ id: r.id, legacyId: r.legacy_id, name: r.name, startsOn: r.starts_on, investment: Number(r.investment) }),
  cash: r => ({ id: r.id, legacyId: r.legacy_id, seq: Number(r.seq) || 0, kind: r.kind, person: r.person || "", date: r.date, amount: Number(r.amount), note: r.note || "" }),
  place: r => ({ id: r.id, legacyId: r.legacy_id, name: r.name, mall: r.mall, aisle: r.aisle, stand: r.stand, phone: r.phone, notes: r.notes }),
  settings: r => ({
    partner1Name: r.partner1_name, partner1Pct: Number(r.partner1_pct), partner2Name: r.partner2_name, partner2Pct: Number(r.partner2_pct),
    inactiveDays: r.inactive_days, cashSince: r.cash_since, cashInitial: Number(r.cash_initial), sheetsUrl: r.sheets_url || "",
    legacyImportedAt: r.legacy_imported_at
  }),
  coupon: r => ({
    id: r.id, code: r.code, title: r.title, kind: r.kind, value: Number(r.value), startsOn: r.starts_on, endsOn: r.ends_on,
    allClients: r.all_clients, active: r.active, createdAt: r.created_at
  }),
  broadcast: r => ({ id: r.id, title: r.title, body: r.body, emoji: r.emoji, startsAt: r.starts_at, endsAt: r.ends_at, pinned: r.pinned, createdAt: r.created_at })
};

export async function loadAll() {
  const sb = S.sb;
  const [clients, movements, trips, cash, places, settings, coupons, targets, broadcasts, reads] = await Promise.all([
    fetchAll(sb, "clients_admin"),
    fetchAll(sb, "movements"),
    fetchAll(sb, "trips"),
    fetchAll(sb, "cash_movements", { order: "seq" }),
    fetchAll(sb, "places"),
    sb.from("settings").select("*").eq("id", 1).single().then(must),
    fetchAll(sb, "coupons"),
    fetchAll(sb, "coupon_targets", { order: "coupon_id" }),
    fetchAll(sb, "broadcasts"),
    fetchAll(sb, "broadcast_reads", { select: "broadcast_id", order: "broadcast_id" })
  ]);
  S.clients = clients.map(map.client);
  S.movements = movements.map(map.movement);
  S.trips = trips.map(map.trip);
  S.cash = cash.map(map.cash);
  S.places = places.map(map.place);
  S.settings = map.settings(settings);
  S.coupons = coupons.map(map.coupon);
  S.couponTargets = new Map();
  for (const t of targets) {
    if (!S.couponTargets.has(t.coupon_id)) S.couponTargets.set(t.coupon_id, []);
    S.couponTargets.get(t.coupon_id).push(t.client_id);
  }
  S.broadcasts = broadcasts.map(map.broadcast);
  S.readCounts = new Map();
  for (const r of reads) S.readCounts.set(r.broadcast_id, (S.readCounts.get(r.broadcast_id) || 0) + 1);
}

/** Shape expected by js/calc.js */
export const calcData = () => ({ movements: S.movements, trips: S.trips, cash: S.cash, settings: S.settings });

export const clientById = id => S.clients.find(c => c.id === Number(id));
export const clientName = id => (clientById(id) || {}).name || "N° " + id;
export const clientByName = name => S.clients.find(c => norm(c.name) === norm(name));
export const partnerName = p => p === "J" ? S.settings.partner1Name : p === "M" ? S.settings.partner2Name : p;

/** Replace or add an item (by id) in a store array. */
export function upsertLocal(arr, item) {
  const i = arr.findIndex(x => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.push(item);
}
/**
 * Deletes exactly one row and throws when nothing (or more than one row) was deleted,
 * e.g. missing permission or already gone. Callers only update local state after it resolves.
 */
export async function deleteOne(table, id, column = "id") {
  const rows = must(await S.sb.from(table).delete().eq(column, id).select(column));
  if (!rows || rows.length !== 1) throw new Error("no se borró nada (¿ya no existe o falta permiso?)");
}

export function removeLocal(arr, id) {
  const i = arr.findIndex(x => x.id === id);
  if (i >= 0) arr.splice(i, 1);
}
