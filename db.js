const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const usingSupabase = Boolean(supabaseUrl && supabaseKey);
const supabase = usingSupabase ? createClient(supabaseUrl, supabaseKey) : null;
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'inventario.db');
let db = null;

function sqliteRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
    if (error) return reject(error);
    resolve({ id: this.lastID, changes: this.changes });
  }));
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function ensureNoError(error) {
  if (error) throw new Error(`Supabase: ${error.message}`);
}

async function all(sql) {
  if (!usingSupabase) return sqliteAll(sql);
  if (sql.includes('FROM productos')) {
    const { data, error } = await supabase.from('productos').select('*').eq('activo', true).order('descripcion');
    ensureNoError(error);
    return data;
  }
  const { data, error } = await supabase.from('movimientos')
    .select('codigo, descripcion, cantidad, usuario, fecha, hora').order('id', { ascending: false });
  ensureNoError(error);
  return data;
}

async function get(sql, params = []) {
  if (!usingSupabase) return sqliteGet(sql, params);
  let query = supabase.from('productos').select('*').ilike('codigo', params[0]);
  if (sql.includes('AND id != ?')) query = query.neq('id', params[1]);
  const { data, error } = await query.maybeSingle();
  ensureNoError(error);
  return data;
}

async function run(sql, params = []) {
  if (!usingSupabase) return sqliteRun(sql, params);
  let response;
  if (sql.startsWith('INSERT INTO productos')) {
    response = await supabase.from('productos').insert({ codigo: params[0], descripcion: params[1], marca: params[2], talle: params[3] || null, color: params[4] || null, ubicacion: params[5], stock_teorico: params[6] }).select('id').single();
  } else if (sql.startsWith('UPDATE productos SET descripcion')) {
    response = await supabase.from('productos').update({ descripcion: params[0], marca: params[1], talle: params[2] || null, color: params[3] || null, ubicacion: params[4], stock_teorico: params[5] }).eq('id', params[6]).select('id');
  } else if (sql.startsWith('UPDATE productos SET codigo')) {
    response = await supabase.from('productos').update({ codigo: params[0], descripcion: params[1], marca: params[2], talle: params[3] || null, color: params[4] || null, ubicacion: params[5], stock_teorico: params[6] }).eq('id', params[7]).select('id');
  } else if (sql.startsWith('UPDATE movimientos')) {
    response = await supabase.from('movimientos').update({ codigo: params[0], descripcion: params[1] }).ilike('codigo', params[2]).select('id');
  } else if (sql.startsWith('DELETE FROM movimientos')) {
    response = await supabase.from('movimientos').delete().ilike('codigo', params[0]).select('id');
  } else if (sql.startsWith('DELETE FROM productos')) {
    response = await supabase.from('productos').delete().ilike('codigo', params[0]).select('id');
  } else if (sql.startsWith('INSERT INTO movimientos')) {
    response = await supabase.from('movimientos').insert({ codigo: params[0], descripcion: params[1], cantidad: params[2], usuario: params[3], fecha: params[4], hora: params[5], tipo: params[6] }).select('id').single();
  } else {
    throw new Error('Consulta no compatible con Supabase');
  }
  ensureNoError(response.error);
  const rows = Array.isArray(response.data) ? response.data : [response.data].filter(Boolean);
  return { id: rows[0] && rows[0].id, changes: rows.length };
}

