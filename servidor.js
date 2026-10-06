<!--// ==============================-->
 <!--* Proyecto: Sistema de Captura / TSU.-->
<!--* Arquitectura y Desarrollo Base (v1.0): J. Jesus Osorio Montufar.-->
 <!--* Fecha de creación: 2025.-->
<!--// ==============================-->



const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==============================
// CATÁLOGO DE SUCURSALES
// ==============================
const CATALOGO_PATH = path.join(__dirname, 'catalogo_sucursales.json');
let catalogoSucursales = {};

function cargarCatalogo() {
  try {
    if (fs.existsSync(CATALOGO_PATH)) {
      catalogoSucursales = JSON.parse(fs.readFileSync(CATALOGO_PATH, 'utf8'));
      console.log(`📚 Catálogo cargado: ${Object.keys(catalogoSucursales).length} sucursales`);
    } else {
      console.log('⚠️ Catálogo no encontrado en:', CATALOGO_PATH);
    }
  } catch(e) {
    console.error('❌ Error cargando catálogo:', e);
  }
}

function buscarEnCatalogo(refSucursal) {
  if (!refSucursal) return { entidad: '', cp: '', municipio: '', localidad: '' };
  const ref = String(refSucursal).trim();
  return catalogoSucursales[ref] || { entidad: '', cp: '', municipio: '', localidad: '' };
}


function obtenerClaveEntidad(refSucursal) {
  if (!refSucursal) return 0;
  const ref = String(refSucursal).trim();
  const entrada = catalogoSucursales[ref];
  if (!entrada) return 0;
  if (entrada.clave_entidad !== undefined && entrada.clave_entidad !== '') {
    return String(entrada.clave_entidad).padStart(2, '0');
  }
  return 0;
}


cargarCatalogo();

// ==============================
// BASE DE DATOS
// ==============================
const db = new Database(path.join(__dirname, 'aclaraciones.db'));

// ==============================
// BACKUP AUTOMÁTICO
// ==============================
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const DIAS_CONSERVAR = 90;
let registrosDesdeUltimoBackup = 0;
const REGISTROS_POR_BACKUP = 10;

const CAPTURISTA_EQUIPOS = {
  "P": "PEPE",
  "A": "AM",
  "Z": "CELINA",
  "W": "JESUSOSORIO",
  "S": "SU",
  "K": "EV",
  "J": "JESSICA"
};


// Crear carpeta de backups si no existe
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`📁 Carpeta de backups creada: ${BACKUP_DIR}`);
}

function hacerBackup(motivo = 'manual') {
  try {
    const ahora = new Date();
    const fecha = ahora.toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .slice(0, 19);
    const nombreArchivo = `aclaraciones_${fecha}_${motivo}.db`;
    const destino = path.join(BACKUP_DIR, nombreArchivo);
    fs.copyFileSync(path.join(__dirname, 'aclaraciones.db'), destino);
    console.log(`✅ Backup realizado: ${nombreArchivo}`);
    limpiarBackupsAntiguos();
    return nombreArchivo;
  } catch(e) {
    console.error('❌ Error al hacer backup:', e);
    return null;
  }
}

function limpiarBackupsAntiguos() {
  try {
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('aclaraciones_') && f.endsWith('.db'))
      .map(f => ({
        nombre: f,
        ruta: path.join(BACKUP_DIR, f),
        fecha: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.fecha - a.fecha);

    // Conservar solo los últimos 90 días laborales
    const limite = new Date();
    limite.setDate(limite.getDate() - DIAS_CONSERVAR);

    let eliminados = 0;
    archivos.forEach(archivo => {
      if (archivo.fecha < limite) {
        fs.unlinkSync(archivo.ruta);
        eliminados++;
        console.log(`🗑️ Backup antiguo eliminado: ${archivo.nombre}`);
      }
    });

    if (eliminados > 0) {
      console.log(`🧹 ${eliminados} backups antiguos eliminados.`);
    }
  } catch(e) {
    console.error('❌ Error al limpiar backups:', e);
  }
}



db.exec(`
  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT UNIQUE,
    fecha_recepcion TEXT,
    fecha_aclaracion TEXT,
    nombre_usuario TEXT,
    sexo TEXT,
    anio_nacimiento TEXT,
    ref_sucursal TEXT,
    sucursal TEXT,
    acuerdo TEXT,
    num_tarjeta TEXT,
    canal TEXT,
    desc_canal TEXT,
    motivo TEXT,
    desc_motivo TEXT,
    banco TEXT,
    ref_cajero TEXT,
    monto REAL,
    fecha_movimiento TEXT,
    entidad TEXT DEFAULT '',
    codigo_postal TEXT DEFAULT '',
    municipio TEXT DEFAULT '',
    localidad TEXT DEFAULT '',
    estatus TEXT,
    fecha_envio TEXT,
    fecha_estatus TEXT,
    respuesta TEXT DEFAULT '',
    fecha_respuesta_comp TEXT DEFAULT '',
    fecha_envio_respuesta TEXT DEFAULT '',
    fecha_abono TEXT DEFAULT '',
    observacion TEXT DEFAULT '',
    motivo_procedencia TEXT DEFAULT '',
    programa TEXT,
    localidad_cajero TEXT DEFAULT '',
    celular TEXT,
    bloqueo TEXT,
    capturista TEXT,
    num_tarjeta_transacciono TEXT DEFAULT '',
    canal_atencion TEXT DEFAULT '',
    fecha_guardado TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS log_actividad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capturista TEXT,
    accion TEXT,
    folio TEXT,
    fecha_hora TEXT,
    detalle TEXT
  )
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS registros_eliminados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT,
    fecha_eliminacion TEXT,
    eliminado_por TEXT,
    motivo TEXT,
    datos TEXT
  )
`);


// Agregar columna detalle si no existe (para bases de datos existentes)
try {
  db.prepare(`ALTER TABLE log_actividad ADD COLUMN detalle TEXT`).run();
} catch(e) {
  // Columna ya existe, ignorar
}

// Agregar columnas del catálogo si no existen
['entidad', 'codigo_postal', 'municipio', 'localidad', 'respuesta', 'fecha_respuesta_comp', 'fecha_envio_respuesta', 'fecha_abono', 'observacion', 'motivo_procedencia', 'localidad_cajero', 'num_tarjeta_transacciono', 'canal_atencion'].forEach(col => {
  try {
    db.prepare(`ALTER TABLE registros ADD COLUMN ${col} TEXT DEFAULT ''`).run();
    console.log(`✅ Columna ${col} agregada`);
  } catch(e) {
    // Columna ya existe, ignorar
  }
});

// Limpiar log de más de 90 días al arrancar
const fechaLimiteLog = new Date();
fechaLimiteLog.setDate(fechaLimiteLog.getDate() - 90);
db.prepare(`DELETE FROM log_actividad WHERE fecha_hora < ?`).run(fechaLimiteLog.toISOString());
console.log('🧹 Log de actividad limpiado (entradas > 90 días).');

// Backup al arrancar el servidor (después de inicializar la BD)
console.log('💾 Haciendo backup de arranque...');
hacerBackup('arranque');


// Corregir capturistas con formato incorrecto (fechas en lugar de letra)
const capturistasCorregidos = db.prepare(`
  UPDATE registros SET capturista = substr(folio, 1, 1) 
  WHERE length(capturista) > 1 OR capturista IS NULL OR capturista = ''
`).run();
if (capturistasCorregidos.changes > 0) {
  console.log(`✅ Capturistas corregidos al arrancar: ${capturistasCorregidos.changes} registros`);
}


// Poblar num_tarjeta_transacciono en registros que aún no la tengan
db.prepare(`
  UPDATE registros SET num_tarjeta_transacciono = num_tarjeta
  WHERE num_tarjeta_transacciono IS NULL OR num_tarjeta_transacciono = ''
`).run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_duplicado_llave1 
  ON registros(acuerdo, monto, fecha_movimiento);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_duplicado_llave2 
  ON registros(nombre_usuario, monto, fecha_movimiento);
`);


// ==============================
// WHITELIST DE IPs
// ==============================
const IPS_AUTORIZADAS = [
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '172.26.63.48',
  '::ffff:172.26.63.48'
];

const HOSTNAMES_AUTORIZADOS = [
  'CELINA',
  'JESUSOSORIO',
  'AMELIA',
  'DAVID',
  'AM',
  'JESSICA',
  'ANA',
  'SU',
  'EV',
  'BCP',
  'ARTURO'
];

const dns = require('dns');

function verificarIP(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const ipLimpia = ip.replace('::ffff:', '');

  // Primero verificar si la IP está directamente autorizada
  if (IPS_AUTORIZADAS.some(ipAuth => ipAuth === ip || ipAuth === ipLimpia)) {
    return next();
  }

  // Si no, resolver el hostname de la IP y verificar si está autorizado
  dns.reverse(ipLimpia, (err, hostnames) => {
    if (err) {
      console.log(`❌ Acceso denegado desde IP: ${ipLimpia} (no se pudo resolver hostname)`);
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }

    const hostnameCliente = hostnames[0]?.split('.')[0].toUpperCase();
    console.log(`🔍 Hostname detectado: ${hostnameCliente}`);

    if (HOSTNAMES_AUTORIZADOS.includes(hostnameCliente)) {
      return next();
    } else {
      console.log(`❌ Acceso denegado: ${hostnameCliente} no está autorizado`);
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }
  });
}

// ==============================
// MIDDLEWARE
// ==============================
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    express.json({ limit: '50mb' })(req, res, next);
  } else if (contentType.includes('multipart/form-data')) {
    next();
  } else {
    express.text({ type: '*/*', limit: '50mb' })(req, res, next);
  }
});

// Contraseña de acceso al sistema
const ACCESO_PASSWORD = 'TSU2026'; //

// Sesiones simples en memoria
const sesionesActivas = new Set();
const capturistasActivos = new Map(); // letra -> { hostname, ip, desde }

function generarToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Página de login
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sistema TSU — Acceso</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #000000;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      color: #fff;
    }
    .login-box {
      background: #111111;
      border: 1px solid #7a1a35;
      border-radius: 12px;
      padding: 40px;
      width: 340px;
      text-align: center;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 8px;
      color: #ffffff;
    }
    p {
      color: #c47a8a;
      font-size: 0.85rem;
      margin-bottom: 24px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #7a1a35;
      background: #000000;
      color: #ffffff;
      font-size: 1rem;
      margin-bottom: 16px;
      outline: none;
    }
    input[type="password"]:focus {
      border-color: #f9a8b8;
    }
    button {
      width: 100%;
      padding: 12px;
      background: #7a1a35;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #9a2040; }
    .error {
      color: #f9a8b8;
      font-size: 0.82rem;
      margin-top: 12px;
      min-height: 18px;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>📊 Servidor GA</h1>
    <p>Ingresa la contraseña de acceso</p>
    <input type="password" id="pwd" placeholder="Contraseña" onkeydown="if(event.key==='Enter') acceder()">
    <button onclick="acceder()">Entrar</button>
    <div class="error" id="error"></div>
  </div>
  <script>
    async function acceder() {
      const pwd = document.getElementById('pwd').value;
      const resp = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await resp.json();
      if (data.ok) {
        document.cookie = 'tsu_token=' + data.token + '; path=/';
        window.location.href = data.redirect || '/';
      } else {
        document.getElementById('error').textContent = '❌ Contraseña incorrecta.';
      }
    }
  </script>
</body>
</html>`);
});

