# Vendored libraries

Served from our own origin so the CSP can be `script-src 'self'`.

| File | Library | Version | Source | sha256 |
| --- | --- | --- | --- | --- |
| `supabase-js-2.117.2.esm.js` | @supabase/supabase-js (MIT) | 2.117.2 | npm, bundled: `esbuild entry.mjs --bundle --format=esm --minify --platform=browser --target=es2020` with `export { createClient } from "@supabase/supabase-js"` | see `sha256sum` |
| `xlsx-0.18.5.full.min.js` | SheetJS xlsx (Apache-2.0) | 0.18.5 | https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js | c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99 |

To upgrade supabase-js: bump the version, rebuild the bundle the same way, rename the file and update the import in `js/supabase.js` and the list in `sw.js`.
