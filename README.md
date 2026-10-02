# ValijApp v2 🧳

Cuenta corriente de ropa con dos caras:

- **Administración** (Ale / Joaco): ventas, pagos, clientas, caja, socios, viajes, cupones, difusiones, Excel y copia en Google Sheets.
- **Clientas**: ven su saldo e historial, sus cupones y las novedades, y editan su perfil (foto, nombre, teléfono, dirección).

Sitio estático (HTML + JS sin build) en Netlify, datos en Supabase protegidos con Row Level Security.

```
index.html, manifest.webmanifest, sw.js, netlify.toml
css/app.css
js/config.js        ← URL y clave pública de Supabase, email de admin
js/calc.js          ← todos los cálculos (puros, testeados)
js/legacy.js        ← conversión desde la app anterior
js/admin/*          ← app de administración
js/client.js        ← app de clientas
supabase/schema.sql ← base de datos completa (se puede correr de nuevo; también actualiza una base vieja)
supabase/functions/admin-client-auth/index.ts ← Edge Function: crear / cambiar / quitar el acceso de una clienta
docs/legacy-features.md, supabase/migrate.md
tests/calc.test.mjs ← node tests/calc.test.mjs
```

## 1. Supabase (una sola vez, en este orden)

1. Creá un proyecto en [supabase.com](https://supabase.com) (si ya lo tenés, seguí).
2. **SQL Editor** → pegá todo `supabase/schema.sql` → **Run**. Se puede volver a correr: si ya habías corrido una versión anterior, la actualiza (borra el sistema viejo de códigos de activación y agrega lo nuevo).
3. **Authentication → Sign In / Providers**:
   - Desactivá **“Allow new users to sign up”**. Las cuentas de las clientas las crea solo la administración (desde la app, vía la Edge Function), así que nadie puede registrarse por su cuenta.
   - En **Email**: **“Confirm email”** puede quedar como quieras (la función crea los usuarios ya confirmados).
   - **Minimum password length = 8** y activá **Leaked password protection** (en algunas versiones del panel está en **Authentication → Policies / Attack Protection**).
4. **Edge Functions → Deploy a new function → Via Editor**: nombre **`admin-client-auth`**, borrá el ejemplo, pegá todo `supabase/functions/admin-client-auth/index.ts` y tocá **Deploy**. Dejá **“Verify JWT” activado**. No hace falta cargar secretos: `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen puestos.
   - Alternativa con la CLI: `supabase functions deploy admin-client-auth` (desde esta carpeta, con el proyecto linkeado).
5. **Authentication → Users → Add user → Create new user**: email = el de `ADMIN_EMAIL` en `js/config.js`, una contraseña **fuerte**, y marcá **Auto Confirm User**. (Funciona aunque los registros estén desactivados.)
6. **SQL Editor**, convertí ese usuario en admin:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'EL_EMAIL_DE_ADMIN'
   on conflict do nothing;
   ```
7. **Project Settings → API**: copiá la **Project URL** y la clave **anon public** (o la **publishable key** `sb_publishable_…`) y pegalas en `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Completá también `ADMIN_EMAIL`.
   > ⚠️ **Nunca** pegues la `service_role` / secret key en la app. Solo la usa la Edge Function, del lado de Supabase.

Para entrar como admin: pestaña **Administración**, usuario `ale` (se traduce a `ADMIN_EMAIL`) o directamente el email.

## 2. Netlify + GitHub

1. Subí esta carpeta a un repo de GitHub.
2. En Netlify: el sitio `valijapp` → **Site configuration → Build & deploy → Link repository** → elegí el repo, rama `main`.
3. Build command: *(vacío)* · Publish directory: `.` (ya está en `netlify.toml`).
4. Cada push a `main` publica solo. Usá el **mismo sitio** (`valijapp.netlify.app`) para poder migrar los datos guardados en el navegador.

`netlify.toml` define cabeceras de seguridad. La CSP solo deja ejecutar scripts del propio sitio (`script-src 'self'`): supabase-js 2.117.2 y SheetJS 0.18.5 están copiados en `js/vendor/` (ver `js/vendor/README.md`). Conexiones permitidas: el proyecto de Supabase `https://uddlalikqbnxgcuqrktq.supabase.co` y el script de Google Sheets. **Si cambiás de proyecto de Supabase, actualizá esa URL en `netlify.toml`.**

## 3. Migrar los datos de la app anterior

Ver [`supabase/migrate.md`](supabase/migrate.md). Resumen: entrá como admin desde el dispositivo que tenía los datos y tocá **“Migrar mis datos a la nube”**. Se puede repetir sin duplicar.

## 4. Darle acceso a una clienta

1. **Clientas** → tocá la clienta → **Acceso a la app** → **Crear acceso**. La app sugiere una contraseña fácil de dictar (dos palabras y dos números, ej. `LunaMango42`); podés tocar **Generar** otra vez o escribir la tuya.
2. Su **usuario es su número de clienta**. Tocá **Enviar por WhatsApp** (o **Copiar mensaje** si no tiene teléfono): le llega el link, su usuario y la contraseña.
3. **Cambiar contraseña**: le pone una nueva (por ejemplo si se la olvidó). **Quitar acceso**: borra su usuario; sus compras y pagos quedan intactos.
4. En la pantalla de entrada, “¿Te olvidaste la contraseña?” le abre un WhatsApp a ValijApp. Ella misma puede cambiarla desde **Perfil** (le pide la actual).

**Sobre guardar contraseñas:** para que puedas volver a verla o reenviarla, la app guarda **solo las contraseñas que pone la administración** (tabla `client_credentials`, que solo puede leer el admin y solo escribe la Edge Function). Son contraseñas generadas por ValijApp, no personales. Cuando una clienta cambia su contraseña desde Perfil, esa copia se borra y la nueva **nunca** se guarda: en su ficha vas a ver “La clienta eligió su propia contraseña”.

Contactos por WhatsApp que ven las clientas (“¿Te olvidaste la contraseña?” y “Consultas y pagos”): `js/contact.js`.

## 5. Probar en la compu

```bash
python -m http.server 5173     # o: npx serve .
# abrir http://localhost:5173
node tests/calc.test.mjs        # cálculos
```

Sin `js/config.js` completo la app muestra “Falta configurar Supabase” en vez de romperse.

## Seguridad (resumen)

- RLS activado en todas las tablas. El admin (`is_admin()`) ve y edita todo.
- Una clienta solo ve **su** fila de `clients` (sin `name` interno, `notes` ni `auth_email`: permisos por columna), **sus** movimientos, los cupones vigentes para ella, las difusiones activas y sus lecturas. Solo puede editar `display_name`, `phone`, `address`, `email`, `avatar_path`.
- Caja, socios, viajes, lugares, ajustes y contraseñas guardadas: solo admin.
- Nadie puede registrarse desde el navegador: los usuarios los crea la Edge Function `admin-client-auth`, que verifica que quien llama sea admin.
- Fotos: bucket público `avatars`; cada clienta solo puede escribir en `avatars/<su uid>/…`.
- Todo texto de usuarias se escapa al mostrarse (sin HTML crudo).
