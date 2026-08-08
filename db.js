const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'inventario.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('No se pudo abrir la base SQLite:', err.message);
  } else {
    console.log(`SQLite listo en: ${dbPath}`);
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function initializeDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      descripcion TEXT NOT NULL,
      marca TEXT,
      ubicacion TEXT,
      stock_teorico REAL DEFAULT 0,
      activo INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      descripcion TEXT,
      cantidad REAL NOT NULL,
      usuario TEXT,
      fecha TEXT,
      hora TEXT,
      tipo TEXT DEFAULT 'conteo',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const demoProducts = [
    { codigo: 'FMPD00812', descripcion: 'Pastilla de freno delantera', marca: 'Frasle', ubicacion: 'A-01-2', stock_teorico: 15 },
    { codigo: 'FLTF00120', descripcion: 'Filtro de aceite motor 1.6', marca: 'Fram', ubicacion: 'B-03-1', stock_teorico: 40 },
    { codigo: 'BGB009400', descripcion: 'Bujía de encendido Iridium', marca: 'NGK', ubicacion: 'A-05-4', stock_teorico: 100 },
    { codigo: 'AMR002100', descripcion: 'Amortiguador delantero izq.', marca: 'Monroe', ubicacion: 'C-02-1', stock_teorico: 8 },
    { codigo: 'COR005432', descripcion: 'Correa de distribución 124T', marca: 'Dayco', ubicacion: 'B-01-3', stock_teorico: 20 }
  ];

  for (const product of demoProducts) {
    const exists = await get('SELECT id FROM productos WHERE LOWER(codigo) = LOWER(?)', [product.codigo]);
    if (!exists) {
      await run(
        'INSERT INTO productos (codigo, descripcion, marca, ubicacion, stock_teorico) VALUES (?, ?, ?, ?, ?)',
        [product.codigo, product.descripcion, product.marca, product.ubicacion, product.stock_teorico]
      );
    }
  }

  return db;
}

module.exports = { db, initializeDb, run, get, all };
