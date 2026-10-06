## Sistema de Captura y Gestión de Aclaraciones Bancarias

Sistema web interno para capturar, consultar y reportar aclaraciones bancarias
(reclamaciones de usuarios), diseñado para reemplazar la captura manual en
hojas de cálculo por un flujo centralizado con folio único, respaldo
automático y generación de los reportes operativos y regulatorios que el
área entrega de forma recurrente.

### Componentes

- **`servidor.js`** — Backend en Node.js/Express. Expone los endpoints REST,
  aplica las reglas de negocio, guarda la información en SQLite y sincroniza
  en tiempo real a todos los clientes conectados mediante Socket.io.
- **`index.html`** — Formulario de captura que usan los capturistas para dar
  de alta cada aclaración, con validaciones en el navegador, autocompletado
  desde un catálogo de sucursales y detección de posibles duplicados antes
  de guardar.
- **`dashboard.html`** — Panel de administración y supervisión: consulta de
  registros, edición individual y masiva, papelera de recuperación,
  estadísticas en vivo y generación de reportes (Excel, PDF, Word).

### Cómo funciona

1. El capturista llena el formulario (`index.html`) y lo envía al servidor.
2. El servidor valida la información, calcula datos derivados (entidad,
   código postal, municipio a partir del catálogo de sucursales), asigna un
   folio único (`letra_capturista + fecha + consecutivo`) y guarda el
   registro en SQLite.
3. El servidor notifica el cambio en tiempo real vía Socket.io, de forma
   que el dashboard de cualquier supervisor conectado se actualiza sin
   recargar la página.
4. Desde el dashboard se puede dar seguimiento al caso (estatus, respuesta,
   fechas de compensación y abono), editarlo, eliminarlo (con respaldo
   previo a una papelera recuperable) y generar los reportes periódicos:
   reporte por fecha, Bloqueos, DCI, R27 (CNBV), Concentrado Actual y
   validación de cadena de fechas.

### Reglas de negocio principales

- Cada folio es único por capturista y por día; solo una sesión activa por
  capturista a la vez.
- El canal de la reclamación (cajero, TPV, sucursal) determina qué motivos
  son válidos y qué campos se autocompletan.
- Ningún registro se elimina de forma definitiva sin pasar primero por una
  papelera de recuperación.
- Toda alta, edición o eliminación queda registrada en una bitácora de
  actividad por capturista.
- Las fechas de cada caso (movimiento, aclaración, recepción, respuesta,
  abono) se validan para que sigan una secuencia cronológica lógica.

### Tecnologías

Node.js, Express, SQLite (better-sqlite3), Socket.io, ExcelJS, PDFKit.

### Requisitos previos

- Node.js
- Variables de entorno configuradas (ver `.env.example`)

### Instalación

\`\`\`bash
npm install
node servidor.js
\`\`\`
