# Vendored libraries

Served from our own origin so the CSP can be `script-src 'self'`.

| File | Library | Version | Source | sha256 |
| --- | --- | --- | --- | --- |
| `supabase-js-2.117.2.esm.js` | @supabase/supabase-js (MIT) | 2.117.2 | npm, bundled: `esbuild entry.mjs --bundle --format=esm --minify --platform=browser --target=es2020` with `export { createClient } from "@supabase/supabase-js"` | 572f894a5b19537252e15c004ecf854e4c2115b12285ca68611663ed1a179eb5 |
| `xlsx-0.18.5.full.min.js` | SheetJS xlsx (Apache-2.0) | 0.18.5 | https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js | c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99 |
| `jspdf-4.2.1-autotable-5.0.8.esm.js` | jsPDF (MIT) + jspdf-autotable (MIT) | 4.2.1 + 5.0.8 | npm, bundled: `esbuild pdf-entry.mjs --bundle --format=esm --minify --platform=browser --target=es2020 --alias:html2canvas=./empty.mjs --alias:dompurify=./empty.mjs --alias:canvg=./empty.mjs --alias:core-js=./empty.mjs` with `export { jsPDF } from "jspdf"; export { autoTable } from "jspdf-autotable";` (optional HTML/SVG renderers stubbed out; only loaded when exporting a PDF) | 30d81eaa6da3ef01eb6547c4fb67c7f86a9de734a7d0e7f178fb8f6409b1c9af |

To upgrade supabase-js: bump the version, rebuild the bundle the same way, rename the file and update the import in `js/supabase.js` and the list in `sw.js`.
