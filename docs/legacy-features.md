# Legacy ValijApp (v1) — feature catalogue and state shape

Source studied: `https://valijapp.netlify.app` (`index.html`, `css/styles.css`, `js/app.js` ~78 KB, `js/data.js` seed).
v1 is a single-device app: all data lives in `localStorage`, optionally mirrored to a Google Sheet through an Apps Script web app.

## localStorage

- Key: **`valijapp_v1`** (`LS_KEY`)
- Value: JSON of the whole state, written on every change (`guardar()`).

```jsonc
{
  "clientas": [ { "id": 43, "nombre": "NOMBRE EN MAYUSCULAS", "telefono": "54 9 2235 ...", "direccion": "" } ],
  // id = client number (can be null, numbers are NOT guaranteed unique in practice)
  "movimientos": [ { "id": "uid", "fecha": "YYYY-MM-DD", "nro": 10, "nombre": "NOMBRE", "detalle": "1 JEAN", "total": 35000, "pago": 35000 } ],
  // one row = a sale (total > 0, optionally with an immediate payment in `pago`) or a payment (total 0, detalle "A SU FAVOR").
  // Movements are linked to clients BY NORMALIZED NAME (trim, upper case, single spaces), not by `nro`.
  "viajes": [ { "id": "uid", "nombre": "AGOSTO 2026", "desde": "YYYY-MM-DD", "inversion": 1851000 } ],
  // each trip starts a period; the period ends where the next trip starts (exclusive)
  "lugares": [ { "id": "uid", "nombre": "", "shopping": "", "pasillo": "", "stand": "", "telefono": "", "notas": "" } ],
  "caja": [ { "id": "uid", "fecha": "YYYY-MM-DD", "tipo": "RETIRO|PRESTAMO|DEVOLUCION|INGRESO|GASTO|AJUSTE", "persona": "J|M|<lender name>|", "monto": 50000, "nota": "" } ],
  // persona: "J"/"M" for RETIRO (partner 1/2), lender name for PRESTAMO/DEVOLUCION, empty otherwise. AJUSTE amount is signed.
  "ajustes": {
    "pctJoaco": 25, "pctMama": 25, "nombreJoaco": "JOACO", "nombreMama": "ALE",
    "diasInactiva": 45, "scriptUrl": "", "cajaDesde": "2026-06-26", "saldoInicial": 0
  },
  "updatedAt": 1757000000000
}
```

The seed (`data.js`, Excel of 08/09/26) had 125 clients (8 without number), 559 movements, 10 trips, 15 cash movements, 0 places.

## Calculations (ported 1:1 to `js/calc.js`)

| Legacy function | Meaning | v2 |
| --- | --- | --- |
| `deudaDe` | Σ(total − pago) of a client | `clientBalance` |
| `todasLasDeudoras` | per name: debt, bought, last purchase (last date with total > 0) | `clientSummaries` |
| `viajeDeFecha`, `rangoDeViaje` | period of a date; range `[desde, next.desde)` | `tripOfDate`, `tripRange` |
| `statsDeViaje` | sold, collected, returned loans in range, base = max(0, collected − returned), share J/M = base × pct, rest = box. First trip also absorbs movements before its date | `tripStats`, `splitCollected` |
| `retiradoEn`, `retiradoTotal`, `retiradoDesdeCorte` | withdrawals per partner | `withdrawnIn`, `withdrawnTotal`, `withdrawnSinceCut` |
| `detalleCaja` | box = initial + collected + loans + incomes + adjustments − investments − withdrawals − returns − expenses, all from `cajaDesde` | `cashDetail` |
| `saldoHasta` | running balance after each cash row ("Quedó") | `cashBalanceAfter` |
| `prestamosPendientes` | per lender: loans − returns (non-zero only) | `pendingLoans`, `totalPendingLoans` |
| `fmt` | `"$" + Math.round(n).toLocaleString("es-AR")` → `$2.018.000` | `fmtMoney` (`js/format.js`) |
| `fmtFecha` | `dd/mm/yy` | `fmtDate` |

Rule shown in the UI: *"Mientras haya un préstamo sin devolver, nadie cobra su %: la devolución se descuenta de lo cobrado antes de repartir."* — implemented as: returns (`DEVOLUCION`) dated inside a period are subtracted from what was collected in that period before applying the percentages.

Cross-check against the seed data (v1 functions vs v2 `calc.js`): total debt $2.018.000 (28 clients), historic collected $18.265.100, box $250.500, pending loans $700.000, per-period collected and J/M shares for all 10 periods — all identical.

## Screens and features

