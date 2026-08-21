# Inventario de repuestos

Aplicación de inventario con frontend web y base SQLite local, lista para desplegarse en un host Node/Express.

## Requisitos

- Node.js 18+

## Instalación local

```bash
npm install
npm start
```

La app quedará disponible en:

```text
http://localhost:3000
```

El archivo SQLite se crea automáticamente en la carpeta `data/inventario.db`.

## Despliegue web

Esta app está preparada para desplegarse en un host que ejecute Node.js y sirva la aplicación desde el mismo dominio. Ejemplos recomendados:

- Render
- Railway
- Vercel (con servidor Node)
- cualquier VPS con Node.js + PM2

### Render

1. Conecta este repositorio a Render.
2. Usa el siguiente comando de inicio:

```bash
npm start
```

3. Asegúrate de que el puerto se tome desde la variable de entorno `PORT`.

### Variables importantes

- `PORT`: puerto HTTP del host
- `SUPABASE_URL` y `SUPABASE_SECRET_KEY`: al definir ambas, la aplicación
  guarda productos y conteos en Supabase en lugar del archivo SQLite temporal.

## Datos persistentes con Supabase

Render gratuito elimina los archivos locales cuando el servicio se detiene; por
eso SQLite no es adecuado para guardar el inventario en producción. Para usar
Supabase:

1. Creá un proyecto en Supabase y esperá a que esté listo.
2. En **SQL Editor**, ejecutá el archivo `supabase/schema.sql` de este repositorio.
3. En **Project Settings > API**, copiá `Project URL` y una **llave secreta**
   (no la publiques ni la agregues al repositorio).
4. En Render, abrí tu servicio > **Environment** y agregá `SUPABASE_URL` y
   `SUPABASE_SECRET_KEY`. Luego ejecutá **Manual Deploy > Deploy latest commit**.

Al abrir `/api/health`, la respuesta debe indicar `"database":"supabase"`.

Antes de agregar las variables a Render, podés copiar los datos actuales con:

```powershell
$env:SUPABASE_URL='https://<proyecto>.supabase.co'
$env:SUPABASE_SECRET_KEY='<clave-secreta>'
node scripts/import-render-data-to-supabase.js https://inventario-repuestos-q2m2.onrender.com
```

El script se ejecuta una sola vez y no debe repetirse, porque volvería a copiar
los conteos.

### Nota importante

No es recomendable desplegarlo en GitHub Pages puro porque la app usa SQLite y un backend Express. Para un despliegue web real, conviene usar un host que soporte Node.js junto con archivos estáticos y endpoints API.

## Acceso multi-dispositivo (LAN)

Para que varios dispositivos vean y compartan los mismos datos debes ejecutar el servidor Node en una máquina accesible en la red (por ejemplo una PC o Raspberry Pi) y acceder desde otros dispositivos usando la IP de esa máquina:

```bash
# En la máquina servidor
node server.js

# Luego desde otro dispositivo en la misma LAN abrir en el navegador:
http://<IP_DE_SERVIDOR>:3000/
```

No abras `inventario-repuestos_index.html` con doble clic ni uses `localhost` desde los otros equipos: ambos casos apuntan a los datos de ese dispositivo, no a los de la PC servidor. Todos deben abrir exactamente la misma URL, por ejemplo `http://192.168.1.10:3000/`.

El indicador superior debe decir **“Base compartida lista”**. Si dice **“Servidor no disponible - datos locales”**, el registro queda pendiente en ese navegador y no será visible desde los demás hasta recuperar la conexión.

Si abrís la página localmente como archivo (`file://`) algunos comportamientos (como llamadas a la API) pueden fallar. En ese caso podés forzar la dirección del backend desde `index.html` añadiendo antes de los scripts:

```html
<script>
	window.API_BASE = 'http://192.168.1.10:3000';
</script>
```

Asegurate además de permitir conexiones entrantes al puerto `3000` en el firewall del servidor. GitHub guarda y distribuye el código, pero no ejecuta este servidor ni comparte el archivo SQLite: para uso fuera de la red local hay que desplegar el backend en Render, Railway o un VPS, con almacenamiento persistente.

## Búsqueda global

Se añadió una búsqueda global en la cabecera. La caja `Buscar código, descripción o marca...` filtra en tiempo real la tabla de reporte. Pulsá `Esc` o el botón ✖ para limpiar la búsqueda.

La búsqueda es insensible a mayúsculas y busca coincidencias parciales en `código`, `descripción` o `marca`.

## Sincronización automática

La aplicación ahora sincroniza automáticamente los cambios realizados en el navegador con el backend cuando se recupera la conexión.

- Los conteos (`/api/counts`) y productos creados/actualizados se guardan localmente con una marca `_pending` si no hay conexión.
- Al restaurarse la conectividad (evento `online` o cada 30 segundos), la app intentará enviar los registros pendientes al servidor.
- Las eliminaciones realizadas offline se guardan en `db_pending_deletes` y se intentarán borrar del servidor al sincronizar.

Ver el estado de sincronización en la cabecera (texto junto al título). Si necesitás forzar una sincronización, recargá la página estando conectado.
