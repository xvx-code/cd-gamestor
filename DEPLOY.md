# Publicar GAMESTORE con Railway + PostgreSQL

## 1. Crear PostgreSQL en Railway

1. Abre tu proyecto en Railway.
2. Pulsa **+ New** → **Database** → **Add PostgreSQL**.
3. Espera a que el servicio PostgreSQL esté listo.
4. En el servicio de GAMESTORE, abre **Variables** y añade `DATABASE_URL` como referencia a `Postgres → DATABASE_URL` (usa el selector de variables de Railway; no copies credenciales a GitHub).

Railway proporciona `DATABASE_URL` y mantiene la base de datos en su propio almacenamiento persistente. Mantén el servicio PostgreSQL privado; la aplicación se conecta por la red privada del proyecto.

## 2. Variables de GAMESTORE

Configura en el servicio de la aplicación:

```env
NODE_ENV=production
ADMIN_PASSWORD=una_contrasena_larga_y_unica
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_ORIGIN=https://TU-DOMINIO.up.railway.app
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=GAMESTORE <facturas@tudominio.com>
DISCORD_URL=https://discord.gg/tu-invitacion
```

`DATABASE_URL` debe añadirse como referencia desde el servicio PostgreSQL. No publiques el valor ni lo subas al repositorio. No necesitas `DATA_DIR` ni un Volume para la base de datos de la aplicación.

## 3. Despliegue

- Build: `npm install && npm run build`
- Start: `npm start`
- Node: 22.12 o superior

El servidor crea las tablas de PostgreSQL al arrancar si todavía no existen.

## 4. Migrar los datos SQLite existentes sin borrarlos

**No borres ni desconectes el Volume SQLite antiguo hasta verificar la importación.** La migración no modifica el archivo SQLite original.

1. Descarga/copia el archivo antiguo `gamestore.db` desde el Volume o servidor donde se ejecutaba la versión SQLite. Debe ser una copia consistente; si SQLite usa WAL, detén temporalmente la versión antigua o realiza un backup SQLite antes de copiarlo.
2. Coloca el archivo en `data/gamestore.db` dentro de una copia local del proyecto (la carpeta `data` está ignorada por Git y no se sube).
3. En Railway, crea PostgreSQL y conecta `DATABASE_URL` al servicio GAMESTORE. Para ejecutar la importación desde tu PC, usa temporalmente la URL pública/TCP de PostgreSQL en tu terminal local. No compartas esa URL ni la guardes en Git.
4. Ejecuta:

```bash
npm install
node migrate-sqlite-to-postgres.js data/gamestore.db
```

5. El script muestra conteos de catálogo, métodos de pago, pedidos, tickets y mensajes. Compara los conteos con SQLite y revisa pedidos y tickets desde el panel antes de cambiar el dominio a la versión PostgreSQL.
6. Cuando confirmes que todo está correcto, despliega la versión PostgreSQL y cambia el tráfico al nuevo servicio. Conserva el archivo y el Volume SQLite como respaldo hasta terminar las comprobaciones.

Si la tienda antigua solo usaba archivos JSON, la aplicación conserva la importación JSON automática en el primer arranque, siempre que esos archivos estén en `DATA_DIR`.

**Importante:** el ZIP del código fuente no incluye la base de datos real ni el Volume de Railway. Si no tienes un `gamestore.db` antiguo, no hay registros históricos que el ZIP pueda importar; la nueva base se inicia con el catálogo predeterminado.

## 5. Copias de seguridad

En el servicio PostgreSQL abre **Backups** y activa las copias programadas y, si tu plan lo permite, Point-in-Time Recovery. Haz además exportaciones lógicas periódicas con `pg_dump` y prueba restaurarlas. Una base persistente no sustituye los backups.

## 6. Resumen técnico

- `pg` / `node-postgres` con pool de conexiones.
- Tablas PostgreSQL: `meta`, `products`, `payments`, `orders`, `support_tickets`, `support_messages`.
- Consultas parametrizadas y transacciones.
- Importador SQLite → PostgreSQL: `migrate-sqlite-to-postgres.js`.
