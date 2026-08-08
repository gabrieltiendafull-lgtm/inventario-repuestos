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

### Nota importante

No es recomendable desplegarlo en GitHub Pages puro porque la app usa SQLite y un backend Express. Para un despliegue web real, conviene usar un host que soporte Node.js junto con archivos estáticos y endpoints API.
