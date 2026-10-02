// Supabase Edge Function: admin-client-auth
// Lets the ValijApp admin create, change or remove a client's login.
// Login = client number + password. The auth email is internal: c<id>.<random8>@clientes.valijapp.app
//
// Body (JSON):
//   { "action": "create",       "client_id": 43, "password": "..." }
//   { "action": "set_password", "client_id": 43, "password": "..." }
//   { "action": "revoke",       "client_id": 43 }
// create / set_password also keep a copy of the admin-set password in public.client_credentials (admin-only);
// revoke deletes it.
// Responses: 200 { ok: true, ... } | 4xx/5xx { ok: false, error: "<code>" }
// Error codes: method_not_allowed, bad_json, not_authenticated, not_admin, invalid_action, invalid_client_id,
//              invalid_password, client_not_found, already_has_access, no_access, auth_error, db_error
//
// Env (provided automatically by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Keep "Verify JWT" ON for this function.

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CLIENT_EMAIL_DOMAIN = "clientes.valijapp.app";
const ALLOWED_ORIGINS = new Set([
  "https://valijapp.netlify.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8888",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://valijapp.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function random8(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function validClientId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

function validPassword(v: unknown): string | null {
  // 72 bytes is the bcrypt limit used by Supabase Auth
  if (typeof v !== "string") return null;
  const bytes = new TextEncoder().encode(v).length;
  return v.length >= 8 && bytes <= 72 ? v : null;
}

/**
 * Keeps a copy of an ADMIN-SET password so the admin can resend it (table client_credentials, admin-only).
 * Passwords chosen by the client herself are never stored. Returns false if the copy could not be saved
 * (the login itself still works).
 */
// deno-lint-ignore no-explicit-any
async function storePassword(admin: any, clientId: number, password: string): Promise<boolean> {
  const { error } = await admin.from("client_credentials")
    .upsert({ client_id: clientId, password, set_at: new Date().toISOString() }, { onConflict: "client_id" });
  return !error;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) who is calling?
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "not_authenticated" }, 401, origin);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) return json({ ok: false, error: "not_authenticated" }, 401, origin);

  // 2) must be an admin (checked with the service client, not trusting the caller)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow, error: adminError } = await admin
    .from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError) return json({ ok: false, error: "db_error" }, 500, origin);
  if (!adminRow) return json({ ok: false, error: "not_admin" }, 403, origin);

  // 3) input
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400, origin);
  }
  const action = body.action;
  if (action !== "create" && action !== "set_password" && action !== "revoke") {
    return json({ ok: false, error: "invalid_action" }, 400, origin);
  }
  const clientId = validClientId(body.client_id);
  if (clientId === null) return json({ ok: false, error: "invalid_client_id" }, 400, origin);
  let password: string | null = null;
  if (action !== "revoke") {
    password = validPassword(body.password);
    if (password === null) return json({ ok: false, error: "invalid_password" }, 400, origin);
  }

  const { data: client, error: clientError } = await admin
    .from("clients").select("id, user_id").eq("id", clientId).maybeSingle();
  if (clientError) return json({ ok: false, error: "db_error" }, 500, origin);
  if (!client) return json({ ok: false, error: "client_not_found" }, 404, origin);

  // 4) actions
  if (action === "create") {
    if (client.user_id) return json({ ok: false, error: "already_has_access" }, 409, origin);
    const email = `c${clientId}.${random8()}@${CLIENT_EMAIL_DOMAIN}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: password!,
      email_confirm: true,
      app_metadata: { valijapp_client_id: clientId },
    });
    if (createError || !created?.user) {
      return json({ ok: false, error: "auth_error", detail: createError?.message }, 400, origin);
    }
    // link it; only if still unlinked (guards a concurrent "create")
    const { data: linked, error: linkError } = await admin
      .from("clients")
      .update({ user_id: created.user.id, auth_email: email })
      .eq("id", clientId).is("user_id", null)
      .select("id");
    if (linkError || !linked || linked.length !== 1) {
      await admin.auth.admin.deleteUser(created.user.id); // no orphan auth users
      return json({ ok: false, error: linkError ? "db_error" : "already_has_access" }, linkError ? 500 : 409, origin);
    }
    const stored = await storePassword(admin, clientId, password!);
    return json({ ok: true, client_id: clientId, stored }, 200, origin);
  }

  if (!client.user_id) return json({ ok: false, error: "no_access" }, 409, origin);

  if (action === "set_password") {
    const { error } = await admin.auth.admin.updateUserById(client.user_id, { password: password! });
    if (error) return json({ ok: false, error: "auth_error", detail: error.message }, 400, origin);
    const stored = await storePassword(admin, clientId, password!);
    return json({ ok: true, client_id: clientId, stored }, 200, origin);
  }

  // revoke: unlink first (so the client loses data access even if the auth delete fails), then delete the user
  const { error: unlinkError } = await admin
    .from("clients").update({ user_id: null, auth_email: null, avatar_path: null }).eq("id", clientId);
  if (unlinkError) return json({ ok: false, error: "db_error" }, 500, origin);
  await admin.from("client_credentials").delete().eq("client_id", clientId);
  const { error: deleteError } = await admin.auth.admin.deleteUser(client.user_id);
  if (deleteError) return json({ ok: false, error: "auth_error", detail: deleteError.message }, 500, origin);
  return json({ ok: true, client_id: clientId }, 200, origin);
});
