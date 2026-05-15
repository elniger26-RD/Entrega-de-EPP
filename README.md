# Control de EPP - DP World

Aplicacion web para gestionar entregas de equipos de proteccion personal con firma digital, historial, alertas, inventario y administracion de usuarios.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- SQLite local mediante API Express
- EmailJS opcional para alertas
- Exportacion Excel con `xlsx`
- Firma digital con `react-signature-canvas`

## Desarrollo local

```bash
npm install --legacy-peer-deps
npm run dev
```

La app queda disponible en:

```text
http://127.0.0.1:3000
```

La API SQLite corre en:

```text
http://127.0.0.1:3001
```

## Credenciales iniciales

Usuario administrador inicial:

```text
elniger26@gmail.com
```

Contrasena por defecto:

```text
Admin123!
```

En produccion cambia la variable `SQLITE_ADMIN_PASSWORD`.

## Variables de entorno

```bash
PORT=3001
SQLITE_DB_PATH=/app/data/epp-control.sqlite
SQLITE_ADMIN_PASSWORD=una_contrasena_segura

VITE_EMAILJS_SERVICE_ID=
VITE_EMAILJS_TEMPLATE_ID=
VITE_EMAILJS_PUBLIC_KEY=
VITE_ADMIN_EMAIL=w.medinaconsorcio@gmail.com
```

## Deploy en Coolify

Usa el `Dockerfile` incluido.

Configuracion recomendada:

- Build Pack: Dockerfile
- Puerto interno: `3000`
- Volumen persistente: `/app/data`
- Healthcheck: `/api/health`

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

`npm run start` sirve el build compilado y la API desde el mismo servidor Express.