| # | Feature (v1) | Where in v2 | Status |
| --- | --- | --- | --- |
| 1 | Inicio: "💰 Plata en la caja" big card (tap → Caja) | Admin › Inicio | ✅ |
| 2 | Deuda total + how many clients owe | Inicio | ✅ |
| 3 | Cobrado histórico | Inicio | ✅ |
| 4 | Cobrado del período actual (latest trip), "se reparte sobre" when loans returned | Inicio | ✅ |
| 5 | Partner cards JOACO / ALE for the period: earned, already withdrawn, remaining, "después de devolver" | Inicio | ✅ |
| 6 | Préstamos a devolver (per lender) | Inicio, Caja | ✅ |
| 7 | Anotar venta (client select or new name, date, detail, total, paid now); auto-creates client if new name; toast "Queda debiendo" | FAB "+" and client drawer | ✅ (+ optional coupon) |
| 8 | Anotar pago ("A SU FAVOR", shows current debt) | FAB "+" and client drawer | ✅ |
| 9 | Nueva clienta (number, name, phone, address; unique name) | Clientas | ✅ |
| 10 | Retiros y préstamos panel with last 8 cash rows, buttons Anotar retiro / préstamo / devolución / Ver la caja, hint text about split | Inicio + Caja | ✅ |
| 11 | Las que más deben (top 10) | Inicio | ✅ |
| 12 | Las que más compraron (top 10) | Inicio | ✅ |
| 13 | Hace tiempo no compran (N+ días, top 15) | Inicio | ✅ |
| 14 | Clientas list: N°, name, phone, address, debt, bought, last purchase; search by name/phone/address; includes names only present in movements | Clientas | ✅ (orphan names become real clients on migration) |
| 15 | Client detail: debt, bought, last purchase, history, Anotar venta/pago, Editar datos, WhatsApp link | Client drawer | ✅ (+ statement, reminder, maps, access tools) |
| 16 | Edit client: renaming keeps history; delete client deletes her movements (confirm) | Client drawer | ✅ (history is linked by id, so renaming is free) |
| 17 | Cuenta corriente: all movements, search client/item, filter by period, "Ver más" paging (100 + 200) | Movimientos | ✅ |
| 18 | Edit (✏️) / delete any movement | Movimientos, drawer | ✅ |
| 19 | Caja: current box, "De dónde sale ese número" breakdown, cash rows with running "Quedó", edit/delete | Caja & Socios › Caja | ✅ |
| 20 | Cash row types: Entró plata, Salió plata, Retiro (J/M), Préstamo (lender), Devolución (lender), Ajuste (signed) | Caja | ✅ |
| 21 | Corregir el saldo (type the real amount → creates AJUSTE for the difference) | Caja | ✅ |
| 22 | Desde cuándo cuenta la caja (date + initial balance) | Caja | ✅ |
| 23 | Viajes e inversiones: trip = new period + investment; per trip: investment, sold, collected, returned, collected − investment, J/M shares and withdrawals, box | Caja & Socios › Viajes | ✅ |
| 24 | Lugares (stalls at La Salada: mall, aisle, stand, phone, notes), search | Más › Lugares | ✅ |
| 25 | Resumen por período table + totals, partner totals with "ya retiró / le queda", box today | Caja & Socios › Socios | ✅ (+ per-month collected) |
| 26 | Ajustes: partner names and %, inactivity days (sum ≤ 100% check) | Más › Ajustes | ✅ |
| 27 | Export XLSX (CLIENTES, CUENTA CORRIENTE, RESUMEN, VIAJES, LUGARES, CAJA) | Más | ✅ (same sheets, plus an ID column so re-import never duplicates) |
| 28 | Import XLSX (replaces all data) | Más | ⚠️ merges instead of replacing (multi-user safety); idempotent |
| 29 | Google Sheets sync via Apps Script (`?accion=probar|cargar`, POST `{accion:"guardar", datos}`), auto-save 2.5 s after changes, pull newer on start | Más › Google Sheets | ⚠️ Supabase is now the source of truth: Sheets is a backup (auto push after changes + "Guardar ahora"); "Traer de la nube" imports (merge) instead of overwriting |
| 30 | Restaurar ("Cargar los datos que trae la app", seed of 08/09/26) | — | ⚠️ removed: the seed contains client personal data and must not ship. Replaced by "Descargar respaldo (JSON)" + "Importar respaldo/JSON" |
| 31 | Sync badge (Sin nube / Guardando / Nube conectada) | Topbar | ✅ (shows Sheets backup state) |
| 32 | Single-device, no login | Login (admin "ale" / clients) | new |