async function initializeDb() {
  if (usingSupabase) {
    const { error } = await supabase.from('productos').select('id').limit(1);
    if (error) throw new Error(`No se pudo conectar a Supabase. Ejecutá primero supabase/schema.sql: ${error.message}`);
    console.log('Supabase listo');
    return;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  db = new sqlite3.Database(dbPath, (error) => { if (error) console.error(error.message); });
  await sqliteRun('CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE NOT NULL, descripcion TEXT NOT NULL, marca TEXT, talle TEXT, color TEXT, ubicacion TEXT, stock_teorico REAL DEFAULT 0, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const productColumns = await sqliteAll('PRAGMA table_info(productos)');
  if (!productColumns.some((column) => column.name === 'talle')) await sqliteRun('ALTER TABLE productos ADD COLUMN talle TEXT');
  if (!productColumns.some((column) => column.name === 'color')) await sqliteRun('ALTER TABLE productos ADD COLUMN color TEXT');
  await sqliteRun("CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, descripcion TEXT, cantidad REAL NOT NULL, usuario TEXT, fecha TEXT, hora TEXT, tipo TEXT DEFAULT 'conteo', created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const movementColumns = await sqliteAll('PRAGMA table_info(movimientos)');
  if (!movementColumns.some((column) => column.name === 'deposito')) await sqliteRun("ALTER TABLE movimientos ADD COLUMN deposito TEXT NOT NULL DEFAULT 'Ático'");
  await sqliteRun("UPDATE movimientos SET deposito = 'Ático' WHERE deposito IS NULL OR TRIM(deposito) = ''");
  await sqliteRun('CREATE TABLE IF NOT EXISTS depositos (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, activo INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await sqliteRun("INSERT OR IGNORE INTO depositos (nombre, activo) VALUES ('Ático', 1)");
  await sqliteRun("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'operador', activo INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const demoProducts = [
    ['FMPD00812', 'Pastilla de freno delantera', 'Frasle', 'A-01-2', 15], ['FLTF00120', 'Filtro de aceite motor 1.6', 'Fram', 'B-03-1', 40], ['BGB009400', 'Bujía de encendido Iridium', 'NGK', 'A-05-4', 100], ['AMR002100', 'Amortiguador delantero izq.', 'Monroe', 'C-02-1', 8], ['COR005432', 'Correa de distribución 124T', 'Dayco', 'B-01-3', 20]
  ];
  for (const product of demoProducts) {
    if (!await sqliteGet('SELECT id FROM productos WHERE LOWER(codigo) = LOWER(?)', [product[0]])) {
      await sqliteRun('INSERT INTO productos (codigo, descripcion, marca, ubicacion, stock_teorico) VALUES (?, ?, ?, ?, ?)', product);
    }
  }
  console.warn(`ADVERTENCIA: SQLite listo en: ${dbPath}. Esta base es local y no es persistente en Render; configurá SUPABASE_URL y SUPABASE_SECRET_KEY antes de usar el sistema en producción.`);
}

async function listDeposits() {
  if (!usingSupabase) return sqliteAll('SELECT id, nombre, activo FROM depositos WHERE activo = 1 ORDER BY nombre');
  const { data, error } = await supabase.from('depositos').select('id, nombre, activo').eq('activo', true).order('nombre');
  ensureNoError(error); return data || [];
}

async function createDeposit(nombre) {
  if (!usingSupabase) {
    const result = await sqliteRun('INSERT INTO depositos (nombre, activo) VALUES (?, 1)', [nombre]);
    return { id: result.id, nombre, activo: 1 };
  }
  const { data, error } = await supabase.from('depositos').insert({ nombre, activo: true }).select('id, nombre, activo').single();
  ensureNoError(error); return data;
}

async function getStock(codigo, deposito) {
  if (!usingSupabase) {
    const row = await sqliteGet("SELECT COALESCE(SUM(CASE WHEN tipo = 'salida' THEN -cantidad ELSE cantidad END), 0) AS stock FROM movimientos WHERE LOWER(codigo) = LOWER(?) AND LOWER(deposito) = LOWER(?)", [codigo, deposito]);
    return Number(row && row.stock || 0);
  }
  const { data, error } = await supabase.from('movimientos').select('cantidad, tipo').ilike('codigo', codigo).ilike('deposito', deposito);
  ensureNoError(error);
  return (data || []).reduce((total, item) => total + (item.tipo === 'salida' ? -Number(item.cantidad) : Number(item.cantidad)), 0);
}

async function addMovement({ codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito }) {
  if (!usingSupabase) return sqliteRun('INSERT INTO movimientos (codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito]);
  const { data, error } = await supabase.from('movimientos').insert({ codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito }).select('id').single();
  ensureNoError(error); return { id: data.id, changes: 1 };
}

async function listMovements() {
  if (!usingSupabase) return sqliteAll('SELECT codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito FROM movimientos ORDER BY id DESC');
  const { data, error } = await supabase.from('movimientos').select('codigo, descripcion, cantidad, usuario, fecha, hora, tipo, deposito').order('id', { ascending: false });
  ensureNoError(error); return data || [];
}

async function countUsers() {
  if (!usingSupabase) return (await sqliteGet('SELECT COUNT(*) AS total FROM usuarios')).total;
  const { count, error } = await supabase.from('usuarios').select('*', { count: 'exact', head: true });
  ensureNoError(error);
  return count || 0;
}

async function findUserByName(nombre) {
  if (!usingSupabase) return sqliteGet('SELECT * FROM usuarios WHERE LOWER(nombre) = LOWER(?)', [nombre]);
  const { data, error } = await supabase.from('usuarios').select('*').ilike('nombre', nombre).maybeSingle();
  ensureNoError(error);
  return data;
}

async function createUser({ nombre, passwordHash, rol }) {
  if (!usingSupabase) {
    const result = await sqliteRun('INSERT INTO usuarios (nombre, password_hash, rol, activo) VALUES (?, ?, ?, 1)', [nombre, passwordHash, rol]);
    return { id: result.id, nombre, rol, activo: 1 };
  }
  const { data, error } = await supabase.from('usuarios').insert({ nombre, password_hash: passwordHash, rol, activo: true }).select('id, nombre, rol, activo').single();
  ensureNoError(error);
  return data;
}

async function listUsers() {
  if (!usingSupabase) return sqliteAll('SELECT id, nombre, rol, activo, created_at FROM usuarios ORDER BY nombre');
  const { data, error } = await supabase.from('usuarios').select('id, nombre, rol, activo, created_at').order('nombre');
  ensureNoError(error);
  return data || [];
}

async function deactivateUser(id) {
  if (!usingSupabase) return sqliteRun('UPDATE usuarios SET activo = 0 WHERE id = ?', [id]);
  const { data, error } = await supabase.from('usuarios').update({ activo: false }).eq('id', id).select('id');
  ensureNoError(error);
  return { changes: (data || []).length };
}

module.exports = {
  initializeDb, all, get, run, storageType: usingSupabase ? 'supabase' : 'sqlite', isPersistent: usingSupabase,
  countUsers, findUserByName, createUser, listUsers, deactivateUser,
  listDeposits, createDeposit, getStock, addMovement, listMovements
};
