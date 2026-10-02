// Supabase project settings.
// The anon / publishable key is public by design: security comes from Row Level Security (supabase/schema.sql).
// NEVER paste the service_role / secret key here.
export const SUPABASE_URL = "https://uddlalikqbnxgcuqrktq.supabase.co";        // e.g. https://abcdefgh.supabase.co
export const SUPABASE_ANON_KEY = "sb_publishable_FLMFp8ix_W1BOgkj5qnrgA_pK3p-gTo";   // Project Settings → API → anon public (or publishable key)

// Email of the admin user created in Supabase → Authentication → Users.
// Typing "ale" as the username on the login screen maps to this email.
export const ADMIN_EMAIL = "ale@valijapp.app";
export const ADMIN_ALIAS = "ale";

// Domain used for the internal (never emailed) logins of clients.
export const CLIENT_EMAIL_DOMAIN = "clientes.valijapp.app";

// Public URL of the app, sent to clients on WhatsApp with their activation code.
export const APP_URL = "https://valijapp.netlify.app";