// Verificar si capturista ya está activo
app.post('/capturista/iniciar', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  const { letra, forzar, hostname, browserId } = body || {};

  if (!letra) return res.json({ ok: false, error: 'Letra requerida' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');

  console.log(`🔑 Iniciar: letra=${letra} ip=${ip} browserId=${browserId} forzar=${forzar}`);

  if (capturistasActivos.has(letra)) {
    const info = capturistasActivos.get(letra);
    // Permitir solo si es el mismo navegador (mismo browserId) Y misma IP
    const mismoNavegador = browserId && info.browserId && info.browserId === browserId;
    const mismaIP = info.ip === ip;

    if (forzar && mismoNavegador && mismaIP) {
      // Es un refresh del mismo navegador — actualizar timestamp
      capturistasActivos.set(letra, {
        ...info,
        desde: new Date().toLocaleTimeString('es-MX')
      });
      console.log(`🔄 Refresh permitido: ${letra} desde ${ip}`);
      return res.json({ ok: true });
    }

    // Es otra PC u otro navegador — bloquear
    console.log(`🚫 Bloqueado: ${letra} ya activo en ${info.hostname} (${info.ip})`);
    return res.json({
      ok: false,
      error: `El capturista ${letra} ya tiene sesión activa desde ${info.hostname} (${info.ip}) desde las ${info.desde}`
    });
  }

  // No hay sesión activa — registrar
  capturistasActivos.set(letra, {
    hostname: hostname || CAPTURISTA_EQUIPOS[letra] || 'desconocido',
    ip,
    desde: new Date().toLocaleTimeString('es-MX'),
    browserId: browserId || null
});

  console.log(`✅ Sesión iniciada: ${letra} desde ${ip}`);
  res.json({ ok: true });
});

// Ver capturistas activos
app.get('/capturistas/activos', (req, res) => {
  const activos = [];
  capturistasActivos.forEach((info, letra) => {
    activos.push({ letra, ...info });
  });
  res.json({ activos, total: activos.length });
});

// Limpiar capturista atascado (solo admin)
app.post('/capturista/limpiar', (req, res) => {
  const { letra } = req.body;
  if (!letra) return res.json({ ok: false });
  capturistasActivos.delete(letra);
  res.json({ ok: true, mensaje: `Sesión de ${letra} liberada.` });
});

// Registrar acción en el log
app.post('/log', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  const { capturista, accion, folio, detalle } = body || {};
  if (!capturista || !accion || !folio) return res.json({ ok: false });
  try {
    const fechaHora = new Date().toISOString();
    const detalleStr = detalle ? JSON.stringify(detalle) : null;
    db.prepare(`INSERT INTO log_actividad (capturista, accion, folio, fecha_hora, detalle) VALUES (?, ?, ?, ?, ?)`)
      .run(capturista, accion, folio, fechaHora, detalleStr);
    io.emit('nuevo_log', { capturista, accion, folio, fecha_hora: fechaHora, detalle: detalle || null });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Consultar log
app.get('/log', (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM log_actividad ORDER BY id DESC LIMIT 15000`).all();
    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Liberar capturista al cerrar sesión
app.post('/capturista/cerrar', (req, res) => {
  let letra;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    letra = body?.letra;
  } catch(e) {
    return res.json({ ok: false });
  }
  if (!letra) return res.json({ ok: false });
  capturistasActivos.delete(letra);
  res.json({ ok: true });
});

// Endpoint de autenticación
app.post('/auth', (req, res) => {
  const { password, redirect } = req.body;
  if (password === ACCESO_PASSWORD) {
    const token = generarToken();
    sesionesActivas.add(token);
    // Token expira en 8 horas
    setTimeout(() => sesionesActivas.delete(token), 8 * 60 * 60 * 1000);
    res.json({ ok: true, token, redirect: redirect || '/' });
  } else {
    res.json({ ok: false });
  }
});

// Middleware de autenticación para archivos estáticos
function verificarSesion(req, res, next) {
  // Permitir siempre el login y el endpoint de auth
  if (req.path === '/login' || req.path === '/auth') return next();

  // Leer cookie
  const cookies = req.headers.cookie || '';
  const tokenMatch = cookies.match(/tsu_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  if (token && sesionesActivas.has(token)) {
    return next();
  }

  // Si es una petición a la API, devolver 401
  if (req.path.startsWith('/registros') || req.path.startsWith('/folio') || 
      req.path.startsWith('/reporte') || req.path.startsWith('/log') ||
      req.path.startsWith('/backup') || req.path.startsWith('/importar') ||
      req.path.startsWith('/catalogo') || req.path.startsWith('/capturista')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // Si es una página HTML, redirigir al login
  res.redirect('/login');
}

app.use(verificarSesion);
app.use(express.static(path.join(__dirname, 'public')));


// ==============================
// ENDPOINTS
// ==============================



// Generar el folio del día de forma atómica (misma conexión, mismo hilo síncrono, sin await de por medio)
function generarFolioAtomico(letra) {
  const hoy = new Date();
  const d = String(hoy.getDate()).padStart(2, '0');
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const y = hoy.getFullYear();
  const prefijo = `${letra}${d}${m}${y}_`;

  const row = db.prepare(`
    SELECT folio FROM registros
    WHERE folio LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(prefijo + '%');

  let siguiente = 1;
  if (row) {
    const num = parseInt(row.folio.split('_')[1], 10);
    if (!isNaN(num)) siguiente = num + 1;
  }
  return `${prefijo}${String(siguiente).padStart(2, '0')}`;
}

const stmtInsertRegistro = db.prepare(`
  INSERT OR REPLACE INTO registros (
    folio, fecha_recepcion, fecha_aclaracion,
    nombre_usuario, sexo, anio_nacimiento, ref_sucursal,
    sucursal, acuerdo, num_tarjeta, canal, desc_canal,
    motivo, desc_motivo, banco, ref_cajero, monto,
    fecha_movimiento, entidad, codigo_postal, municipio, localidad,
    estatus, fecha_envio, fecha_estatus,
    respuesta, fecha_respuesta_comp, fecha_envio_respuesta, fecha_abono,
    observacion, motivo_procedencia,
    programa, localidad_cajero, celular, bloqueo, capturista, num_tarjeta_transacciono, fecha_guardado
  ) VALUES (
    @folio, @fecha_recepcion, @fecha_aclaracion,
    @nombre_usuario, @sexo, @anio_nacimiento, @ref_sucursal,
    @sucursal, @acuerdo, @num_tarjeta, @canal, @desc_canal,
    @motivo, @desc_motivo, @banco, @ref_cajero, @monto,
    @fecha_movimiento, @entidad, @codigo_postal, @municipio, @localidad,
    @estatus, @fecha_envio, @fecha_estatus,
    @respuesta, @fecha_respuesta_comp, @fecha_envio_respuesta, @fecha_abono,
    @observacion, @motivo_procedencia,
    @programa, @localidad_cajero, @celular, @bloqueo, @capturista, @num_tarjeta_transacciono, @fecha_guardado
  )
`);

// Transacción: si es alta (sin folio de cliente), genera el folio Y guarda en el MISMO
// bloque síncrono. Al no haber ningún "await" entre leer el último folio e insertar,
// ninguna otra petición puede colarse en medio (Node procesa esto sin ceder el hilo).
const guardarRegistroAtomico = db.transaction((r) => {
  const esEdicion = !!(r["Folio de continuidad"] && r["Folio de continuidad"].trim() !== "");
  const capturistaRaw = (r["capturista"] || "").trim();

  let folioFinal;
  if (esEdicion) {
    folioFinal = r["Folio de continuidad"];
  } else {
    if (!capturistaRaw) throw new Error('Falta el capturista para generar el folio');
    folioFinal = generarFolioAtomico(capturistaRaw.charAt(0).toUpperCase());
  }

  const registroExistente = db.prepare(`SELECT id FROM registros WHERE folio = ?`).get(folioFinal);
  const capturistaSano = (capturistaRaw.length === 1) ? capturistaRaw : folioFinal.charAt(0);

  stmtInsertRegistro.run({
    folio: folioFinal,
    fecha_recepcion: r["Fecha de recepción de correo"],
    fecha_aclaracion: r["Fecha de aclaración sucursal"],
    nombre_usuario: r["Nombre del Usuario"],
    sexo: r["Sexo"],
    anio_nacimiento: r["Año de nacimiento"],
    ref_sucursal: r["Referencia de sucursal"],
    sucursal: r["Sucursal"],
    acuerdo: r["Acuerdo"],
    num_tarjeta: r["Número de tarjeta"],
    canal: r["Canal"],
    desc_canal: r["Descripción del canal"],
    motivo: r["Motivo de reclamación"],
    desc_motivo: r["Descripción de motivo de reclamación"],
    banco: r["Banco/establecimiento"],
    ref_cajero: r["Referencia del cajero/establecimientio"],
    monto: r["Monto"],
    fecha_movimiento: r["Fecha del movimiento"],
    estatus: r["Estatus"],
    fecha_envio: r["Fecha de envío a compensación"],
    fecha_estatus: r["Fecha de estatus a sucursal"],
    programa: r["Nombre del programa"],
    celular: r["N. CELULAR"],
    bloqueo: r["Bloqueo de tarjeta"],
    entidad: r["Entidad"] || buscarEnCatalogo(r["Referencia de sucursal"]).entidad,
    codigo_postal: r["Código Postal"] || buscarEnCatalogo(r["Referencia de sucursal"]).cp,
    municipio: r["Municipio"] || buscarEnCatalogo(r["Referencia de sucursal"]).municipio,
    localidad: r["Localidad"] || buscarEnCatalogo(r["Referencia de sucursal"]).localidad,
    respuesta: r["RESPUESTA"] || "",
    fecha_respuesta_comp: r["FECHA DE RESPUESTA POR COMP. Y LIQUIDACIÓN"] || "",
    fecha_envio_respuesta: r["FECHA ENVÍO DE RESPUESTA A SUCURSAL"] || "",
    fecha_abono: r["FECHA ABONO"] || "",
    observacion: r["OBSERVACIÓN"] || "",
    motivo_procedencia: r["Motivo procedencia/improcedencia"] || "",
    localidad_cajero: r["LOCALIDAD CAJERO"] || "",
    num_tarjeta_transacciono: r["N. DE TARJETA QUE TRANSACCIONÓ"] || r["Número de tarjeta"] || "",
    capturista: capturistaSano,
    fecha_guardado: new Date().toISOString()
  });

  return { folioFinal, esNuevo: !registroExistente };
});

// Guardar un registro nuevo o editado
app.post('/registros', verificarIP, (req, res) => {
  try {
    const { folioFinal, esNuevo } = guardarRegistroAtomico(req.body);

    // Emitir evento correcto según si es alta o edición
    const registroGuardado = db.prepare('SELECT * FROM registros WHERE folio = ?').get(folioFinal);
    const rEmitir = mapearRegistro(registroGuardado);
    if (!esNuevo) {
      io.emit('registro_actualizado', rEmitir);
    } else {
      io.emit('nuevo_registro', rEmitir);
      // Backup cada 10 registros nuevos
      registrosDesdeUltimoBackup++;
      if (registrosDesdeUltimoBackup >= REGISTROS_POR_BACKUP) {
        registrosDesdeUltimoBackup = 0;
        hacerBackup('auto');
      }
    }

    res.json({ ok: true, folio: folioFinal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// Traer todos los registros
app.get('/registros', verificarIP, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM registros ORDER BY id ASC').all();
    const registros = rows.map(r => mapearRegistro(r));
    res.json(registros);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Eliminar masivamente por rango de fechas
app.delete('/registros/rango', verificarIP, (req, res) => {
  try {
    const desde = req.query.desde || '';
    const hasta = req.query.hasta || '';

    if (!desde || !hasta) return res.status(400).json({ error: 'Fechas requeridas' });

    const parseFecha = (f) => {
      const [y,m,d] = f.split('-');
      return `${d}/${m}/${y}`;
    };
    const desdeStr = parseFecha(desde);
    const hastaStr = parseFecha(hasta);

    // Obtener folios antes de eliminar para emitir eventos
    const folios = db.prepare(`
      SELECT folio FROM registros 
      WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
        AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
    `).all(desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr);

    // Guardar en eliminados antes de borrar
    const registrosAEliminar = db.prepare(`
      SELECT * FROM registros 
      WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
        AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
    `).all(desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr);

    const stmtElim = db.prepare(`
      INSERT INTO registros_eliminados (folio, fecha_eliminacion, eliminado_por, motivo, datos)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertarEliminados = db.transaction((rows) => {
      rows.forEach(r => stmtElim.run(r.folio, new Date().toISOString(), 'DASHBOARD', 'Eliminación por rango', JSON.stringify(r)));
    });
    insertarEliminados(registrosAEliminar);

    const resultado = db.prepare(`
      DELETE FROM registros 
      WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
        AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
            <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
    `).run(desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr);

    // Emitir evento para cada folio eliminado
    folios.forEach(f => io.emit('registro_eliminado', { folio: f.folio }));

    console.log(`🗑️ Eliminados masivamente: ${resultado.changes} registros`);
    res.json({ ok: true, eliminados: resultado.changes });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Eliminar todos los registros
app.delete('/registros/todos', verificarIP, (req, res) => {
  try {
    const todosParaEliminar = db.prepare('SELECT * FROM registros').all();
    const stmtElimTodos = db.prepare(`
      INSERT INTO registros_eliminados (folio, fecha_eliminacion, eliminado_por, motivo, datos)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertarTodos = db.transaction((rows) => {
      rows.forEach(r => stmtElimTodos.run(r.folio, new Date().toISOString(), 'DASHBOARD', 'Eliminación total', JSON.stringify(r)));
    });
    insertarTodos(todosParaEliminar);
    const resultado = db.prepare(`DELETE FROM registros`).run();
    io.emit('registros_vaciados', {});
    console.log(`🗑️ Eliminados TODOS: ${resultado.changes} registros`);
    res.json({ ok: true, eliminados: resultado.changes });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



// Eliminar un registro por folio
app.delete('/registros/:folio', verificarIP, (req, res) => {
  try {
    const folio = req.params.folio;
    const eliminadoPor = req.query.eliminado_por || 'DASHBOARD';
    const motivo = req.query.motivo || '';

    const registro = db.prepare('SELECT * FROM registros WHERE folio = ?').get(folio);
    if (registro) {
      db.prepare(`
        INSERT INTO registros_eliminados (folio, fecha_eliminacion, eliminado_por, motivo, datos)
        VALUES (?, ?, ?, ?, ?)
      `).run(folio, new Date().toISOString(), eliminadoPor, motivo, JSON.stringify(registro));
    }

    db.prepare('DELETE FROM registros WHERE folio = ?').run(folio);
    io.emit('registro_eliminado', { folio });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Backup manual
app.post('/backup', verificarIP, (req, res) => {
  const archivo = hacerBackup('manual');
  if (archivo) {
    res.json({ ok: true, archivo });
  } else {
    res.status(500).json({ ok: false, error: 'Error al hacer backup' });
  }
});

// Ver lista de backups
app.get('/backups', verificarIP, (req, res) => {
  try {
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('aclaraciones_') && f.endsWith('.db'))
      .map(f => ({
        nombre: f,
        fecha: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
        tamaño: Math.round(fs.statSync(path.join(BACKUP_DIR, f)).size / 1024) + ' KB'
      }))
      .sort((a, b) => b.fecha - a.fecha);
    res.json(archivos);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Generar folio único
app.get('/folio/:letra', verificarIP, (req, res) => {
  try {
    const letra = req.params.letra;
    const hoy = new Date();
    const d = String(hoy.getDate()).padStart(2, '0');
    const m = String(hoy.getMonth() + 1).padStart(2, '0');
    const y = hoy.getFullYear();
    const prefijo = `${letra}${d}${m}${y}_`;

    const row = db.prepare(`
      SELECT folio FROM registros 
      WHERE folio LIKE ? 
      ORDER BY id DESC LIMIT 1
    `).get(prefijo + '%');

    let siguiente = 1;
    if (row) {
      const num = parseInt(row.folio.split('_')[1], 10);
      if (!isNaN(num)) siguiente = num + 1;
    }

    res.json({ folio: `${prefijo}${String(siguiente).padStart(2, '0')}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ==============================
// REPORTES
// ==============================
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, WidthType, BorderStyle, HeadingLevel } = require('docx');

const CAPTURISTA_NOMBRES_REPORTE = {
  "P": "Jose Luis Meléndez Plancarte",
  "A": "Ángela Montero Oscoy",
  "Z": "Celina Sofía López Sánchez",
  "W": "J. Jesús Osorio Montúfar",
  "S": "Susana Hernández Guzmán",
  "K": "Eileen Virginia Barbosa Blancas",
  "J": "Jessica García Vargas",
  "X": "Iliana",
  "R": "Ana Karen Guadalupe",
  "V": "Victoria",
  "L": "Lorena",
  "Y": "Y",
  "C": "C"
};

function obtenerRangoFechas(tipo, fecha) {
  const d = new Date(fecha + 'T12:00:00');
  let inicio, fin, etiqueta, columnas = [];

  if (tipo === 'diario') {
    inicio = new Date(d); inicio.setHours(0,0,0,0);
    fin = new Date(d); fin.setHours(23,59,59,999);
    const nombreDia = d.toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    etiqueta = nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1);
    columnas = [{ label: etiqueta, fecha: fecha }];
  }
  else if (tipo === 'semanal') {
    // Lunes de la semana
    const dia = d.getDay();
    const diffLunes = dia === 0 ? -6 : 1 - dia;
    const lunes = new Date(d); lunes.setDate(d.getDate() + diffLunes); lunes.setHours(0,0,0,0);
    inicio = lunes;
    // Viernes
    const viernes = new Date(lunes); viernes.setDate(lunes.getDate() + 4); viernes.setHours(23,59,59,999);
    fin = viernes;
    const opts = { day:'numeric', month:'short', year:'numeric' };
    etiqueta = `semana del ${lunes.toLocaleDateString('es-MX', opts)} al ${viernes.toLocaleDateString('es-MX', opts)}`;
    for (let i = 0; i < 5; i++) {
      const dia = new Date(lunes); dia.setDate(lunes.getDate() + i);
      const yyyy = dia.getFullYear();
      const mm = String(dia.getMonth()+1).padStart(2,'0');
      const dd = String(dia.getDate()).padStart(2,'0');
      const label = dia.toLocaleDateString('es-MX', { weekday:'short', day:'numeric' });
      columnas.push({ label: label.charAt(0).toUpperCase() + label.slice(1), fecha: `${yyyy}-${mm}-${dd}` });
    }
  }
  else if (tipo === 'mensual') {
    const anio = d.getFullYear(), mes = d.getMonth();
    inicio = new Date(anio, mes, 1, 0, 0, 0);
    fin = new Date(anio, mes + 1, 0, 23, 59, 59);
    etiqueta = d.toLocaleDateString('es-MX', { month:'long', year:'numeric' });
    etiqueta = etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1);
    const diasEnMes = fin.getDate();
    for (let i = 1; i <= diasEnMes; i++) {
      const dia = new Date(anio, mes, i);
      const yyyy = dia.getFullYear();
      const mm = String(dia.getMonth()+1).padStart(2,'0');
      const dd = String(dia.getDate()).padStart(2,'0');
      columnas.push({ label: `${dd}`, fecha: `${yyyy}-${mm}-${dd}` });
    }
  }
  else if (tipo === 'anual') {
    const anio = d.getFullYear();
    inicio = new Date(anio, 0, 1, 0, 0, 0);
    fin = new Date(anio, 11, 31, 23, 59, 59);
    etiqueta = `año ${anio}`;
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    for (let m = 0; m < 12; m++) {
      const primerDia = new Date(anio, m, 1);
      const yyyy = primerDia.getFullYear();
      const mm = String(primerDia.getMonth()+1).padStart(2,'0');
      columnas.push({ label: meses[m], fecha: `${yyyy}-${mm}-01`, mes: m });
    }
  }

  return { inicio, fin, etiqueta, columnas };
}

function obtenerDatosReporte(tipo, fecha) {
  const { inicio, fin, etiqueta, columnas } = obtenerRangoFechas(tipo, fecha);

  const inicioStr = `${String(inicio.getDate()).padStart(2,'0')}/${String(inicio.getMonth()+1).padStart(2,'0')}/${inicio.getFullYear()}`;
  const finStr = `${String(fin.getDate()).padStart(2,'0')}/${String(fin.getMonth()+1).padStart(2,'0')}/${fin.getFullYear()}`;
  const registros = db.prepare(`
    SELECT * FROM registros
    WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2)
          >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
      AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2)
          <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
  `).all(inicioStr, inicioStr, inicioStr, finStr, finStr, finStr);

  // Construir datos por capturista y columna
  const datos = {};
  Object.keys(CAPTURISTA_NOMBRES_REPORTE).forEach(letra => {
    datos[letra] = { nombre: CAPTURISTA_NOMBRES_REPORTE[letra], columnas: {}, total: 0 };
    columnas.forEach(col => { datos[letra].columnas[col.fecha] = 0; });
  });

  registros.forEach(r => {
    const letra = r.capturista;
    if (!letra || !datos[letra]) return;
    const partesFecha = (r.fecha_recepcion || '').split('/');
    const fechaGuardado = partesFecha.length === 3
      ? new Date(`${partesFecha[2]}-${partesFecha[1]}-${partesFecha[0]}T12:00:00`)
      : new Date(r.fecha_guardado);

    if (tipo === 'anual') {
      const yyyy = fechaGuardado.getFullYear();
      const mm = String(fechaGuardado.getMonth() + 1).padStart(2, '0');
      const fechaMes = `${yyyy}-${mm}-01`;
      if (datos[letra].columnas[fechaMes] !== undefined) {
        datos[letra].columnas[fechaMes]++;
        datos[letra].total++;
      }
    }else {
      const yyyy = fechaGuardado.getFullYear();
      const mm = String(fechaGuardado.getMonth()+1).padStart(2,'0');
      const dd = String(fechaGuardado.getDate()).padStart(2,'0');
      const fechaStr = `${yyyy}-${mm}-${dd}`;
      if (datos[letra].columnas[fechaStr] !== undefined) {
        datos[letra].columnas[fechaStr]++;
        datos[letra].total++;
      }
    }
  });

  // Filtrar capturistas sin capturas
  const datosConCapturas = Object.entries(datos)
    .filter(([, d]) => d.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  const totalGeneral = datosConCapturas.reduce((acc, [, d]) => acc + d.total, 0);
  const numDias = tipo === 'semanal' ? 5 : tipo === 'diario' ? 1 : columnas.length;

  return { datosConCapturas, columnas, etiqueta, totalGeneral, numDias, tipo };
}

function textoIntroductorio(tipo, etiqueta) {
  const textos = {
    diario: `Les comparto el Informe de desempeño del Canal TChip por Agente, correspondiente al ${etiqueta}.`,
    semanal: `Les comparto el Informe de desempeño del Canal TChip por Agente, correspondiente a la ${etiqueta}.`,
    mensual: `Les comparto el Informe de desempeño del Canal TChip por Agente, correspondiente al mes de ${etiqueta}.`,
    anual: `Les comparto el Informe de desempeño del Canal TChip por Agente, correspondiente al ${etiqueta}.`
  };
  return textos[tipo] || '';
}

// ---- FUNCIÓN GENERAR IMAGEN GRÁFICA ----
async function generarGraficaPNG(datosConCapturas, totalGeneral) {
  const { createCanvas } = require('canvas');
  const scale = 2;
  const width = 900 * scale;
  const height = 650 * scale;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 500);

  const colores = ['#7a1a35','#1a3a7a','#f9a8b8','#ffd54f','#a5d6a7','#ffb74d','#ce93d8','#80cbc4','#ff8a65'];
  const cx = 220, cy = 220, radius = 200;
  let startAngle = -Math.PI / 2;

  datosConCapturas.forEach(([, d], i) => {
    if (totalGeneral === 0) return;
    const sliceAngle = (d.total / totalGeneral) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colores[i % colores.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    const pct = Math.round(d.total / totalGeneral * 100);
    if (pct >= 5) {
      const midAngle = startAngle + sliceAngle / 2;
      const lx = cx + (radius * 0.65) * Math.cos(midAngle);
      const ly = cy + (radius * 0.65) * Math.sin(midAngle);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pct}%`, lx, ly);
    }
    startAngle = endAngle;
  });

  // Leyenda en 2 columnas
  const totalEntradas = datosConCapturas.length;
  const mitad = Math.ceil(totalEntradas / 2);
  const colLey = [460, 700]; // X de cada columna
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  datosConCapturas.forEach(([, d], i) => {
    const pct = totalGeneral > 0 ? (d.total / totalGeneral * 100).toFixed(1) : 0;
    const col = i < mitad ? 0 : 1;
    const fila = i < mitad ? i : i - mitad;
    const lx = colLey[col];
    const ly = 40 + fila * 44;
    ctx.fillStyle = colores[i % colores.length];
    ctx.fillRect(lx, ly - 7, 12, 12);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly - 7, 12, 12);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 14px Arial';
    const nombre = d.nombre.length > 26 ? d.nombre.slice(0, 24) + '...' : d.nombre;
    ctx.fillText(nombre, lx + 18, ly - 2);
    ctx.fillStyle = '#333333';
    ctx.font = '13px Arial';
    ctx.fillText(`${d.total} capturas (${pct}%)`, lx + 18, ly + 13);
  });

  return canvas.toBuffer('image/png');
}


// ---- ENDPOINT EXCEL ----
app.get('/reporte/excel', verificarIP, async (req, res) => {
  try {
    const { tipo = 'semanal', fecha = new Date().toISOString().slice(0,10) } = req.query;
    const { datosConCapturas, columnas, etiqueta, totalGeneral, numDias } = obtenerDatosReporte(tipo, fecha);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Reporte');

    // Título
    ws.mergeCells(1, 1, 1, columnas.length + 3);
    const tituloCell = ws.getCell('A1');
    tituloCell.value = 'INFORME DE DESEMPEÑO — SISTEMA TSU';
    tituloCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a3a7a' } };
    tituloCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // Subtítulo
    ws.mergeCells(2, 1, 2, columnas.length + 3);
    const subCell = ws.getCell('A2');
    subCell.value = textoIntroductorio(tipo, etiqueta);
    subCell.font = { italic: true, size: 11 };
    subCell.alignment = { horizontal: 'center', wrapText: true };
    ws.getRow(2).height = 40;

    // Encabezados tabla
    const headerRow = ws.getRow(4);
    headerRow.getCell(1).value = 'NOMBRE';
    columnas.forEach((col, i) => { headerRow.getCell(i + 2).value = col.label; });
    headerRow.getCell(columnas.length + 2).value = 'TOTAL';
    headerRow.getCell(columnas.length + 3).value = 'PROM x DÍA';
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7a1a35' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    });
    ws.getRow(4).height = 20;

    // Datos
    datosConCapturas.forEach(([, d], rowIdx) => {
      const row = ws.getRow(5 + rowIdx);
      row.getCell(1).value = d.nombre;
      columnas.forEach((col, i) => {
        const val = d.columnas[col.fecha] || 0;
        row.getCell(i + 2).value = val || '';
      });
      row.getCell(columnas.length + 2).value = d.total;
      const diasConCapturasExcel = columnas.filter(col => (d.columnas[col.fecha] || 0) > 0).length || 1;
      row.getCell(columnas.length + 3).value = Math.round(d.total / diasConCapturasExcel);
      row.eachCell(cell => {
        cell.alignment = { horizontal: 'center' };
        cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        if (rowIdx % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF8F0F3' } };
      });
      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(columnas.length + 2).font = { bold: true };
    });

    // Fila totales
    const totalRowIdx = 5 + datosConCapturas.length;
    const totalRow = ws.getRow(totalRowIdx);
    totalRow.getCell(1).value = 'TOTAL';
    columnas.forEach((col, i) => {
      const sumCol = datosConCapturas.reduce((acc, [, d]) => acc + (d.columnas[col.fecha] || 0), 0);
      totalRow.getCell(i + 2).value = sumCol;
    });
    totalRow.getCell(columnas.length + 2).value = totalGeneral;
    const diasConCapturasTotal = columnas.filter(col =>
      datosConCapturas.some(([, d]) => (d.columnas[col.fecha] || 0) > 0)
    ).length || 1;
    totalRow.getCell(columnas.length + 3).value = Math.round(totalGeneral / diasConCapturasTotal);
    totalRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: 'FF7a1a35' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    });

    // Anchos
    ws.getColumn(1).width = 35;
    for (let i = 2; i <= columnas.length + 3; i++) {
      ws.getColumn(i).width = Math.max(10, Math.round(120 / columnas.length));
    }

    // Gráfica real de Excel en hoja Participación
    const wsGrafica = workbook.addWorksheet('Participación');
    wsGrafica.getCell('A1').value = 'Capturista';
    wsGrafica.getCell('B1').value = 'Capturas';
    wsGrafica.getRow(1).font = { bold: true };

    datosConCapturas.forEach(([, d], i) => {
      wsGrafica.getCell(i + 2, 1).value = d.nombre;
      wsGrafica.getCell(i + 2, 2).value = d.total;
    });
    wsGrafica.getColumn(1).width = 35;
    wsGrafica.getColumn(2).width = 12;

    // Agregar imagen PNG de la gráfica en hoja Participación
    const pngBufferExcel = await generarGraficaPNG(datosConCapturas, totalGeneral);
    const imageId = workbook.addImage({
      buffer: pngBufferExcel,
      extension: 'png'
    });
    wsGrafica.addImage(imageId, {
      tl: { col: 3, row: 1 },
      ext: { width: 700, height: 500 }
    });

    // Texto de participación en hoja Reporte
    const wsReporte = ws;
    const filaParticipacion = totalRowIdx + 2;
    wsReporte.mergeCells(filaParticipacion, 1, filaParticipacion, columnas.length + 3);
    wsReporte.getCell(filaParticipacion, 1).value = 'La participación por Agente en los registros del Sistema TSU se distribuyó de la siguiente manera:';
    wsReporte.getCell(filaParticipacion, 1).font = { italic: true, size: 11 };
    wsReporte.getRow(filaParticipacion).height = 20;

    datosConCapturas.forEach(([, d], i) => {
      const pct = totalGeneral > 0 ? (d.total / totalGeneral * 100).toFixed(1) : 0;
      const fila = filaParticipacion + 1 + i;
      wsReporte.mergeCells(fila, 1, fila, columnas.length + 3);
      wsReporte.getCell(fila, 1).value = `• ${d.nombre}: ${d.total} capturas (${pct}%)`;
      wsReporte.getCell(fila, 1).font = { size: 10 };
    });

    // Párrafo de cierre
    const filaCierre = filaParticipacion + 1 + datosConCapturas.length + 1;
    wsReporte.mergeCells(filaCierre, 1, filaCierre, columnas.length + 3);
    const diasConCapturaCierre = columnas.filter(col =>
      datosConCapturas.some(([, d]) => (d.columnas[col.fecha] || 0) > 0)
    ).length || 1;
    const promCierreExcel = datosConCapturas.length > 0 ? Math.round(totalGeneral / datosConCapturas.length / diasConCapturaCierre) : 0;
    wsReporte.getCell(filaCierre, 1).value = `El equipo de captura registró un total de ${totalGeneral} aclaraciones durante el período, con un promedio de ${promCierreExcel} capturas por agente por día hábil. Agradecemos el compromiso y esfuerzo de cada integrante del equipo en el cumplimiento de sus metas.`;
    wsReporte.getCell(filaCierre, 1).font = { italic: true, size: 10 };
    wsReporte.getCell(filaCierre, 1).alignment = { wrapText: true };
    wsReporte.getRow(filaCierre).height = 40;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_TSU_${tipo}_${fecha}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- ENDPOINT PDF ----
app.get('/reporte/pdf', verificarIP, async (req, res) => {
  try {
    const { tipo = 'semanal', fecha = new Date().toISOString().slice(0,10) } = req.query;
    const { datosConCapturas, columnas, etiqueta, totalGeneral, numDias } = obtenerDatosReporte(tipo, fecha);

    const doc = new PDFDocument({ margin: 40, size: 'LETTER', layout: tipo === 'mensual' ? 'landscape' : 'portrait' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_TSU_${tipo}_${fecha}.pdf"`);
    doc.pipe(res);

    const colorRojo = '#7a1a35';
    const colorAzul = '#1a3a7a';
    const colorGris = '#f8f0f3';
    const pageWidth = doc.page.width - 80; // 532 portrait / 692 landscape

    // ── Título ──
    doc.rect(40, 40, pageWidth, 28).fill(colorAzul);
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
      .text('INFORME DE DESEMPEÑO — SISTEMA TSU', 40, 49, { width: pageWidth, align: 'center' });

    // ── Saludo ──
    doc.fillColor('#333').fontSize(10).font('Helvetica')
      .text('Estimados Todos:', 40, 82);

    // ── Texto introductorio ──
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica')
      .text(textoIntroductorio(tipo, etiqueta), 40, doc.y, { width: pageWidth });

    // ── Tabla ──
    const tableTop = doc.y + 12;
    const nombreWidth = tipo === 'mensual' ? 110 : 150;
    const totalWidth = tipo === 'mensual' ? 35 : 45;
    const promWidth = tipo === 'mensual' ? 48 : 50;
    const colsWidth = pageWidth - nombreWidth - totalWidth - promWidth;
    const colW = Math.max(18, Math.floor(colsWidth / columnas.length));
    const colFontSize = colW < 24 ? 7 : colW < 30 ? 8 : 9;
    const rowH = 16;

    // Encabezado tabla
    let x = 40;
    doc.rect(x, tableTop, nombreWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text('NOMBRE', x + 4, tableTop + 5, { width: nombreWidth - 8 });
    x += nombreWidth;

    columnas.forEach(col => {
      doc.rect(x, tableTop, colW, rowH).fill(colorRojo);
      doc.fillColor('white').fontSize(colFontSize).font('Helvetica-Bold')
        .text(col.label, x + 1, tableTop + 5, { width: colW - 2, align: 'center' });
      x += colW;
    });

    doc.rect(x, tableTop, totalWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text('TOTAL', x + 2, tableTop + 5, { width: totalWidth - 4, align: 'center' });
    x += totalWidth;

    doc.rect(x, tableTop, promWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text('PROM/DÍA', x + 2, tableTop + 5, { width: promWidth - 4, align: 'center' });

    // Filas de datos
    datosConCapturas.forEach(([, d], rowIdx) => {
      const y = tableTop + rowH + rowIdx * rowH;
      x = 40;
      const bg = rowIdx % 2 === 0 ? 'white' : colorGris;

      doc.rect(x, y, nombreWidth, rowH).fill(bg).stroke('#ddd');
      doc.fillColor('#333').fontSize(10).font('Helvetica')
        .text(d.nombre, x + 4, y + 5, { width: nombreWidth - 8 });
      x += nombreWidth;

      columnas.forEach(col => {
        const val = d.columnas[col.fecha] || 0;
        doc.rect(x, y, colW, rowH).fill(bg).stroke('#ddd');
        doc.fillColor('#333').fontSize(colFontSize).font('Helvetica')
          .text(val > 0 ? String(val) : '', x + 1, y + 5, { width: colW - 2, align: 'center' });
        x += colW;
      });

      const prom = numDias > 0 ? Math.round(d.total / numDias) : 0;
      doc.rect(x, y, totalWidth, rowH).fill(bg).stroke('#ddd');
      doc.fillColor('#333').fontSize(10).font('Helvetica-Bold')
        .text(String(d.total), x + 2, y + 5, { width: totalWidth - 4, align: 'center' });
      x += totalWidth;

      doc.rect(x, y, promWidth, rowH).fill(bg).stroke('#ddd');
      doc.fillColor('#333').fontSize(10).font('Helvetica')
        .text(String(prom), x + 2, y + 5, { width: promWidth - 4, align: 'center' });
    });

    // Fila totales
    const yTotal = tableTop + rowH + datosConCapturas.length * rowH;
    x = 40;
    doc.rect(x, yTotal, nombreWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text('TOTAL', x + 4, yTotal + 5, { width: nombreWidth - 8 });
    x += nombreWidth;

    columnas.forEach(col => {
      const sumCol = datosConCapturas.reduce((acc, [, d]) => acc + (d.columnas[col.fecha] || 0), 0);
      doc.rect(x, yTotal, colW, rowH).fill(colorRojo);
      doc.fillColor('white').fontSize(colFontSize).font('Helvetica-Bold')
        .text(String(sumCol), x + 1, yTotal + 5, { width: colW - 2, align: 'center' });
      x += colW;
    });

    doc.rect(x, yTotal, totalWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text(String(totalGeneral), x + 2, yTotal + 5, { width: totalWidth - 4, align: 'center' });
    x += totalWidth;

    const promTotal = numDias > 0 ? Math.round(totalGeneral / numDias) : 0;
    doc.rect(x, yTotal, promWidth, rowH).fill(colorRojo);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
      .text(String(promTotal), x + 2, yTotal + 5, { width: promWidth - 4, align: 'center' });

    // ── Texto participación ──
    const yParticipacion = yTotal + rowH + 14;
    doc.fillColor('#333').fontSize(10).font('Helvetica')
      .text('La participación por Agente en los registros de TChip se distribuyó de la siguiente manera:', 40, yParticipacion, { width: pageWidth });

    // ── Gráfica ──
    const pngBuffer = await generarGraficaPNG(datosConCapturas, totalGeneral);
    const graficaH = tipo === 'mensual' ? 260 : 220;
    const graficaW = pageWidth;
    const yGrafica = doc.y + 8;
    doc.image(pngBuffer, 40, yGrafica, { width: graficaW, height: graficaH });

    // ── Párrafo de cierre ──
    const diasConCapturas = columnas.filter(col => 
      datosConCapturas.some(([, d]) => (d.columnas[col.fecha] || 0) > 0)
    ).length || 1;
    const promPorAgente = datosConCapturas.length > 0
      ? Math.round(totalGeneral / datosConCapturas.length / diasConCapturas) : 0;
    const yCierre = yGrafica + graficaH + 10;
    const alturaRestante = doc.page.height - yCierre - 40;
    if (alturaRestante < 40) doc.addPage({ size: 'LETTER', layout: tipo === 'mensual' ? 'landscape' : 'portrait' });
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Oblique')
      .text(
        `El equipo de captura registró un total de ${totalGeneral} aclaraciones durante el período, con un promedio de ${promPorAgente} capturas por agente por día. Agradecemos el compromiso y esfuerzo de cada integrante del equipo en el cumplimiento de sus metas.`,
        40, alturaRestante < 40 ? 40 : yCierre, { width: pageWidth }
      );

    doc.end();
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// ---- ENDPOINT WORD ----
app.get('/reporte/word', verificarIP, async (req, res) => {
  try {
    const { tipo = 'semanal', fecha = new Date().toISOString().slice(0,10) } = req.query;
    const { datosConCapturas, columnas, etiqueta, totalGeneral, numDias } = obtenerDatosReporte(tipo, fecha);

    const colorRojo = '7a1a35';
    const colorAzul = '1a3a7a';
    const colorGris = 'F8F0F3';
    const borderStyle = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

    const headerCell = (text) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })],
        alignment: AlignmentType.CENTER
      })],
      shading: { fill: colorRojo },
      borders,
      margins: { top: 60, bottom: 60, left: 80, right: 80 }
    });

    const dataCell = (text, bold = false, bg = null) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: String(text), bold, size: 16 })],
        alignment: AlignmentType.CENTER
      })],
      shading: bg ? { fill: bg } : undefined,
      borders,
      margins: { top: 40, bottom: 40, left: 60, right: 60 }
    });

    const nameCell = (text, bg = null) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, size: 16 })],
        alignment: AlignmentType.LEFT
      })],
      shading: bg ? { fill: bg } : undefined,
      borders,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      width: { size: 3000, type: WidthType.DXA }
    });

    const headerRowCells = [
      headerCell('NOMBRE'),
      ...columnas.map(col => headerCell(col.label)),
      headerCell('TOTAL'),
      headerCell('PROM x DÍA')
    ];

    const dataRows = datosConCapturas.map(([, d], idx) => {
      const bg = idx % 2 === 1 ? colorGris : null;
      const prom = numDias > 0 ? Math.round(d.total / numDias) : 0;
      return new TableRow({
        children: [
          nameCell(d.nombre, bg),
          ...columnas.map(col => dataCell(d.columnas[col.fecha] > 0 ? d.columnas[col.fecha] : '', false, bg)),
          dataCell(d.total, true, bg),
          dataCell(prom, false, bg)
        ]
      });
    });

    const totalRowCells = [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'TOTAL', bold: true, color: 'FFFFFF', size: 18 })], alignment: AlignmentType.CENTER })],
        shading: { fill: colorRojo }, borders, margins: { top: 60, bottom: 60, left: 80, right: 80 }
      }),
      ...columnas.map(col => {
        const sumCol = datosConCapturas.reduce((acc, [, d]) => acc + (d.columnas[col.fecha] || 0), 0);
        return new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(sumCol), bold: true, color: 'FFFFFF', size: 18 })], alignment: AlignmentType.CENTER })],
          shading: { fill: colorRojo }, borders, margins: { top: 60, bottom: 60, left: 80, right: 80 }
        });
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(totalGeneral), bold: true, color: 'FFFFFF', size: 18 })], alignment: AlignmentType.CENTER })],
        shading: { fill: colorRojo }, borders, margins: { top: 60, bottom: 60, left: 80, right: 80 }
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(numDias > 0 ? Math.round(totalGeneral/numDias) : 0), bold: true, color: 'FFFFFF', size: 18 })], alignment: AlignmentType.CENTER })],
        shading: { fill: colorRojo }, borders, margins: { top: 60, bottom: 60, left: 80, right: 80 }
      })
    ];

    const tabla = new Table({
      rows: [
        new TableRow({ children: headerRowCells, tableHeader: true }),
        ...dataRows,
        new TableRow({ children: totalRowCells })
      ],
      width: { size: 100, type: WidthType.PERCENTAGE }
    });

    // Generar imagen gráfica
    const pngBuffer = await generarGraficaPNG(datosConCapturas, totalGeneral);
    const { ImageRun } = require('docx');
    const imageType = 'png';

    const diasConCapturas = columnas.filter(col => 
      datosConCapturas.some(([, d]) => (d.columnas[col.fecha] || 0) > 0)
    ).length || 1;
    const promPorAgente = datosConCapturas.length > 0
      ? Math.round(totalGeneral / datosConCapturas.length / diasConCapturas) : 0;

    const docWord = new Document({
      sections: [{
        properties: { page: { size: { orientation: 'portrait' } } },
        children: [
          //Encabezado
          new Paragraph({
            children: [new TextRun({ text: 'INFORME DE DESEMPEÑO — SISTEMA TSU', bold: true, size: 28, color: 'FFFFFF' })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 100 },
            shading: { fill: colorAzul }
          }),
          // Saludo
          new Paragraph({
            children: [new TextRun({ text: 'Estimados Todos:', bold: true, size: 22 })],
            spacing: { after: 200 }
          }),
          // Texto introductorio
          new Paragraph({
            children: [new TextRun({ text: textoIntroductorio(tipo, etiqueta), size: 20 })],
            spacing: { after: 300 }
          }),
          // Tabla
          tabla,
          new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 300 } }),
          // Texto participación
          new Paragraph({
            children: [new TextRun({ text: 'La participación por Agente en los registros del Sistema TSU se distribuyó de la siguiente manera:', size: 20 })],
            spacing: { after: 200 }
          }),
          // Imagen gráfica
          new Paragraph({
            children: [new ImageRun({
              data: pngBuffer,
              transformation: { width: 500, height: 333 },
              type: 'png'
            })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 }
          }),
          // Párrafo de cierre
          new Paragraph({
            children: [new TextRun({
              text: `El equipo de captura registró un total de ${totalGeneral} aclaraciones durante el período, con un promedio de ${promPorAgente} capturas por agente por día hábil. Agradecemos el compromiso y esfuerzo de cada integrante del equipo en el cumplimiento de sus metas.`,
              italics: true, size: 20, color: '000000'
            })],
            spacing: { after: 200 }
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(docWord);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_TSU_${tipo}_${fecha}.docx"`);
    res.send(buffer);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// Buscar folios afectados antes de la edición masiva (vista previa)
app.get('/registros/buscar-masivo', verificarIP, (req, res) => {
  try {
    const { campo, valor } = req.query;
    const camposPermitidos = ['fecha_aclaracion','nombre_usuario','sexo','anio_nacimiento',
      'ref_sucursal','acuerdo','num_tarjeta','canal','motivo','banco','ref_cajero',
      'monto','fecha_movimiento','programa','celular','num_tarjeta_transacciono','bloqueo'];

    if (!camposPermitidos.includes(campo)) return res.status(400).json({ error: 'Campo no permitido' });
    if (!valor) return res.status(400).json({ error: 'Valor requerido' });

    const rows = db.prepare(`SELECT folio FROM registros WHERE ${campo} = ?`).all(valor);
    res.json({ folios: rows.map(r => r.folio), total: rows.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Edición masiva: actualiza un campo en todos los registros que tengan el valor buscado
app.put('/registros/edicion-masiva', verificarIP, (req, res) => {
  try {
    const { campo, valorBuscar, valorNuevo } = req.body;

    const camposPermitidos = {
      'fecha_aclaracion': 'fecha_aclaracion', 'nombre_usuario': 'nombre_usuario',
      'sexo': 'sexo', 'anio_nacimiento': 'anio_nacimiento', 'ref_sucursal': 'ref_sucursal',
      'acuerdo': 'acuerdo', 'num_tarjeta': 'num_tarjeta', 'canal': 'canal',
      'motivo': 'motivo', 'banco': 'banco', 'ref_cajero': 'ref_cajero',
      'monto': 'monto', 'fecha_movimiento': 'fecha_movimiento', 'programa': 'programa',
      'celular': 'celular', 'num_tarjeta_transacciono': 'num_tarjeta_transacciono', 'bloqueo': 'bloqueo'
    };

    if (!camposPermitidos[campo]) return res.status(400).json({ error: 'Campo no permitido' });
    if (!valorBuscar && valorBuscar !== 0) return res.status(400).json({ error: 'Valor a buscar requerido' });
    if (!valorNuevo && valorNuevo !== 0) return res.status(400).json({ error: 'Valor nuevo requerido' });

    // Obtener folios afectados antes de actualizar (para el log y el emit)
    const afectados = db.prepare(`SELECT folio FROM registros WHERE ${campo} = ?`).all(valorBuscar);
    if (afectados.length === 0) return res.json({ ok: true, total: 0, folios: [] });

    // Actualizar todos de una sola query
    const result = db.prepare(`UPDATE registros SET ${campo} = ? WHERE ${campo} = ?`).run(valorNuevo, valorBuscar);

    // Emitir evento por cada folio actualizado para que el dashboard se refleje
    afectados.forEach(({ folio }) => {
      const r = db.prepare('SELECT * FROM registros WHERE folio = ?').get(folio);
      if (r) io.emit('registro_actualizado', mapearRegistro(r));
    });

    res.json({ ok: true, total: result.changes, folios: afectados.map(r => r.folio) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});



// Editar registro desde dashboard
app.put('/registros/:folio', verificarIP, (req, res) => {
  try {
    const { campo, valor } = req.body;
    const folio = req.params.folio;

    const camposPermitidos = {
      'fecha_aclaracion': 'fecha_aclaracion',
      'nombre_usuario': 'nombre_usuario',
      'sexo': 'sexo',
      'anio_nacimiento': 'anio_nacimiento',
      'ref_sucursal': 'ref_sucursal',
      'acuerdo': 'acuerdo',
      'num_tarjeta': 'num_tarjeta',
      'canal': 'canal',
      'desc_canal': 'desc_canal',
      'motivo': 'motivo',
      'desc_motivo': 'desc_motivo',
      'banco': 'banco',
      'ref_cajero': 'ref_cajero',
      'monto': 'monto',
      'fecha_movimiento': 'fecha_movimiento',
      'programa': 'programa',
      'celular': 'celular',
      'respuesta': 'respuesta',
      'fecha_respuesta_comp': 'fecha_respuesta_comp',
      'fecha_envio_respuesta': 'fecha_envio_respuesta',
      'fecha_abono': 'fecha_abono',
      'observacion': 'observacion',
      'motivo_procedencia': 'motivo_procedencia',
      'localidad_cajero': 'localidad_cajero',
      'num_tarjeta_transacciono': 'num_tarjeta_transacciono',
      'bloqueo': 'bloqueo'
    };

    if (!camposPermitidos[campo]) return res.status(400).json({ error: 'Campo no permitido' });

    const registroExistente = db.prepare('SELECT * FROM registros WHERE folio = ?').get(folio);
    if (!registroExistente) return res.status(404).json({ error: 'Folio no encontrado' });

    db.prepare(`UPDATE registros SET ${campo} = ? WHERE folio = ?`).run(valor, folio);

    const registroActualizado = db.prepare('SELECT * FROM registros WHERE folio = ?').get(folio);
    const rEmit = mapearRegistro(registroActualizado);
    io.emit('registro_actualizado', rEmit);
    res.json({ ok: true, registro: rEmit });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});




// Actualizar catálogo desde nuevo Excel
app.post('/catalogo/actualizar', verificarIP, async (req, res) => {
  try {
    const ExcelJSCat = require('exceljs');
    const wbCat = new ExcelJSCat.Workbook();
    await wbCat.xlsx.readFile(path.join(__dirname, 'catalogo_sucursales.xlsx'));
    const wsCat = wbCat.worksheets[0];
    const cat = {};
    wsCat.eachRow((row, i) => {
      if (i === 1) return;
      const ref = String(row.getCell(1).value || '').trim();
      if (!ref) return;
      cat[ref] = {
        entidad: String(row.getCell(4).value || '').trim(),
        cp: String(row.getCell(5).value || '').trim(),
        municipio: String(row.getCell(6).value || '').trim(),
        localidad: String(row.getCell(7).value || '').trim()
      };
    });
    fs.writeFileSync(CATALOGO_PATH, JSON.stringify(cat, null, 2), 'utf8');
    catalogoSucursales = cat;
    console.log(`📚 Catálogo actualizado: ${Object.keys(cat).length} sucursales`);
    res.json({ ok: true, total: Object.keys(cat).length });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Actualizar masivamente todos los registros con datos del catálogo
app.post('/registros/actualizar-catalogo', verificarIP, (req, res) => {
  try {
    const registros = db.prepare('SELECT folio, ref_sucursal FROM registros').all();
    let actualizados = 0;
    const stmt = db.prepare(`
      UPDATE registros SET entidad=?, codigo_postal=?, municipio=?, localidad=?
      WHERE folio=?
    `);
    registros.forEach(r => {
      const datos = buscarEnCatalogo(r.ref_sucursal);
      stmt.run(datos.entidad, datos.cp, datos.municipio, datos.localidad, r.folio);
      actualizados++;
    });
    console.log(`✅ ${actualizados} registros actualizados con catálogo`);
    res.json({ ok: true, actualizados });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



// ---- REPORTE DCI EXCEL ----
app.get('/reporte/dci', verificarIP, async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const [yyyy, mm, dd] = fecha.split('-');
    const fechaStr = `${dd}/${mm}/${yyyy}`;

    // Texto del periodo para los títulos
    const meses = ['enero','febrero','marzo','abril','mayo','junio',
                   'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const periodoTexto = `Recibidos el ${parseInt(dd)} de ${meses[parseInt(mm)-1]} de ${yyyy}`;

    // Nombre del archivo igual al ejemplo: Recibidas_DDMMYYYY.xlsx
    const nombreArchivo = `Recibidas_${dd}${mm}${yyyy}.xlsx`;

    // Definición de las 3 hojas
    const hojas = [
      {
        nombre: 'RNR ATM',
        causa: 'RNR ATM',
        canal: 'CAJEROS AUTOMATICOS',
        motivo: 'RETIRO NO RECONOCIDO'
      },
      {
        nombre: 'POS',
        causa: 'POS',
        canal: 'TERMINAL PUNTO DE VENTA',
        motivo: 'CARGO NO RECONOCIDO POR CONSUMOS EFECTUADOS'
      },
      {
        nombre: 'NEC',
        causa: 'NEC',
        canal: 'CAJEROS AUTOMATICOS',
        motivo: 'NO ENTREGA CANTIDAD SOLICITADA'
      }
    ];

    const wb = new ExcelJS.Workbook();

    // Estilos reutilizables
    const estiloTitulo = {
      font: { bold: true, size: 11 },
      alignment: { vertical: 'middle' }
    };
    const estiloEncabezado = {
      font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED7D31' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: {
        top:    { style: 'thin' }, bottom: { style: 'thin' },
        left:   { style: 'thin' }, right:  { style: 'thin' }
      }
    };
    const estiloDato = {
      font: { size: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
      alignment: { vertical: 'middle', wrapText: false },
      border: {
        top:    { style: 'thin' }, bottom: { style: 'thin' },
        left:   { style: 'thin' }, right:  { style: 'thin' }
      }
    };
    const estiloDatoVerde = {
      font: { size: 10 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } },
      alignment: { vertical: 'middle', wrapText: false },
      border: {
        top:    { style: 'thin' }, bottom: { style: 'thin' },
        left:   { style: 'thin' }, right:  { style: 'thin' }
      }
    };

    for (const hoja of hojas) {
      // Consultar registros filtrados por fecha_recepcion, canal y motivo
      const rows = db.prepare(`
        SELECT folio, fecha_recepcion, fecha_movimiento, programa,
               acuerdo, num_tarjeta, sucursal, entidad,
               localidad_cajero, banco, monto
        FROM registros
        WHERE fecha_recepcion = ?
          AND UPPER(desc_canal)  = UPPER(?)
          AND UPPER(desc_motivo) = UPPER(?)
        ORDER BY folio ASC
      `).all(fechaStr, hoja.canal, hoja.motivo);

      const ws = wb.addWorksheet(hoja.nombre);

      // Anchos de columna
      ws.columns = [
        { key: 'folio',          width: 18 },
        { key: 'fecha_rec',      width: 14 },
        { key: 'fecha_mov',      width: 14 },
        { key: 'programa',       width: 20 },
        { key: 'acuerdo',        width: 14 },
        { key: 'num_tarjeta',    width: 20 },
        { key: 'sucursal',       width: 12 },
        { key: 'entidad',        width: 34 },
        { key: 'localidad',      width: 22 },
        { key: 'banco',          width: 24 },
        { key: 'monto',          width: 12 },
        { key: 'loc_vs_ret',     width: 16 },
        { key: 'video',          width: 10 },
        { key: 'parametros',     width: 16 },
      ];

      // Fila 1 — Tipo
      ws.getRow(1).getCell(1).value = 'Tipo:';
      ws.getRow(1).getCell(2).value = 'Detalle de Asuntos';
      Object.assign(ws.getRow(1).getCell(1), estiloTitulo);
      Object.assign(ws.getRow(1).getCell(2), estiloTitulo);
      ws.getRow(1).height = 18;

      // Fila 2 — Causa
      ws.getRow(2).getCell(1).value = 'Causa:';
      ws.getRow(2).getCell(2).value = hoja.causa;
      Object.assign(ws.getRow(2).getCell(1), estiloTitulo);
      Object.assign(ws.getRow(2).getCell(2), estiloTitulo);
      ws.getRow(2).height = 18;

      // Fila 3 — Periodo (solo B3 cambia con la fecha)
      ws.getRow(3).getCell(1).value = 'Periodo:';
      ws.getRow(3).getCell(2).value = periodoTexto;
      Object.assign(ws.getRow(3).getCell(1), estiloTitulo);
      Object.assign(ws.getRow(3).getCell(2), estiloTitulo);
      ws.getRow(3).height = 18;

      // Fila 4 — Encabezados de tabla
      const encabezados = [
        'FOLIO DE CONTINUIDAD', 'FECHA DE RECEPCION CORREO',
        'FECHA DEL MOVIMIENTO (FECHA DEL SUCESO CNBV)', 'NOMBRE DEL PROGRAMA',
        'ACUERDO', 'N. DE TARJETA', 'SUCURSAL', 'ENTIDAD DE LA SUCURSAL',
        'LOCALIDAD DEL RETIRO', 'BANCO/ESTABLECIMIENTO', 'MONTO',
        'LOCALIDAD CUENTA VS LOCALIDAD RETIRO', 'VIDEO', 'PARÁMETROS SEG.'
      ];
      encabezados.forEach((texto, i) => {
        const cell = ws.getRow(4).getCell(i + 1);
        cell.value = texto;
        cell.font      = estiloEncabezado.font;
        cell.fill      = estiloEncabezado.fill;
        cell.alignment = estiloEncabezado.alignment;
        cell.border    = estiloEncabezado.border;
      });
      ws.getRow(4).height = 50;

      // Filas de datos
      rows.forEach((r, idx) => {
        const fila = ws.getRow(5 + idx);
        const valores = [
          r.folio,
          r.fecha_recepcion,
          r.fecha_movimiento,
          r.programa      || '',
          r.acuerdo       || '',
          r.num_tarjeta   || '',
          '',
          r.entidad       || '',
          '',
          r.banco         || '',
          r.monto !== null ? r.monto : '',
          '', '', ''   // LOCALIDAD CUENTA VS, VIDEO, PARÁMETROS — vacías
        ];
        valores.forEach((val, i) => {
          const cell = fila.getCell(i + 1);
          // Columnas L(12) y N(14) van en verde, el resto en salmón
          const estilo = (i === 11 || i === 13) ? estiloDatoVerde : estiloDato;
          cell.value     = val;
          cell.font      = estilo.font;
          cell.fill      = estilo.fill;
          cell.alignment = estilo.alignment;
          cell.border    = estilo.border;
          if (i === 10) {
            cell.numFmt = '"$"#,##0.00';
            cell.value  = val !== '' ? parseFloat(val) : '';
          }
        });
        fila.height = 16;
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// ---- CONCENTRADO ACTUAL ----
app.get('/reporte/concentrado', verificarIP, async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const [yyyy, mm, dd] = fecha.split('-');
    const fechaStr = `${dd}/${mm}/${yyyy}`;
    const nombreArchivo = `CONCENTRADO ACTUAL ${dd}${mm}${yyyy} - ACL.xlsx`;

    // Traer registros del día
    const registrosDia = db.prepare(`
      SELECT * FROM registros WHERE fecha_recepcion = ? ORDER BY id ASC
    `).all(fechaStr);

    // Para cada registro del día, buscar duplicados en toda la BD
    const resultados = registrosDia.map(r => {
      // Llave 1: acuerdo + monto + fecha_movimiento
      const dup1 = db.prepare(`
        SELECT folio FROM registros
        WHERE acuerdo = ? AND CAST(monto AS REAL) = CAST(? AS REAL)
          AND fecha_movimiento = ? AND folio != ?
        LIMIT 1
      `).get(r.acuerdo, r.monto, r.fecha_movimiento, r.folio);

      // Llave 2: nombre_usuario + monto + fecha_movimiento
      const dup2 = db.prepare(`
        SELECT folio FROM registros
        WHERE UPPER(nombre_usuario) = UPPER(?)
          AND CAST(monto AS REAL) = CAST(? AS REAL)
          AND fecha_movimiento = ? AND folio != ?
        LIMIT 1
      `).get(r.nombre_usuario, r.monto, r.fecha_movimiento, r.folio);

      return {
        registro: mapearRegistro(r),
        duplicado_llave1: dup1 ? dup1.folio : null,
        duplicado_llave2: dup2 ? dup2.folio : null,
      };
    });

    res.json({ ok: true, resultados, fecha: fechaStr, nombreArchivo });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- DESCARGAR CONCENTRADO EXCEL ----
app.post('/reporte/concentrado/excel', verificarIP, async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    const { registros, nombreArchivo } = body;
    if (!registros || !Array.isArray(registros)) return res.status(400).json({ error: 'Registros requeridos' });

    const headers = [
      'Folio de continuidad','Fecha de recepción de correo','Fecha de aclaración sucursal',
      'Nombre del Usuario','Sexo','Año de nacimiento','Referencia de sucursal','Sucursal',
      'Acuerdo','Número de tarjeta','Canal','Descripción del canal',
      'Motivo de reclamación','Descripción de motivo de reclamación','Banco/establecimiento',
      'Referencia del cajero/establecimientio','Monto','Fecha del movimiento',
      'Entidad','Código Postal','Municipio','Localidad','Estatus',
      'Fecha de envío a compensación','Fecha de estatus a sucursal',
      'RESPUESTA','FECHA DE RESPUESTA POR COMP. Y LIQUIDACIÓN',
      'FECHA ENVÍO DE RESPUESTA A SUCURSAL','FECHA ABONO','OBSERVACIÓN',
      'Motivo procedencia/improcedencia','Nombre del programa','LOCALIDAD CAJERO',
      'N. CELULAR','Bloqueo de tarjeta','N. DE TARJETA QUE TRANSACCIONÓ'
    ];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Concentrado');

    ws.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    // Estilo encabezado
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A7A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    ws.getRow(1).height = 30;

    // Filas de datos
    registros.forEach((r, i) => {
      const row = ws.addRow(headers.map(h => r[h] ?? ''));
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFE8EEF7';
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
        };
        cell.alignment = { vertical: 'middle' };
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


// ---- REGISTROS ELIMINADOS ----
app.get('/registros-eliminados', verificarIP, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, folio, fecha_eliminacion, eliminado_por, motivo, datos
      FROM registros_eliminados
      ORDER BY fecha_eliminacion DESC
      LIMIT 5000
    `).all();
    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/registros-eliminados/recuperar/:id', verificarIP, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM registros_eliminados WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrado' });

    const r = JSON.parse(row.datos);

    // Verificar si el folio ya existe en registros
    const existe = db.prepare('SELECT id FROM registros WHERE folio = ?').get(r.folio);
    if (existe) return res.status(400).json({ error: `El folio ${r.folio} ya existe en la BD` });

    db.prepare(`
      INSERT INTO registros (
        folio, fecha_recepcion, fecha_aclaracion, nombre_usuario, sexo, anio_nacimiento,
        ref_sucursal, sucursal, acuerdo, num_tarjeta, canal, desc_canal, motivo, desc_motivo,
        banco, ref_cajero, monto, fecha_movimiento, entidad, codigo_postal, municipio, localidad,
        estatus, fecha_envio, fecha_estatus, respuesta, fecha_respuesta_comp, fecha_envio_respuesta,
        fecha_abono, observacion, motivo_procedencia, programa, localidad_cajero, celular, bloqueo,
        capturista, num_tarjeta_transacciono, fecha_guardado
      ) VALUES (
        @folio, @fecha_recepcion, @fecha_aclaracion, @nombre_usuario, @sexo, @anio_nacimiento,
        @ref_sucursal, @sucursal, @acuerdo, @num_tarjeta, @canal, @desc_canal, @motivo, @desc_motivo,
        @banco, @ref_cajero, @monto, @fecha_movimiento, @entidad, @codigo_postal, @municipio, @localidad,
        @estatus, @fecha_envio, @fecha_estatus, @respuesta, @fecha_respuesta_comp, @fecha_envio_respuesta,
        @fecha_abono, @observacion, @motivo_procedencia, @programa, @localidad_cajero, @celular, @bloqueo,
        @capturista, @num_tarjeta_transacciono, @fecha_guardado
      )
    `).run(r);

    db.prepare('DELETE FROM registros_eliminados WHERE id = ?').run(row.id);
    io.emit('nuevo_registro', mapearRegistro(db.prepare('SELECT * FROM registros WHERE folio = ?').get(r.folio)));
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/registros-eliminados/:id', verificarIP, (req, res) => {
  try {
    db.prepare('DELETE FROM registros_eliminados WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});



// ---- REPORTE BLOQUEOS EXCEL ----
app.get('/reporte/bloqueos', verificarIP, async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const [yyyy, mm, dd] = fecha.split('-');
    const fechaStr = `${dd}/${mm}/${yyyy}`;

    const rows = db.prepare(`
      SELECT folio, nombre_usuario, acuerdo, num_tarjeta, monto,
             fecha_movimiento, desc_motivo
      FROM registros
      WHERE UPPER(bloqueo) = 'SI' AND fecha_recepcion = ?
      ORDER BY id ASC
    `).all(fechaStr);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('TCHIP');

    ws.columns = [
      { header: 'Folio',                  key: 'folio',            width: 20 },
      { header: 'Nombre',     key: 'nombre_usuario',   width: 30 },
      { header: 'No. Acuerdo',            key: 'acuerdo',          width: 20 },
      { header: 'Tarjeta',                key: 'num_tarjeta',      width: 22 },
      { header: 'Monto Reclamado',        key: 'monto',            width: 16 },
      { header: 'Fecha de movimiento',    key: 'fecha_movimiento', width: 20 },
      { header: 'Descripción/ Producto',  key: 'desc_motivo',      width: 35 },
    ];

    // Estilo encabezado
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1A35' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    ws.getRow(1).height = 20;

    // Filas de datos
    rows.forEach((r, i) => {
      const row = ws.addRow({
        folio:            r.folio,
        nombre_usuario:   r.nombre_usuario,
        acuerdo:          r.acuerdo,
        num_tarjeta:      r.num_tarjeta,
        monto:            r.monto,
        fecha_movimiento: r.fecha_movimiento,
        desc_motivo:      r.desc_motivo
      });
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF8F0F3';
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
        };
        cell.alignment = { vertical: 'middle' };
      });
    });

    const ws2 = wb.addWorksheet('FOLIOS DE BLOQUEO TCHIP');
    ws2.columns = [
      { header: 'Folio',            key: 'folio',    width: 20 },
      { header: 'Nombre',           key: 'nombre',   width: 30 },
      { header: 'No. Acuerdo',      key: 'acuerdo',  width: 20 },
      { header: 'Tarjeta',          key: 'tarjeta',  width: 22 },
      { header: 'Folio de bloqueo', key: 'fbloqueo', width: 20 },
    ];
    ws2.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A7A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    ws2.getRow(1).height = 20;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Bloqueos_${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



// ---- ENDPOINT IMPORTAR EXCEL HISTÓRICO ----
const multer = require('multer');
const upload = multer({ 
  dest: path.join(__dirname, 'uploads_temp'),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB máximo
});

// Crear carpeta temporal si no existe
if (!fs.existsSync(path.join(__dirname, 'uploads_temp'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads_temp'));
}

app.post('/importar/excel', verificarIP, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const archivoPath = req.file.path;
    console.log(`📥 Procesando archivo: ${req.file.originalname} (${Math.round(req.file.size/1024/1024*10)/10}MB)`);

    const wbImport = new ExcelJS.Workbook();
    await wbImport.xlsx.readFile(archivoPath);
    const wsImport = wbImport.worksheets[0];

    // Leer encabezados
    const headers = [];
    wsImport.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value || '').trim();
    });

    console.log(`📋 Columnas detectadas: ${headers.length}`);
    console.log(`📊 Filas totales: ${wsImport.rowCount - 1}`);

    const formatearFecha = (val) => {
      if (!val) return '';
      if (val instanceof Date) {
        // Normalizar: extraer solo fecha ignorando hora y zona horaria
        const iso = val.toISOString(); // siempre YYYY-MM-DDTHH:mm:ss.sssZ en UTC
        const [yyyy, mm, dd] = iso.slice(0, 10).split('-');
        const resultado = `${dd}/${mm}/${yyyy}`;
        const p = resultado.split('/');
        if (parseInt(p[2]) < 2000 || parseInt(p[2]) > 2100 || parseInt(p[1]) < 1 || parseInt(p[1]) > 12 || parseInt(p[0]) < 1 || parseInt(p[0]) > 31) console.warn(`⚠️ Fecha sospechosa (Date): ${resultado}`);
        return resultado;
      }
      if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        const d = String(date.getUTCDate()).padStart(2,'0');
        const m = String(date.getUTCMonth()+1).padStart(2,'0');
        const y = date.getUTCFullYear();
        return `${d}/${m}/${y}`;
      }
      if (typeof val === 'object' && val.result) return formatearFecha(val.result);
      return String(val).trim();
    };

    // Mapa de columnas: nombre en BD -> posibles nombres en Excel
    const mapaColumnas = {
      'folio':              ['Folio de continuidad', 'FOLIO', 'Folio'],
      'fecha_recepcion':    ['Fecha de recepción de correo', 'FECHA DE RECEPCION CORREO (fecha de reclamación -debe ser del trimestre a reportar- CONDUSEF y CNBV)', 'FECHA DE RECEPCION CORREO'],
      'fecha_aclaracion':   ['Fecha de aclaración sucursal', 'FECHA DE ACLARACION SUCURSAL'],
      'nombre_usuario':     ['Nombre del Usuario', 'NOMBRE DEL USUARIO', 'NOMBRE USUARIO'],
      'sexo':               ['Sexo', 'SEXO'],
      'anio_nacimiento':    ['Año de nacimiento', 'AÑO NACIMIENTO'],
      'ref_sucursal':       ['Referencia de sucursal', 'REF'],
      'sucursal':           ['Sucursal', 'SUCURSAL'],
      'acuerdo':            ['Acuerdo', 'ACUERDO'],
      'num_tarjeta':        ['Número de tarjeta', 'N. DE TARJETA', 'Numero de tarjeta', 'N. DE TARJETA PROPORCIONADA'],
      'canal':              ['Canal', 'CANAL'],
      'desc_canal':         ['Descripción del canal', 'DESCRIPCION / CANAL'],
      'motivo':             ['Motivo de reclamación', 'MOTIVO RECLAMACIÓN'],
      'desc_motivo':        ['Descripción de motivo de reclamación', 'DESCRIPCION / MOTIVO RECLAMACIÓN'],
      'banco':              ['Banco/establecimiento', 'BANCO/ESTABLECIMIENTO'],
      'ref_cajero':         ['Referencia del cajero/establecimientio', 'REF CAJERO/ ESTABLECIMIENTO'],
      'monto':              ['Monto', 'MONTO'],
      'fecha_movimiento':   ['Fecha del movimiento', 'FECHA DEL MOVIMIENTO (FECHA DEL SUCESO CNBV)', 'FECHA DEL MOVIMIENTO'],
      'entidad':            ['Entidad', 'ENTIDAD'],
      'codigo_postal':      ['Código Postal', 'CÓDIGO POSTAL'],
      'municipio':          ['Municipio', 'MUNICIPIO'],
      'localidad':          ['Localidad', 'LOCALIDAD'],
      'estatus':            ['Estatus', 'ESTATUS'],
      'fecha_envio':        ['Fecha de envío a compensación', 'FECHA DE ENVÍO A COMPENSACIÓN Y LIQUIDACIÓN'],
      'fecha_estatus':      ['Fecha de estatus a sucursal', 'FECHA DE ESTATUS A SUCURSAL'],
      'respuesta':          ['RESPUESTA'],
      'fecha_respuesta_comp':   ['FECHA DE RESPUESTA POR COMP. Y LIQUIDACIÓN', 'FECHA DE RESPUESTA POR COMP. Y LIQUIDACIÓN (fecha de atención CONDUSEF y fecha de resolución CNBV)'],
      'fecha_envio_respuesta':  ['FECHA ENVÍO DE RESPUESTA A SUCURSAL', 'FECHA ENVÍO DE RESPUESTA A SUCURSAL (Fecha de resolución CONDUSEF)'],
      'fecha_abono':        ['FECHA ABONO'],
      'observacion':        ['OBSERVACIÓN'],
      'motivo_procedencia': ['Motivo procedencia/improcedencia'],
      'programa':           ['Nombre del programa', 'NOMBRE DEL PROGRAMA'],
      'localidad_cajero':   ['LOCALIDAD CAJERO'],
      'celular':            ['N. CELULAR'],
      'bloqueo':            ['Bloqueo de tarjeta'],
      'num_tarjeta_transacciono': ['N. DE TARJETA QUE TRANSACCIONÓ', 'N. TARJETA QUE TRANSACCIONO'],
      'capturista':         ['capturista', 'CAPTURISTA'],
      'canal_atencion':     ['CANAL ATENCION', 'Canal de atención', 'CANAL DE ATENCIÓN']
    };

    // Construir índice de columnas del Excel una sola vez
    const indiceColumnas = {};
    Object.entries(mapaColumnas).forEach(([campo, nombres]) => {
      for (const nombre of nombres) {
        const idx = headers.indexOf(nombre);
        if (idx !== -1) { indiceColumnas[campo] = idx + 1; break; }
      }
    });
    
    console.log('Headers detectados:', JSON.stringify(headers));
    console.log('Índice de columnas detectado:', indiceColumnas);

    const getValPorCampo = (row, campo) => {
      const colNum = indiceColumnas[campo];
      if (!colNum) return '';
      const cell = row.getCell(colNum);
      if (!cell || cell.value === null || cell.value === undefined) return '';
      if (typeof cell.value === 'object' && cell.value?.result !== undefined) return String(cell.value.result || '').trim();
      if (cell.value instanceof Date) return '';
      return String(cell.value).trim();
    };

    const getFechaPorCampo = (row, campo) => {
      const colNum = indiceColumnas[campo];
      if (!colNum) return '';
      const cell = row.getCell(colNum);
      if (!cell || cell.value === null || cell.value === undefined) return '';
      return formatearFecha(cell.value);
    };
   
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO registros (
        folio, fecha_recepcion, fecha_aclaracion,
        nombre_usuario, sexo, anio_nacimiento, ref_sucursal,
        sucursal, acuerdo, num_tarjeta, canal, desc_canal,
        motivo, desc_motivo, banco, ref_cajero, monto,
        fecha_movimiento, entidad, codigo_postal, municipio, localidad,
        estatus, fecha_envio, fecha_estatus,
        respuesta, fecha_respuesta_comp, fecha_envio_respuesta, fecha_abono,
        observacion, motivo_procedencia,
        programa, localidad_cajero, celular, bloqueo, capturista, num_tarjeta_transacciono, canal_atencion, fecha_guardado
      ) VALUES (
        @folio, @fecha_recepcion, @fecha_aclaracion,
        @nombre_usuario, @sexo, @anio_nacimiento, @ref_sucursal,
        @sucursal, @acuerdo, @num_tarjeta, @canal, @desc_canal,
        @motivo, @desc_motivo, @banco, @ref_cajero, @monto,
        @fecha_movimiento, @entidad, @codigo_postal, @municipio, @localidad,
        @estatus, @fecha_envio, @fecha_estatus,
        @respuesta, @fecha_respuesta_comp, @fecha_envio_respuesta, @fecha_abono,
        @observacion, @motivo_procedencia,
        @programa, @localidad_cajero, @celular, @bloqueo, @capturista, @num_tarjeta_transacciono, @canal_atencion, @fecha_guardado
      )
    `);

    let importados = 0;
    let omitidos = 0;
    let procesados = 0;

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const folio = getValPorCampo(row, 'folio');
        if (!folio || folio === '' || folio === 'undefined') { omitidos++; continue; }
        const _fechaRec = getFechaPorCampo(row, 'fecha_recepcion');
        if (_fechaRec) {
          const _p = _fechaRec.split('/');
          const _anio = parseInt(_p[2]);
          if (_anio < 2020 || _anio > 2030) console.warn(`⚠️ Fecha sospechosa en folio ${folio}: fecha_recepcion=${_fechaRec}`);
        }
        const refSucursal = getValPorCampo(row, 'ref_sucursal');
        const entidadExcel = getValPorCampo(row, 'entidad');
        const cpExcel = getValPorCampo(row, 'codigo_postal');
        const municipioExcel = getValPorCampo(row, 'municipio');
        const localidadExcel = getValPorCampo(row, 'localidad');

        // Usar catálogo si el Excel no tiene los datos
        const datosCat = buscarEnCatalogo(refSucursal);

        try {
          const result = stmt.run({
            folio,
            fecha_recepcion: getFechaPorCampo(row, 'fecha_recepcion'),
            fecha_aclaracion: getFechaPorCampo(row, 'fecha_aclaracion'),
            nombre_usuario: getValPorCampo(row, 'nombre_usuario'),
            sexo: getValPorCampo(row, 'sexo'),
            anio_nacimiento: getValPorCampo(row, 'anio_nacimiento'),
            ref_sucursal: refSucursal,
            sucursal: getValPorCampo(row, 'sucursal'),
            acuerdo: getValPorCampo(row, 'acuerdo'),
            num_tarjeta: getValPorCampo(row, 'num_tarjeta'),
            canal: getValPorCampo(row, 'canal'),
            desc_canal: getValPorCampo(row, 'desc_canal'),
            motivo: getValPorCampo(row, 'motivo'),
            desc_motivo: getValPorCampo(row, 'desc_motivo'),
            banco: getValPorCampo(row, 'banco'),
            ref_cajero: getValPorCampo(row, 'ref_cajero'),
            monto: parseFloat(getValPorCampo(row, 'monto')) || 0,
            fecha_movimiento: getFechaPorCampo(row, 'fecha_movimiento'),
            entidad: entidadExcel || datosCat.entidad,
            codigo_postal: cpExcel || datosCat.cp,
            municipio: municipioExcel || datosCat.municipio,
            localidad: localidadExcel || datosCat.localidad,
            estatus: getValPorCampo(row, 'estatus'),
            fecha_envio: getFechaPorCampo(row, 'fecha_envio'),
            fecha_estatus: getFechaPorCampo(row, 'fecha_estatus'),
            respuesta: getValPorCampo(row, 'respuesta'),
            fecha_respuesta_comp: getFechaPorCampo(row, 'fecha_respuesta_comp'),
            fecha_envio_respuesta: getFechaPorCampo(row, 'fecha_envio_respuesta'),
            fecha_abono: getFechaPorCampo(row, 'fecha_abono'),
            observacion: getValPorCampo(row, 'observacion'),
            motivo_procedencia: getValPorCampo(row, 'motivo_procedencia'),
            programa: getValPorCampo(row, 'programa'),
            localidad_cajero: getValPorCampo(row, 'localidad_cajero'),
            celular: getValPorCampo(row, 'celular'),
            bloqueo: getValPorCampo(row, 'bloqueo'),
            capturista: getValPorCampo(row, 'capturista'),
            num_tarjeta_transacciono: getValPorCampo(row, 'num_tarjeta_transacciono') || getValPorCampo(row, 'num_tarjeta') || "",
            canal_atencion: getValPorCampo(row, 'canal_atencion'),
            fecha_guardado: new Date().toISOString()
          });
          if (result.changes > 0) importados++;
          else omitidos++;
        } catch(e) {
          console.error('Error insertando folio:', folio, e.message);
          omitidos++;
        }
        procesados++;
      }
    });

    // Procesar en lotes de 1000 filas
    const LOTE = 1000;
    const totalFilas = wsImport.rowCount - 1;
    let lote = [];

    for (let i = 2; i <= wsImport.rowCount; i++) {
      const row = wsImport.getRow(i);
      lote.push(row);
      if (lote.length >= LOTE || i === wsImport.rowCount) {
        insertMany(lote);
        lote = [];
        console.log(`⏳ Procesadas ${Math.min(i-1, totalFilas)} / ${totalFilas} filas...`);
      }
    }


    // Corregir capturistas con formato incorrecto después de importar
    const corregidos = db.prepare(`
      UPDATE registros SET capturista = substr(folio, 1, 1) 
      WHERE length(capturista) > 1 OR capturista IS NULL OR capturista = ''
    `).run();
    if (corregidos.changes > 0) {
      console.log(`✅ Capturistas corregidos post-importación: ${corregidos.changes} registros`);
    }

    console.log(`✅ Importación completada: ${importados} importados, ${omitidos} omitidos`);
    res.json({ ok: true, importados, omitidos, total: procesados });

  } catch(e) {
    console.error('Error en importación:', e);
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});




// ---- ACTUALIZACIÓN MASIVA DESDE EXCEL ----
app.post('/registros/actualizar-excel', verificarIP, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const wbAct = new ExcelJS.Workbook();
    await wbAct.xlsx.readFile(req.file.path);
    const wsAct = wbAct.worksheets[0];

    // Leer headers
    const headers = [];
    wsAct.getRow(1).eachCell((cell, col) => {
      headers[col - 1] = String(cell.value || '').trim().toUpperCase();
    });

    // Buscar índices de columnas
    const idx = {
      folio:                headers.indexOf('FOLIO'),
      respuesta:            headers.indexOf('RESPUESTA'),
      fecha_respuesta_comp: headers.findIndex(h => h.includes('RESPUESTA POR COMP')),
      fecha_envio_respuesta:headers.findIndex(h => h.includes('ENVÍO DE RESPUESTA') || h.includes('ENVIO DE RESPUESTA')),
      fecha_abono:          headers.findIndex(h => h.includes('ABONO')),
      observacion:          headers.findIndex(h => h.includes('OBSERVACI')),
      motivo_procedencia:   headers.findIndex(h => h.includes('PROCEDENCIA') || h.includes('IMPROCEDENCIA')),
      localidad_cajero:     headers.findIndex(h => h.includes('LOCALIDAD')),
    };

    if (idx.folio === -1) return res.status(400).json({ error: 'No se encontró columna FOLIO en el Excel' });

    const formatearFecha = (val) => {
      if (!val) return '';
      if (val instanceof Date) {
        // Normalizar: extraer solo fecha ignorando hora y zona horaria
        const iso = val.toISOString(); // siempre YYYY-MM-DDTHH:mm:ss.sssZ en UTC
        const [yyyy, mm, dd] = iso.slice(0, 10).split('-');
        const resultado = `${dd}/${mm}/${yyyy}`;
        const p = resultado.split('/');
        if (parseInt(p[2]) < 2000 || parseInt(p[2]) > 2100 || parseInt(p[1]) < 1 || parseInt(p[1]) > 12 || parseInt(p[0]) < 1 || parseInt(p[0]) > 31) console.warn(`⚠️ Fecha sospechosa (Date): ${resultado}`);
        return resultado;
      }
      if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        const d = String(date.getUTCDate()).padStart(2,'0');
        const m = String(date.getUTCMonth()+1).padStart(2,'0');
        const y = date.getUTCFullYear();
        return `${d}/${m}/${y}`;
      }
      if (typeof val === 'object' && val.result) return formatearFecha(val.result);
      return String(val).trim();
    };

    const getVal = (row, colIdx) => {
      if (colIdx === -1) return null;
      const cell = row.getCell(colIdx + 1);
      if (!cell || cell.value === null || cell.value === undefined) return null;
      if (cell.value instanceof Date) return formatearFecha(cell.value);
      if (typeof cell.value === 'object' && cell.value?.result !== undefined) return String(cell.value.result || '').trim();
      if (cell.value instanceof Date) return formatearFecha(cell.value);
      return String(cell.value).trim();
    };

    const modo = req.body.modo || 'sin_localidad';

    const stmtSinLocalidad = db.prepare(`
      UPDATE registros SET
        respuesta            = CASE WHEN @respuesta IS NOT NULL THEN @respuesta ELSE respuesta END,
        fecha_respuesta_comp = CASE WHEN @fecha_respuesta_comp IS NOT NULL THEN @fecha_respuesta_comp ELSE fecha_respuesta_comp END,
        fecha_envio_respuesta= CASE WHEN @fecha_envio_respuesta IS NOT NULL THEN @fecha_envio_respuesta ELSE fecha_envio_respuesta END,
        fecha_abono          = CASE WHEN @fecha_abono IS NOT NULL THEN @fecha_abono ELSE fecha_abono END,
        observacion          = CASE WHEN @observacion IS NOT NULL THEN @observacion ELSE observacion END,
        motivo_procedencia   = CASE WHEN @motivo_procedencia IS NOT NULL THEN @motivo_procedencia ELSE motivo_procedencia END
      WHERE folio = @folio
    `);

    const stmtSoloLocalidad = db.prepare(`
      UPDATE registros SET
        localidad_cajero = CASE WHEN @localidad_cajero IS NOT NULL THEN @localidad_cajero ELSE localidad_cajero END
      WHERE folio = @folio
    `);

    const stmt = modo === 'solo_localidad' ? stmtSoloLocalidad : stmtSinLocalidad;

    let actualizados = 0;
    let omitidos = 0;

    const actualizar = db.transaction((rows) => {
      for (const row of rows) {
        const folio = getVal(row, idx.folio);
        if (!folio) { omitidos++; continue; }

        const result = stmt.run({
          folio,
          respuesta:             getVal(row, idx.respuesta),
          fecha_respuesta_comp:  idx.fecha_respuesta_comp !== -1 ? formatearFecha(row.getCell(idx.fecha_respuesta_comp + 1).value) : null,
          fecha_envio_respuesta: idx.fecha_envio_respuesta !== -1 ? formatearFecha(row.getCell(idx.fecha_envio_respuesta + 1).value) : null,
          fecha_abono:           idx.fecha_abono !== -1 ? formatearFecha(row.getCell(idx.fecha_abono + 1).value) : null,
          observacion:           getVal(row, idx.observacion),
          motivo_procedencia:    getVal(row, idx.motivo_procedencia),
          localidad_cajero:      getVal(row, idx.localidad_cajero),
        });

        if (result.changes > 0) actualizados++;
        else omitidos++;
      }
    });

    const filas = [];
    for (let i = 2; i <= wsAct.rowCount; i++) filas.push(wsAct.getRow(i));
    actualizar(filas);

    res.json({ ok: true, actualizados, omitidos });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});



// ==============================
// ENDPOINTS OPTIMIZADOS
// ==============================

// Registros del día actual — carga inicial rápida
app.get('/registros/hoy', verificarIP, (req, res) => {
  try {
    const hoy = new Date();
    const d = String(hoy.getDate()).padStart(2,'0');
    const m = String(hoy.getMonth()+1).padStart(2,'0');
    const y = hoy.getFullYear();
    const fechaHoy = `${d}/${m}/${y}`;

    const rows = db.prepare(`
      SELECT * FROM registros WHERE fecha_recepcion = ? ORDER BY id DESC
    `).all(fechaHoy);

    const registros = rows.map(r => mapearRegistro(r));
    res.json({ registros, total: registros.length, fecha: fechaHoy });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Registros paginados por rango de fechas
app.get('/registros/pagina', verificarIP, (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 300;
    const desde = req.query.desde || '';
    const hasta = req.query.hasta || '';
    const offset = (pagina - 1) * limite;

    let query, countQuery, params;

    if (desde && hasta) {
      // Convertir fechas de YYYY-MM-DD a DD/MM/YYYY
      const parseFecha = (f) => {
        const [y,m,d] = f.split('-');
        return `${d}/${m}/${y}`;
      };
      const desdeStr = parseFecha(desde);
      const hastaStr = parseFecha(hasta);
      query = `SELECT * FROM registros WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2) AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2) ORDER BY substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) DESC, id DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM registros WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2) AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)`;
      params = [desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr];
    } else {
      query = `SELECT * FROM registros ORDER BY substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) DESC, id DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM registros`;
      params = [];
    }

    const result = db.prepare(countQuery).get(...params);
    const total = result ? result.total : 0;
    const rows = db.prepare(query).all(...params, limite, offset);
    const registros = rows.map(r => mapearRegistro(r));

    res.json({
      registros,
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Estadísticas calculadas en SQL — para gráficas y tarjetas
app.get('/registros/stats', verificarIP, (req, res) => {
  try {
    const desde = req.query.desde || '';
    const hasta = req.query.hasta || '';
    const modo = req.query.modo || 'hoy';

    let whereClause = '';
    let params = [];

    if (modo === 'hoy') {
      const hoy = new Date();
      const d = String(hoy.getDate()).padStart(2,'0');
      const m = String(hoy.getMonth()+1).padStart(2,'0');
      const y = hoy.getFullYear();
      whereClause = `WHERE fecha_recepcion = ?`;
      params = [`${d}/${m}/${y}`];
    } else if (modo === 'rango' && desde && hasta) {
      const parseFecha = (f) => { const [y,m,d] = f.split('-'); return `${d}/${m}/${y}`; };
      whereClause = `WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2) AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)`;
      params = [parseFecha(desde), parseFecha(desde), parseFecha(desde), parseFecha(hasta), parseFecha(hasta), parseFecha(hasta)];
    }

    // Total
    const total = db.prepare(`SELECT COUNT(*) as total FROM registros ${whereClause}`).get(...params).total;
    const totalHistorico = db.prepare(`SELECT COUNT(*) as total FROM registros`).get().total;

    // Monto
    const monto = db.prepare(`SELECT SUM(monto) as total FROM registros ${whereClause}`).get(...params).total || 0;

    // Por canal
    const canales = db.prepare(`
      SELECT desc_canal as label, COUNT(*) as valor 
      FROM registros ${whereClause} 
      GROUP BY desc_canal ORDER BY valor DESC
    `).all(...params);

    // Por motivo
    const motivos = db.prepare(`
      SELECT desc_motivo as label, COUNT(*) as valor 
      FROM registros ${whereClause} 
      GROUP BY desc_motivo ORDER BY valor DESC
    `).all(...params);

    // Por programa
    const programas = db.prepare(`
      SELECT programa as label, COUNT(*) as valor 
      FROM registros ${whereClause} 
      GROUP BY programa ORDER BY valor DESC
    `).all(...params);

    // Por agente
    const agentes = db.prepare(`
      SELECT substr(folio, 1, 1) as letra, COUNT(*) as capturas
      FROM registros ${whereClause}
      GROUP BY substr(folio, 1, 1) ORDER BY capturas DESC
    `).all(...params);

    res.json({ total, totalHistorico, monto, canales, motivos, programas, agentes });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Búsqueda paginada en servidor
app.get('/registros/buscar', verificarIP, (req, res) => {
  try {
    const termino = (req.query.termino || '').trim();
    const tipo = req.query.tipo || 'folio';
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 300;
    const offset = (pagina - 1) * limite;

    if (!termino) return res.json({ registros: [], total: 0, pagina: 1, totalPaginas: 0 });

    const campoBD = {
      'folio': 'folio',
      'acuerdo': 'acuerdo',
      'tarjeta': 'num_tarjeta',
      'nombre': 'nombre_usuario'
    }[tipo] || 'folio';

    const busqueda = `%${termino}%`;
    const total = db.prepare(`SELECT COUNT(*) as total FROM registros WHERE ${campoBD} LIKE ?`).get(busqueda).total;
    const rows = db.prepare(`SELECT * FROM registros WHERE ${campoBD} LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`).all(busqueda, limite, offset);
    const registros = rows.map(r => mapearRegistro(r));

    res.json({ registros, total, pagina, limite, totalPaginas: Math.ceil(total / limite) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Función helper para mapear registro de BD a objeto JS
function mapearRegistro(r) {
  return {
    "Folio de continuidad": r.folio,
    "Fecha de recepción de correo": r.fecha_recepcion,
    "Fecha de aclaración sucursal": r.fecha_aclaracion,
    "Nombre del Usuario": r.nombre_usuario,
    "Sexo": r.sexo,
    "Año de nacimiento": r.anio_nacimiento,
    "Referencia de sucursal": r.ref_sucursal,
    "Sucursal": r.sucursal,
    "Acuerdo": r.acuerdo,
    "Número de tarjeta": r.num_tarjeta,
    "Canal": r.canal,
    "Descripción del canal": r.desc_canal,
    "Motivo de reclamación": r.motivo,
    "Descripción de motivo de reclamación": r.desc_motivo,
    "Banco/establecimiento": r.banco,
    "Referencia del cajero/establecimientio": r.ref_cajero,
    "Monto": r.monto,
    "Fecha del movimiento": r.fecha_movimiento,
    "Entidad": r.entidad || '',
    "Código Postal": r.codigo_postal || '',
    "Municipio": r.municipio || '',
    "Localidad": r.localidad || '',
    "Estatus": r.estatus,
    "Fecha de envío a compensación": r.fecha_envio,
    "Fecha de estatus a sucursal": r.fecha_estatus,
    "RESPUESTA": r.respuesta || '',
    "FECHA DE RESPUESTA POR COMP. Y LIQUIDACIÓN": r.fecha_respuesta_comp || '',
    "FECHA ENVÍO DE RESPUESTA A SUCURSAL": r.fecha_envio_respuesta || '',
    "FECHA ABONO": r.fecha_abono || '',
    "OBSERVACIÓN": r.observacion || '',
    "Motivo procedencia/improcedencia": r.motivo_procedencia || '',
    "Nombre del programa": r.programa,
    "LOCALIDAD CAJERO": r.localidad_cajero || '',
    "N. CELULAR": r.celular,
    "Bloqueo de tarjeta": r.bloqueo,
    "N. DE TARJETA QUE TRANSACCIONÓ": r.num_tarjeta_transacciono || r.num_tarjeta || "",
    "Canal de atención": r.canal_atencion || ""
  };
}



// Todos los registros de un rango sin paginación — para exportar y eliminar
app.get('/registros/rango', verificarIP, (req, res) => {
  try {
    const desde = req.query.desde || '';
    const hasta = req.query.hasta || '';

    let rows;
    if (desde && hasta) {
      const parseFecha = (f) => {
        const [y,m,d] = f.split('-');
        return `${d}/${m}/${y}`;
      };
      const desdeStr = parseFecha(desde);
      const hastaStr = parseFecha(hasta);
      rows = db.prepare(`
        SELECT * FROM registros 
        WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
              >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
          AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) 
              <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
        ORDER BY substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) ASC, id ASC
      `).all(desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr);
    } else {
      rows = db.prepare(`SELECT * FROM registros ORDER BY substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) ASC, id ASC`).all();
    }

    const registros = rows.map(r => mapearRegistro(r));
    res.json({ registros, total: registros.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Encontrar página de un registro
app.get('/registros/pagina-de', verificarIP, (req, res) => {
  try {
    const { termino, tipo, limite = 300, desde, hasta } = req.query;
    if (!termino) return res.json({ pagina: 1 });

    const campoBD = {
      'folio': 'folio',
      'acuerdo': 'acuerdo',
      'tarjeta': 'num_tarjeta',
      'nombre': 'nombre_usuario'
    }[tipo] || 'folio';

    let whereBase, params;
    if (desde && hasta) {
      const parseFecha = f => { const [y,m,d] = f.split('-'); return `${d}/${m}/${y}`; };
      whereBase = `substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2) AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)`;
      params = [parseFecha(desde), parseFecha(desde), parseFecha(desde), parseFecha(hasta), parseFecha(hasta), parseFecha(hasta)];
    } else {
      whereBase = '1=1';
      params = [];
    }

    // Contar cuántos registros van antes del encontrado en el orden actual
    const objetivo = db.prepare(`
      SELECT id,
        substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) as fecha_ord
      FROM registros WHERE ${campoBD} LIKE ? LIMIT 1
    `).get(`%${termino}%`);

    if (!objetivo) return res.json({ pagina: 1 });

    const posicion = db.prepare(`
      SELECT COUNT(*) as pos FROM registros
      WHERE (${whereBase})
        AND (
          substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) > ?
          OR (
            substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) = ?
            AND id > ?
          )
        )
    `).get(...params, objetivo.fecha_ord, objetivo.fecha_ord, objetivo.id);

    const pagina = Math.floor((posicion?.pos || 0) / parseInt(limite)) + 1;
    res.json({ pagina });
  } catch(e) {
    console.error('ERROR pagina-de:', e.message, e.stack);
    res.status(500).json({ error: e.message, pagina: 1 });
  }
});



// Tendencia diaria
app.get('/registros/stats-tendencia', verificarIP, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.json([]);

    const parseFecha = f => { const [y,m,d] = f.split('-'); return `${d}/${m}/${y}`; };
    const desdeStr = parseFecha(desde);
    const hastaStr = parseFecha(hasta);

    const rows = db.prepare(`
      SELECT fecha_recepcion as fecha, COUNT(*) as total
      FROM registros
      WHERE substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2)
            >= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
        AND substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2)
            <= substr(?,7,4)||substr(?,4,2)||substr(?,1,2)
      GROUP BY fecha_recepcion
      ORDER BY substr(fecha_recepcion,7,4)||substr(fecha_recepcion,4,2)||substr(fecha_recepcion,1,2) ASC
    `).all(desdeStr, desdeStr, desdeStr, hastaStr, hastaStr, hastaStr);

    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// Verificar duplicado por acuerdo+monto+fecha_movimiento
app.get('/registros/verificar-duplicado', verificarIP, (req, res) => {
  try {
    const { acuerdo, monto, fecha_movimiento, folio_excluir } = req.query;
    if (!acuerdo || !monto || !fecha_movimiento) return res.json({ duplicado: false });

    const row = db.prepare(`
      SELECT folio FROM registros 
      WHERE acuerdo = ? AND CAST(monto AS REAL) = CAST(? AS REAL) AND fecha_movimiento = ? AND folio != ?
      LIMIT 1
    `).get(acuerdo, parseFloat(monto), fecha_movimiento, folio_excluir || '');

    res.json({ duplicado: !!row, folio: row?.folio || null });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});




// ==============================
// SOCKET.IO — Tiempo real
// ==============================
io.on('connection', (socket) => {
  console.log(`✅ Cliente conectado: ${socket.handshake.address}`);
  socket.on('disconnect', () => {
    console.log(`❌ Cliente desconectado: ${socket.handshake.address}`);
  });
});


app.get('/debug/registro/:folio', (req, res) => {
  const r = db.prepare('SELECT * FROM registros WHERE folio = ?').get(req.params.folio);
  res.json(r);
});


app.get('/debug/conteo-anual', verificarIP, (req, res) => {
  const rows = db.prepare(`
    SELECT substr(fecha_recepcion,7,4) as anio, COUNT(*) as total
    FROM registros
    GROUP BY substr(fecha_recepcion,7,4)
    ORDER BY anio
  `).all();
  res.json(rows);
});



// ==============================
// REPORTE R27 A-2701 RECLAMACIONES
// ==============================

const CAT_ORIGEN = { 701: 'Institución', 702: 'UNE', 703: 'CONDUSEF' };
const CAT_PERSONA = { 801: 'Persona física nacional', 802: 'Persona física con actividad empresarial nacional', 803: 'Persona moral nacional', 804: 'Persona física extranjera', 805: 'Persona física con actividad empresarial extranjera', 806: 'Persona moral extranjera' };
const CAT_VULNERABILIDAD = { 0: 'El usuario no es una persona en situación de vulnerabilidad', 901: 'Personas adultas mayores', 902: 'Personas con discapacidad', 903: 'Personas pertenecientes a alguna etnia, pueblo o comunidad indígena', 904: 'El usuario se declara perteneciente a más de un grupo de personas en situación de vulnerabilidad', 999: 'Otro' };
const CAT_FACTOR_AUTH = { 0: 'La operación monetaria no requiere de un factor de autenticación', 1001: 'Factor de autenticación categoría 1', 1002: 'Factor de autenticación categoría 2', 1003: 'Factor de autenticación categoría 3', 1004: 'Factor de autenticación categoría 4' };
const CAT_FACTOR_AUTH_SUPERA = { 0: 'No se rebasó el monto transaccional del usuario', 1101: 'Mensaje instantáneo con protocolo de cifrado', 1102: 'Llamada telefónica', 1103: 'Correo electrónico con protocolo de cifrado', 1104: 'A través de una confirmación de banca móvil (operaciones distintas a las realizadas por banca móvil)', '-999': 'No aplica' };
const CAT_PRODUCTO = { 101: 'Cuentas de depósitos a la vista', 102: 'Valores e instrumentos de inversión', 103: 'Tarjeta de Débito', 104: 'Tarjeta de crédito', 105: 'Tarjeta prepagada', 106: 'Cuentas de nómina', 107: 'Crédito hipotecario', 108: 'Crédito automotriz', 109: 'Crédito de nómina', 110: 'Crédito al consumo ABCD', 111: 'Crédito personal' };
const CAT_CANAL = { 201: 'Operaciones por internet personas físicas', 202: 'Operaciones por internet personas morales', 203: 'Comercio por internet', 204: 'Banca por teléfono', 205: 'Comercio por teléfono', 206: 'Cajeros Automáticos', 207: 'Terminal punto de venta', 208: 'Sucursales', 209: 'Corresponsales', 210: 'Pagos por celular', 211: 'Banca móvil', 212: 'Movimiento generado por el banco', 213: 'Otros bancos', 214: 'Servicio de adquirencia', 290: 'Por definir' };
const CAT_MOTIVO = { 301: 'Cargo no reconocido por consumos efectuados', 302: 'Cobro no reconocido de comisión por manejo de cuenta', 303: 'Cobro no reconocido de intereses ordinarios y/o moratorios', 304: 'Cobro no reconocido por comisiones por disposiciones de efectivo', 305: 'Cobro no reconocido por otras comisiones', 306: 'Depósito no acreditado', 307: 'Devolución no aplicada', 308: 'Inconformidad de rendimientos o capital pagados', 309: 'Inconformidad por alteración de pagarés', 310: 'No Entrega Cantidad Solicitada', 311: 'Pago automático mal aplicado total o parcialmente (domiciliaciones)', 312: 'Pago no acreditado', 313: 'Transferencia no reconocida', 314: 'Retiro no reconocido', 315: 'Cheques mal negociados', 316: 'Producto no reconocido', 317: 'Error operativo del banco', 318: 'Error operativo del usuario', 319: 'Cobro no reconocido de impuestos y otros cargos', 320: 'Transferencia no acreditada', 321: 'Cargos por servicios de adquirencia', 322: 'Abonos por servicios de adquirencia', 323: 'Suplantación de identidad', 324: 'Pago duplicado', 390: 'Por definir' };
const CAT_CONTACTO = { 0: 'Operación realizada por un canal no relacionado a la tecnología de pago sin contacto', 1401: 'Operación realizada utilizando la tecnología de pago sin contacto', 1402: 'Operación realizada sin utilizar la tecnología de pago sin contacto' };
const CAT_ESTADO = { 401: 'Pendiente', 402: 'Concluida', 403: 'Concluida en reapertura' };
const CAT_RESOLUCION = { 501: 'Procedente', 502: 'Improcedente', 503: 'Pendiente' };
const CAT_CAUSA = { 601: 'Usuario desistió', 602: 'Falta documentación del usuario', 603: 'Plazo vencido al usuario', 604: 'Reclamación reportada en más de una ocasión', 605: 'Evidencia a Favor del Banco', 650: 'Por Normatividad', 651: 'Evidencia a Favor del Usuario', 652: 'Plazo vencido al banco', 653: 'Por política interna', 654: 'Pendiente' };
const CAT_MEDIO_RECUPERO = { 0: 'Resolución pendiente', 1200: 'Quebranto', 1201: 'Reclamación improcedente', 1202: 'Contratación de un seguro', 1203: 'Cargo al comercio', 1204: 'El importe lo cubrió el adquirente', 1205: 'Cargo a otra institución', 1206: 'Cargo al emisor', 1207: 'Cargo a otro cuentahabiente', 1208: 'Cargo al usuario que generó la reclamación', 1209: 'Cancelación de operación monetaria no reconocida', 1299: 'Otro' };
const CAT_FRAUDE = { 0: 'La reclamación no corresponde a una conducta observable para la gestión del fraude', 1301: 'Conducta interna: suplantación o usurpación de identidad del usuario', 1302: 'Conducta interna: robo de datos personales e información financiera del usuario', 1303: 'Conducta interna: suplantación de identidad de la propia institución', 1304: 'Conducta interna: uso de información privilegiada de los usuarios por empleados de las instituciones', 1305: 'Conducta interna: comprometer los medios electrónicos empleados por el usuario con el objetivo de instalar un código malicioso capaz de alterar la realización de operaciones monetarias', 1306: 'Conducta interna: alteración de cheques y emisión de cheques falsos', 1307: 'Conducta externa: suplantación o usurpación de identidad del usuario', 1308: 'Conducta externa: robo de datos personales e información financiera del usuario', 1309: 'Conducta externa: suplantación de identidad de la propia institución', 1310: 'Conducta externa: comprometer los medios electrónicos empleados por el usuario con el objetivo de instalar un código malicioso capaz de alterar la realización de operaciones monetarias', 1311: 'Conducta externa: alteración de cheques y emisión de cheque falsos' };

const MAPA_CAUSA = {
  'Confirmación por tira auditora': 605,
  'A favor del cliente': 651,
  'Error en información': 602,
  'Dev. Masiva o reverso': 651,
  'Plazo vencido': 603,
  'Monto menor': 653,
  'DUPLICADA': 604,
  'Cliente Desistió': 601,
  'Usuario Desistió': 601,
  'Falta Documentación del Cliente': 602,
  'Plazo Vencido al Cliente': 603,
  'Plazo Vencido al Usuario': 603,
  'Reclamación Reportada en Más de Una Ocasión': 604,
  'Evidencia a Favor del Banco': 605,
  'Por Normatividad': 650,
  'Evidencia a Favor del Cliente': 651,
  'Evidencia a Favor del Usuario': 651,
  'Plazo Vencido al Banco': 652,
  'Por Política Interna': 653,
  'Pendiente': 654,
};

function ultimoDiaMes(periodo) {
  const anio = parseInt(periodo.slice(0, 4));
  const mes = parseInt(periodo.slice(4, 6));
  return new Date(anio, mes, 0);
}

function formatFechaR27(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s || s === '' || s === '0') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s.slice(0, 10);
}

function fechaLimitadaR27(fechaStr, periodoUltimoDia, primerDia) {
  if (!fechaStr) return null;
  const f = formatFechaR27(fechaStr);
  if (!f) return null;
  const limite = periodoUltimoDia.toISOString().slice(0, 10);
  if (f > limite) return limite;
  if (primerDia && f < primerDia) return primerDia;
  return f;
}

function buildIdentificadorR27(reg) {
  const canal = parseInt(reg.canal);
  if (canal === 208) return 'VENTANILLA/BANCO DEL BIENESTAR';
  const ref = (reg.ref_cajero || '').trim();
  const banco = (reg.banco || '').trim();
  if (!ref && !banco) return '';
  const combinado = ref ? `${ref}/${banco}` : banco;
  return combinado.slice(0, 30);
}

app.post('/reporte/r27', verificarIP, upload.single('archivoEnriquecimiento'), async (req, res) => {
  try {
    const { periodo } = req.body;
    if (!periodo || !/^\d{6}$/.test(periodo)) {
      return res.status(400).json({ ok: false, error: 'Periodo inválido. Formato esperado: AAAAMM' });
    }

    const anio = periodo.slice(0, 4);
    const mes = periodo.slice(4, 6);
    const ultimoDia = ultimoDiaMes(periodo);
    const ultimoDiaStr = ultimoDia.toISOString().slice(0, 10);
    const primerDiaStr = `${anio}-${mes}-01`;

    const todosLosRegistros = db.prepare(`SELECT * FROM registros`).all();
    const registros = todosLosRegistros.filter(r => {
      const f = formatFechaR27(r.fecha_recepcion);
      if (!f) return false;
      return f.startsWith(`${anio}-${mes}`);
    });

    if (registros.length === 0) {
      return res.status(404).json({ ok: false, error: `No se encontraron registros para el periodo ${periodo}` });
    }

    let enriquecimiento = {};
    if (req.file) {
      const wbEnr = new ExcelJS.Workbook();
      await wbEnr.xlsx.readFile(req.file.path);
      const wsEnr = wbEnr.worksheets[0];
      wsEnr.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const folio = String(row.getCell(1).value || '').trim();
        const rfc = String(row.getCell(2).value || '').trim();
        const curp = String(row.getCell(3).value || '').trim();
        if (folio) enriquecimiento[folio] = { rfc, curp };
      });
      try { require('fs').unlinkSync(req.file.path); } catch(e) {}
    }

    const foliosSinEnriquecimiento = registros
      .filter(r => !enriquecimiento[r.folio])
      .map(r => r.folio);
    const foliosConflictoCadena = [];

    const RFC_GENERICO = 'XAXX010101000';
    const CURP_GENERICO = '0';

    const filas = registros.map(r => {
      const enr = enriquecimiento[r.folio] || {};

      let rfc = (enr.rfc || '').trim();
      if (!rfc) rfc = RFC_GENERICO;
      if (rfc !== RFC_GENERICO && rfc.length < 13) rfc = rfc.padEnd(13, 'X');

      const curp = (enr.curp || '').trim() || CURP_GENERICO;
      const canalNum = parseInt(r.canal) || 0;
      const descCanal = CAT_CANAL[canalNum] || (r.desc_canal || '');
      const productoNum = (canalNum === 206 || canalNum === 207) ? 103 : 101;
      const descProducto = CAT_PRODUCTO[productoNum] || '';
      const numTarjeta = (productoNum === 103) ? (r.num_tarjeta || '').trim() : (r.acuerdo || '').trim();
      const programaStr = (r.programa || '').trim().toUpperCase();
      let vulnerabilidadNum = 0;
      if (programaStr === 'ADULTOS MAYORES') vulnerabilidadNum = 901;
      else if (programaStr === 'DISCAPACIDAD') vulnerabilidadNum = 902;
      const descVulnerabilidad = CAT_VULNERABILIDAD[vulnerabilidadNum] || '';
      const factorAuthNum = (canalNum === 211) ? 1003 : 1002;
      const descFactorAuth = CAT_FACTOR_AUTH[factorAuthNum] || '';
      const canalAtencionStr = (r.canal_atencion || '').trim().toUpperCase();
      let origenNum = 0;
      if (canalAtencionStr === 'TCHIP') origenNum = 701;
      else if (canalAtencionStr === 'UEAU') origenNum = 702;
      else if (canalAtencionStr === 'SIGE') origenNum = 703;
      const descOrigen = CAT_ORIGEN[origenNum] || '';
      const motivoNum = parseInt(r.motivo) || 0;
      const descMotivo = CAT_MOTIVO[motivoNum] || (r.desc_motivo || '');
      const identificador = buildIdentificadorR27(r);
      const adquirente = (r.banco || '').trim();

      const respuesta = (r.respuesta || '').trim().toUpperCase();
      let estadoClave, resolucionClave;
      if (respuesta === 'PROCEDIO' || respuesta === 'NO PROCEDIO') {
        estadoClave = 402;
        resolucionClave = respuesta === 'PROCEDIO' ? 501 : 502;
      } else {
        estadoClave = 401;
        resolucionClave = 503;
      }

      let fechaResolucion;
      if (estadoClave === 401) {
        fechaResolucion = '9999-12-31';
      } else {
        const fr = fechaLimitadaR27(r.fecha_envio_respuesta, ultimoDia, primerDiaStr);
        fechaResolucion = fr || ultimoDiaStr;
      }

      const motivoProcedencia = (r.motivo_procedencia || '').trim();
      let causaClave = 654;
      if (motivoProcedencia && MAPA_CAUSA[motivoProcedencia] !== undefined) {
        causaClave = MAPA_CAUSA[motivoProcedencia];
      }

      const monto = parseFloat(r.monto) || 0;
      const importeAbonado = resolucionClave === 501 ? monto : 0;
      const importeRecuperado = resolucionClave === 501 ? monto : 0;

      let fechaAbono;
      if (resolucionClave === 501) {
        const fa = fechaLimitadaR27(r.fecha_abono, ultimoDia, primerDiaStr);
        fechaAbono = fa || ultimoDiaStr;
        if (fechaAbono > fechaResolucion) fechaAbono = fechaResolucion;
      } else {
        fechaAbono = '9999-12-31';
      }

      // Verificación de cadena de fechas en el R27 generado
      const fMovR27   = formatFechaR27(r.fecha_movimiento) || '';
      const fRecepR27 = formatFechaR27(r.fecha_recepcion)  || '';
      const rotas = [];
      if (fMovR27 && fRecepR27 && fMovR27 > fRecepR27)
        rotas.push('FECHA_MOV > FECHA_RECEP');
      if (fRecepR27 && fechaResolucion !== '9999-12-31' && fRecepR27 > fechaResolucion)
        rotas.push('FECHA_RECEP > FECHA_RESOLUCION');
      if (fMovR27 && fechaAbono !== '9999-12-31' && fMovR27 > fechaAbono)
        rotas.push('FECHA_MOV > FECHA_ABONO');
      if (rotas.length > 0) {
        foliosConflictoCadena.push({
          folio: r.folio,
          fecha_mov: fMovR27,
          fecha_recep: fRecepR27,
          fecha_resolucion: fechaResolucion,
          fecha_abono: fechaAbono,
          reglas: rotas.join(' | ')
        });
      }

      let medioRecupero;
      if (resolucionClave === 501) medioRecupero = 1208;
      else if (resolucionClave === 502) medioRecupero = 1201;
      else medioRecupero = 0;

      return [
        'Gcía. Aclaraciones', periodo, '37-166', 2701, r.folio,
        formatFechaR27(r.fecha_recepcion) || '', origenNum, descOrigen,
        formatFechaR27(r.fecha_movimiento) || '', obtenerClaveEntidad(r.ref_sucursal), r.municipio || 0,
        rfc, curp, 801, CAT_PERSONA[801], numTarjeta,
        vulnerabilidadNum, descVulnerabilidad,
        0.00, factorAuthNum, descFactorAuth,
        0, CAT_FACTOR_AUTH_SUPERA[0],
        productoNum, descProducto, identificador, adquirente,
        canalNum, descCanal, motivoNum, descMotivo,
        0, CAT_CONTACTO[0],
        monto, estadoClave, CAT_ESTADO[estadoClave],
        resolucionClave, CAT_RESOLUCION[resolucionClave], fechaResolucion,
        causaClave, CAT_CAUSA[causaClave] || '',
        importeAbonado, fechaAbono, importeRecuperado,
        medioRecupero, CAT_MEDIO_RECUPERO[medioRecupero] || '',
        0.00, 0, CAT_FRAUDE[0]
      ];
    });

    const HEADERS = [
      'ÁREA','PERIODO','CLAVE DE LA INSTITUCIÓN','REPORTE','FOLIO DE RECLAMACIÓN',
      'FECHA DE RECLAMACIÓN','ORIGEN DE LA RECLAMACIÓN','DESCRIPCIÓN / ORIGEN DE LA RECLAMACIÓN',
      'FECHA DE SUCESO','ENTIDAD FEDERATIVA DONDE SE ORIGINÓ LA RECLAMACIÓN',
      'MUNICIPIO 0  ALCALDİA DONDE SE ORIGINÓ LA RECLAMACIÓN','RFC DEL CLIENTE','CURP DEL CLIENTE',
      'PERSONA FÍSICA O MORAL','DESCRIPCIÓN / PERSONA FÍSICA O MORAL',
      'NÚMERO DE CUENTA / NÚMERO DE TDC / NÚMERO  DE TDD / NÚMERO DE TPB',
      'PERSONA EN SITUACIÓN DE VULNERABILIDAD','DESCRIPCIÓN / PERSONA EN SITUACIÓN DE VULNERABILIDAD',
      'MONTO TRANSACCIONAL  DEL USUARIO','USO DE FACTOR DE AUTENTICACIÓN Y CATEGORÍA',
      'DESCRIPCIÓN / USO DE FACTOR DE AUTENTICACIÓN Y CATEGORÍA',
      'USO  DE FACTOR  DE AUTENTICACIÓN  Y CATEGORÍA  CUANDO SE SUPERA EL MONTO TRANSACCIONAL DEL USUARIO',
      'DESCRIPCIÓN / USO  DE FACTOR  DE AUTENTICACIÓN  Y CATEGORÍA  CUANDO SE SUPERA EL MONTO TRANSACCIONAL DEL USUARIO',
      'PRODUCTO','DESCRIPCIÓN / PRODUCTO',
      'IDENTIFICADOR  DE INSTITUCIÓN,  COMISIONISTA  O  COMERCIO  DONDE SE REALIZA LA OPERACIÓN',
      'NOMBRE DEL ADQUIRENTE EN CASO DE OPERACIONES EN TPV',
      'CANAL EN EL CUAL SE REALIZÓ LA TRANSACCIÓN','DESCRIPCIÓN / CANAL EN EL CUAL SE REALIZÓ LA TRANSACCIÓN',
      'MOTIVO DE LA RECLAMACIÓN','DESCRIPCIÓN / MOTIVO DE LA RECLAMACIÓN',
      'TRANSACCIÓN CON TECNOLOGÍA DE PAGO SIN CONTACTO',
      'DESCRIPCIÓN / TRANSACCIÓN CON TECNOLOGÍA DE PAGO SIN CONTACTO',
      'MONTO DE LA RECLAMACIÓN','ESTADO DE LA RECLAMACIÓN','DESCRIPCIÓN / ESTADO DE LA RECLAMACIÓN',
      'RESOLUCIÓN','DESCRIPCIÓN / RESOLUCIÓN','FECHA DE RESOLUCIÓN','CAUSA DE RESOLUCIÓN',
      'DESCRIPCIÓN / CAUSA DE RESOLUCIÓN','IMPORTE ABONADO AL CLIENTE','FECHA DE ABONO AL CLIENTE',
      'IMPORTE RECUPERADO','MEDIO POR EL CUAL SE RECUPERÓ EL IMPORTE',
      'DESCRIPCIÓN / MEDIO POR EL CUAL SE RECUPERÓ EL IMPORTE',
      'QUEBRANTO PARA LA INSTITUCIÓN','CONDUCTA OBSERVABLE DE GESTIÓN DEL FRAUDE',
      'DESCRIPCIÓN / CONDUCTA OBSERVABLE DE GESTIÓN DEL FRAUDE'
    ];

    const COL_WIDTHS = [13,13,13,13,13,20.57,13,13,13,13,13,16.71,23.57,13,20.43,17.57,13,13,13,13,13,13,13,13,13,27.57,28.71,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hoja1');

    const headerRow = ws.getRow(1);
    HEADERS.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9, name: 'Noto Sans', color: { argb: 'FF000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    });
    headerRow.height = 195;

    COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    filas.forEach((fila, idx) => {
      const row = ws.getRow(idx + 2);
      fila.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        if ([5, 8, 38, 42].includes(i) && v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const [yyyy, mm, dd] = v.split('-').map(Number);
          const fecha = new Date(Date.UTC(yyyy, mm - 1, dd));
          cell.value = fecha;
          cell.numFmt = 'yyyy-mm-dd';
        } else {
          cell.value = v;
        }
        cell.font = { size: 9, name: 'Calibri' };
        cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        if ([18, 33, 41, 43, 46].includes(i)) cell.numFmt = '0.00';
      });
      row.height = 15;
    });

    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm2 = String(hoy.getMonth() + 1).padStart(2, '0');
    const yyyy = hoy.getFullYear();
    const nombreArchivo = `R27_${periodo}_${dd}${mm2}${yyyy}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    if (foliosSinEnriquecimiento.length > 0) {
      res.setHeader('X-Folios-Sin-Enriquecimiento', JSON.stringify(foliosSinEnriquecimiento).slice(0, 500));
    }
    if (foliosConflictoCadena.length > 0) {
      res.setHeader('X-Folios-Conflicto-Cadena', JSON.stringify(foliosConflictoCadena).slice(0, 4000));
    }

    await wb.xlsx.write(res);
  } catch (err) {
    console.error('Error generando R27:', err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});


// ==============================
// ARRANCAR SERVIDOR
// ==============================
const PUERTO = 3000;
server.listen(PUERTO, '0.0.0.0', () => {
  console.log(`🚀 Servidor TSU corriendo en puerto ${PUERTO}`);
  console.log(`📡 Acceso local: http://localhost:${PUERTO}`);
});



<!--// ==============================-->
 <!--* Proyecto: Sistema de Captura / TSU.-->
<!--* Arquitectura y Desarrollo Base (v1.0): J. Jesus Osorio Montufar.-->
 <!--* Fecha de creación: 2025.-->
<!--// ==============================-->
