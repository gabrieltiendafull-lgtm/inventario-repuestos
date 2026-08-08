const express = require('express');
const path = require('path');
const cors = require('cors');
const { initializeDb, all, get, run } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'inventario-repuestos_index.html'));
});

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return {};
    }
  }

  return {};
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'sqlite' });
});

app.get('/api/products', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM productos WHERE activo = 1 ORDER BY descripcion ASC');
    res.json(rows.map((row) => ({
      id: row.id,
      codigo: row.codigo,
      descripcion: row.descripcion,
      marca: row.marca,
      ubicacion: row.ubicacion,
      stockTeorico: Number(row.stock_teorico || 0)
    })));
  } catch (error) {
    console.error('Error al leer productos:', error);
    res.status(500).json({ error: 'No se pudo leer productos' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const body = parseBody(req);
    const payload = body.payload || body;
    const codigo = String(payload.codigo || '').trim();
    const descripcion = String(payload.descripcion || '').trim();
    const marca = String(payload.marca || '').trim();
    const ubicacion = String(payload.ubicacion || '').trim();
    const stockTeorico = Number(payload.stockTeorico ?? payload.stock_teorico ?? 0);

    if (!codigo || !descripcion || !marca || !ubicacion) {
      return res.status(400).json({ error: 'Faltan datos del producto' });
    }

    const existing = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);

    if (existing) {
      await run(
        'UPDATE productos SET descripcion = ?, marca = ?, ubicacion = ?, stock_teorico = ? WHERE id = ?',
        [descripcion, marca, ubicacion, stockTeorico, existing.id]
      );

      return res.json({
        status: 'updated',
        product: {
          codigo,
          descripcion,
          marca,
          ubicacion,
          stockTeorico
        }
      });
    }

    const result = await run(
      'INSERT INTO productos (codigo, descripcion, marca, ubicacion, stock_teorico) VALUES (?, ?, ?, ?, ?)',
      [codigo, descripcion, marca, ubicacion, stockTeorico]
    );

    res.json({
      status: 'success',
      id: result.id,
      product: {
        codigo,
        descripcion,
        marca,
        ubicacion,
        stockTeorico
      }
    });
  } catch (error) {
    console.error('Error al guardar producto:', error);
    res.status(500).json({ error: 'No se pudo guardar el producto' });
  }
});

app.put('/api/products/:codigo', async (req, res) => {
  try {
    const codigoOriginal = String(req.params.codigo || '').trim();
    const body = parseBody(req);
    const payload = body.payload || body;
    const codigo = String(payload.codigo || codigoOriginal).trim();
    const descripcion = String(payload.descripcion || '').trim();
    const marca = String(payload.marca || '').trim();
    const ubicacion = String(payload.ubicacion || '').trim();
    const stockTeorico = Number(payload.stockTeorico ?? payload.stock_teorico ?? 0);

    if (!codigo || !descripcion || !marca || !ubicacion) {
      return res.status(400).json({ error: 'Faltan datos del producto' });
    }

    const existing = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigoOriginal]);
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const duplicate = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?) AND id != ?', [codigo, existing.id]);
    if (duplicate) {
      return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    }

    await run(
      'UPDATE productos SET codigo = ?, descripcion = ?, marca = ?, ubicacion = ?, stock_teorico = ? WHERE id = ?',
      [codigo, descripcion, marca, ubicacion, stockTeorico, existing.id]
    );

    await run(
      'UPDATE movimientos SET codigo = ?, descripcion = ? WHERE LOWER(codigo) = LOWER(?)',
      [codigo, descripcion, codigoOriginal]
    );

    return res.json({ status: 'updated', codigo, descripcion, marca, ubicacion, stockTeorico });
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'No se pudo actualizar el producto' });
  }
});

app.delete('/api/products/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    const existing = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await run('DELETE FROM movimientos WHERE LOWER(codigo) = LOWER(?)', [codigo]);
    await run('DELETE FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);

    return res.json({ status: 'deleted', codigo });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ error: 'No se pudo eliminar el producto' });
  }
});

app.get('/api/counts', async (req, res) => {
  try {
    const rows = await all('SELECT codigo, descripcion, cantidad, usuario, fecha, hora FROM movimientos ORDER BY id DESC');
    res.json(rows.map((row) => ({
      codigo: row.codigo,
      descripcion: row.descripcion,
      cantidad: Number(row.cantidad || 0),
      usuario: row.usuario,
      fecha: row.fecha,
      hora: row.hora
    })));
  } catch (error) {
    console.error('Error al leer conteos:', error);
    res.status(500).json({ error: 'No se pudo leer los conteos' });
  }
});

app.post('/api/counts', async (req, res) => {
  try {
    const body = parseBody(req);
    const payload = body.payload || body;
    const codigo = String(payload.codigo || '').trim();
    const descripcion = String(payload.descripcion || '').trim();
    const cantidad = Number(payload.cantidad ?? 0);
    const usuario = String(payload.usuario || 'Operador 1').trim();
    const fecha = String(payload.fecha || new Date().toISOString().slice(0, 10));
    const hora = String(payload.hora || new Date().toLocaleTimeString('es-AR'));

    if (!codigo || !Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }

    await run(
      'INSERT INTO movimientos (codigo, descripcion, cantidad, usuario, fecha, hora, tipo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [codigo, descripcion, cantidad, usuario, fecha, hora, 'conteo']
    );

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error al guardar conteo:', error);
    res.status(500).json({ error: 'No se pudo guardar el conteo' });
  }
});

initializeDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor inventario escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error inicializando base de datos:', err);
    process.exit(1);
  });
