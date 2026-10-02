# Migración de la ValijApp anterior a Supabase

La app anterior guardaba todo en el navegador (`localStorage`, clave `valijapp_v1`). Para pasar esos datos a la nube:

1. Publicá la versión nueva en **el mismo sitio** (`https://valijapp.netlify.app`). El navegador solo deja leer los datos viejos desde la misma dirección.
2. Desde el celu o la compu donde usaban la app vieja, entrá a la app nueva con **Administración** → usuario `ale` + contraseña.
3. En **Inicio** (o en **Más → Versión anterior y respaldos**) aparece la tarjeta **“Migrar mis datos a la nube”**. Tocala.
4. Al terminar ves un resumen: cuántas clientas, movimientos, viajes, movimientos de caja y lugares se agregaron.

## Qué hace exactamente

- **Clientas**: se agrupan por nombre normalizado (como hacía la app vieja). Se respeta el N° de clienta; si no tenía número o estaba repetido, se le da el siguiente libre. Los nombres que solo aparecían en la cuenta corriente también se crean como clientas.
- **Movimientos, viajes, caja y lugares**: cada fila tiene una clave estable (`legacy_id` = el id interno de la app vieja, o una huella del contenido si no tenía). Se insertan con *ON CONFLICT DO NOTHING*, así que **podés migrar varias veces sin duplicar nada**.
- **Ajustes** (nombres y % de socios, días de inactividad, fecha y saldo inicial de la caja, URL de Google Sheets): se copian **solo la primera vez**.
- La copia del navegador **no se toca**.

## Otras formas de importar

- **Archivo JSON** (Más → Importar respaldo): sirve el respaldo que descarga la app nueva o un JSON copiado del `localStorage` viejo.
- **Excel** (Más → Subir Excel): mismo formato que exportaba la app vieja. Agrega lo que falte, no reemplaza.
- **Google Sheets** (Más → Traer de la hoja): si tenían la hoja conectada, trae lo que haya ahí y agrega lo que falte.

## Verificar

Después de migrar, los números de **Inicio** tienen que coincidir con la app vieja (deuda total, cobrado histórico, plata en la caja, socios del período). El cálculo es el mismo (`js/calc.js`, verificado contra los datos del Excel del 08/09/26).
