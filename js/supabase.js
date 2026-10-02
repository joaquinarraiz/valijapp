import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export function isConfigured() {
  return /^https:\/\/.+/.test(SUPABASE_URL) && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "PEGAR_ACA";
}

let client = null;

/** Loads the vendored supabase-js (js/vendor) only when the project is configured. */
export async function getSupabase() {
  if (client) return client;
  const { createClient } = await import("./vendor/supabase-js-2.117.2.esm.js");
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "valijapp_v2_auth" }
  });
  return client;
}

/** Throws the Supabase error, returns data. */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

/** Reads every row of a table/view, 1000 at a time (PostgREST max rows). */
export async function fetchAll(sb, table, { select = "*", order = "id" } = {}) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = must(await sb.from(table).select(select).order(order, { ascending: true }).range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

export function avatarUrl(sb, path) {
  if (!path) return null;
  return sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
