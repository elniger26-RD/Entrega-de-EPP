# Guia para agentes

## Resumen del proyecto

Este proyecto es una app web de control de entrega de EPP para DP World. Permite:

- Autenticar usuarios con Firebase Auth, por Google o por correo y contrasena.
- Registrar entregas de equipos de proteccion personal con firma digital.
- Consultar empleados, catalogo de EPP, historial de entregas y alertas.
- Administrar empleados, catalogo, stock y usuarios autorizados.
- Exportar informacion a Excel.
- Instalarse como PWA usando el manifest publico.

La app es un frontend React/Vite con Firebase como backend. Casi toda la logica de negocio y UI esta actualmente concentrada en `SRC/App.tsx`.

## Stack principal

- React 19
- TypeScript
- Vite
- Tailwind CSS v4 mediante `@tailwindcss/vite`
- Firebase Auth y Firestore
- EmailJS para notificaciones opcionales
- `react-signature-canvas` para firma digital
- `xlsx` para exportaciones
- `lucide-react` para iconos
- `motion` para animaciones

## Estructura importante

- `package.json`: scripts y dependencias.
- `SRC/App.tsx`: aplicacion principal, pantallas, estado, consultas Firestore y flujos de entrega.
- `SRC/firebase.ts`: inicializacion de Firebase, Auth, Firestore y helper para crear usuarios secundarios.
- `SRC/main.tsx`: montaje de React y registro del service worker.
- `SRC/index.css`: entrada de Tailwind.
- `SRC/vite.config.ts`: configuracion de Vite, React, Tailwind y alias `@`.
- `SRC/tsconfig.json`: configuracion TypeScript.
- `firestore.rules`: reglas de seguridad de Firestore.
- `firebase-applet-config.json`: configuracion publica del proyecto Firebase.
- `firebase-blueprint.json`: esquema descriptivo de entidades y colecciones.
- `env.example`: variables necesarias para EmailJS.
- `Public/manifest.json`: manifest PWA.

Nota: el proyecto usa carpetas `SRC` y `Public` con mayusculas. Respeta esos nombres al referenciar archivos.

## Comandos

Instalar dependencias:

```bash
npm install
```

Ejecutar en desarrollo:

```bash
npm run dev
```

La app queda configurada para Vite en el puerto `3000` y host `0.0.0.0`.

Validar TypeScript:

```bash
npm run lint
```

Crear build:

```bash
npm run build
```

Vista previa de build:

```bash
npm run preview
```

Advertencia: el script `clean` usa `rm -rf dist`, que no es nativo de PowerShell en Windows. Si necesitas limpiar en Windows, usa una alternativa segura equivalente.

## Variables de entorno

El archivo `env.example` documenta:

```bash
VITE_EMAILJS_SERVICE_ID=
VITE_EMAILJS_TEMPLATE_ID=
VITE_EMAILJS_PUBLIC_KEY=
VITE_ADMIN_EMAIL=w.medinaconsorcio@gmail.com
```

EmailJS es opcional para que la app funcione, pero si falta configuracion no se enviaran correos de alerta. El sistema tambien guarda alertas en Firestore como respaldo.

## Firebase y datos

La app usa estas colecciones principales:

- `authorized_users`: usuarios permitidos y rol (`admin` o `user`).
- `employees`: empleados.
- `epp_catalog`: catalogo e inventario de EPP.
- `deliveries`: entregas registradas.
- `alerts`: alertas internas.
- `test`: lectura de prueba para conexion.

Reglas actuales:

- Cualquier usuario autenticado puede leer `authorized_users`, `employees`, `epp_catalog`, `deliveries`, `alerts` y `test`.
- Cualquier usuario autenticado puede crear entregas y alertas.
- Solo admins pueden escribir empleados, catalogo y usuarios autorizados.
- Solo admins pueden actualizar o borrar entregas y alertas.
- El correo `elniger26@gmail.com` esta hardcodeado como superadmin tanto en frontend como en reglas.

Al cambiar reglas o flujos de permisos, revisa tambien la logica `isAdmin` e `isAuthorized` dentro de `SRC/App.tsx`.

## Comportamiento clave de la app

- La pantalla principal esta dividida por pestanas: entrega, historial, alertas y administracion.
- El flujo de entrega busca empleado, selecciona EPP, captura firma y guarda entrega.
- Al guardar una entrega se descuenta stock del catalogo.
- Hay validaciones de frecuencia para botas y guantes, con advertencias antes de continuar.
- Las alertas se guardan en Firestore y, si EmailJS esta configurado, tambien se notifican por correo.
- El historial y catalogo se pueden exportar a Excel.
- Admin puede vaciar historial, vaciar catalogo, corregir datos de talla/stock y administrar usuarios.

## Convenciones de implementacion

- Mantener los cambios pequenos y localizados. `SRC/App.tsx` es grande; evita refactors amplios si la tarea no los pide.
- Reutilizar componentes, estilos e iconos existentes antes de introducir nuevos patrones.
- Usar `lucide-react` para iconos.
- Mantener el texto de UI en espanol.
- Cuidar mobile: la app tiene navegacion inferior movil y layouts responsivos con Tailwind.
- No introducir secretos reales en el repositorio. La configuracion Firebase client-side es publica, pero claves privadas o credenciales de servicios no deben agregarse.
- Si se tocan entregas, stock o permisos, probar tambien el caso de usuario no admin.

## Riesgos y detalles a vigilar

- Hay texto en espanol con caracteres aparentemente mal codificados en varios archivos. Antes de hacer cambios masivos de texto, confirmar encoding y evitar mezclar correcciones accidentales con cambios funcionales.
- `main.tsx` registra `/sw.js`, pero en `Public` no se ve un `sw.js`. Si la PWA falla, revisar ese archivo o ajustar el registro.
- `manifest.json` usa iconos remotos de Wikimedia. Para una PWA mas robusta conviene usar assets locales.
- Hay un archivo `Public/Unconfirmed 497903.crdownload`, probablemente una descarga incompleta. No depender de el.
- El repo contiene `gitignore.txt`, no `.gitignore`. Si se necesita ignorar archivos realmente, crear o renombrar con cuidado.
- `firebase-applet-config.json` incluye configuracion publica de Firebase. No tratarla como secreto, pero tampoco agregar credenciales sensibles junto a ella.

## Verificacion recomendada antes de entregar cambios

1. Ejecutar `npm run lint`.
2. Ejecutar `npm run build`.
3. Si hubo cambios visuales, abrir la app local en `http://localhost:3000` y revisar escritorio y movil.
4. Si hubo cambios en Firebase, probar con usuario admin y usuario comun cuando sea posible.
5. Si hubo cambios en exportaciones, descargar el Excel y abrirlo para revisar columnas y datos.

## Notas para futuros agentes

- Prioriza entender `SRC/App.tsx` por secciones antes de editar.
- Busca nombres de handlers con `rg "const handle" SRC/App.tsx` o colecciones con `rg "collection\\(db" SRC/App.tsx`.
- Para cambios grandes, considera extraer componentes o helpers de forma incremental, pero solo si reduce riesgo real.
- Si necesitas agregar datos iniciales, revisa primero `seedInitialData` en `SRC/App.tsx`.
- No borres ni reemplaces reglas de Firestore sin conservar la intencion de permisos actual.
