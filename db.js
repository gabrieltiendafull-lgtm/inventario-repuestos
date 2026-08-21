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

function sqliteAll(sql) {
  return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
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
    response = await supabase.from('productos').insert({ codigo: params[0], descripcion: params[1], marca: params[2], ubicacion: params[3], stock_teorico: params[4] }).select('id').single();
  } else if (sql.startsWith('UPDATE productos SET descripcion')) {
    response = await supabase.from('productos').update({ descripcion: params[0], marca: params[1], ubicacion: params[2], stock_teorico: params[3] }).eq('id', params[4]).select('id');
  } else if (sql.startsWith('UPDATE productos SET codigo')) {
    response = await supabase.from('productos').update({ codigo: params[0], descripcion: params[1], marca: params[2], ubicacion: params[3], stock_teorico: params[4] }).eq('id', params[5]).select('id');
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
  await sqliteRun('CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE NOT NULL, descripcion TEXT NOT NULL, marca TEXT, ubicacion TEXT, stock_teorico REAL DEFAULT 0, activo INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await sqliteRun("CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, descripcion TEXT, cantidad REAL NOT NULL, usuario TEXT, fecha TEXT, hora TEXT, tipo TEXT DEFAULT 'conteo', created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  const demoProducts = [
    ['FMPD00812', 'Pastilla de freno delantera', 'Frasle', 'A-01-2', 15], ['FLTF00120', 'Filtro de aceite motor 1.6', 'Fram', 'B-03-1', 40], ['BGB009400', 'Bujía de encendido Iridium', 'NGK', 'A-05-4', 100], ['AMR002100', 'Amortiguador delantero izq.', 'Monroe', 'C-02-1', 8], ['COR005432', 'Correa de distribución 124T', 'Dayco', 'B-01-3', 20]
  ];
  for (const product of demoProducts) {
    if (!await sqliteGet('SELECT id FROM productos WHERE LOWER(codigo) = LOWER(?)', [product[0]])) {
      await sqliteRun('INSERT INTO productos (codigo, descripcion, marca, ubicacion, stock_teorico) VALUES (?, ?, ?, ?, ?)', product);
    }
  }
  console.log(`SQLite listo en: ${dbPath}`);
}

module.exports = { initializeDb, all, get, run, storageType: usingSupabase ? 'supabase' : 'sqlite' };
