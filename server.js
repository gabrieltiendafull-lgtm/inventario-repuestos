const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const { initializeDb, all, get, run, storageType, isPersistent, countUsers, findUserByName, createUser, listUsers, deactivateUser } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const authSecret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET) console.warn('ADVERTENCIA: AUTH_SECRET no está configurada; las sesiones se cerrarán si el servidor se reinicia.');

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, nombre: user.nombre, rol: user.rol, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.exp > Date.now() ? user : null;
  } catch (_) { return null; }
}

function requireAuth(req, res, next) {
  const user = readToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!user) return res.status(401).json({ error: 'Sesión requerida' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.rol === 'admin') return next();
  return res.status(403).json({ error: 'Solo el administrador puede realizar esta acción' });
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: storageType,
    persistent: isPersistent,
    warning: isPersistent ? null : 'La base SQLite es temporal en Render. Configurá Supabase para evitar pérdidas de datos.'
  });
});

app.get('/api/auth/status', async (req, res) => {
  try { res.json({ needsSetup: (await countUsers()) === 0 }); }
  catch (error) { res.status(500).json({ error: 'No se pudo verificar la configuración de usuarios' }); }
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    if (await countUsers()) return res.status(409).json({ error: 'El administrador ya fue configurado' });
    const password = String((parseBody(req).password) || '');
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const user = await createUser({ nombre: 'Gabriel', passwordHash: hashPassword(password), rol: 'admin' });
    res.json({ user: { id: user.id, nombre: user.nombre, rol: user.rol }, token: createToken(user) });
  } catch (error) { console.error('Error configurando administrador:', error); res.status(500).json({ error: 'No se pudo configurar el administrador. Ejecutá la migración de usuarios en Supabase.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const body = parseBody(req);
    const user = await findUserByName(String(body.nombre || '').trim());
    if (!user || !user.activo || !passwordMatches(String(body.password || ''), user.password_hash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    res.json({ user: { id: user.id, nombre: user.nombre, rol: user.rol }, token: createToken(user) });
  } catch (error) { res.status(500).json({ error: 'No se pudo iniciar sesión' }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.get('/api/auth/users', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await listUsers()); } catch (error) { res.status(500).json({ error: 'No se pudieron leer los operadores' }); }
});
app.post('/api/auth/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = parseBody(req); const nombre = String(body.nombre || '').trim(); const password = String(body.password || ''); const rol = body.rol === 'admin' ? 'admin' : 'operador';
    if (!nombre || password.length < 8) return res.status(400).json({ error: 'Indicá un nombre y una contraseña de al menos 8 caracteres' });
    if (await findUserByName(nombre)) return res.status(409).json({ error: 'Ya existe un operador con ese nombre' });
    res.json({ user: await createUser({ nombre, passwordHash: hashPassword(password), rol }) });
  } catch (error) { res.status(500).json({ error: 'No se pudo crear el operador' }); }
});
app.delete('/api/auth/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (Number(req.params.id) === Number(req.user.id)) return res.status(400).json({ error: 'No podés desactivar tu propio usuario' });
    await deactivateUser(Number(req.params.id)); res.json({ status: 'deactivated' });
  } catch (error) { res.status(500).json({ error: 'No se pudo desactivar el operador' }); }
});

app.use('/api/products', requireAuth);
app.use('/api/counts', requireAuth);

app.get('/api/products', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM productos WHERE activo = 1 ORDER BY descripcion ASC');
    res.json(rows.map((row) => ({
      id: row.id,
      codigo: row.codigo,
      descripcion: row.descripcion,
      marca: row.marca,
      talle: row.talle || '',
      color: row.color || '',
      ubicacion: row.ubicacion,
      stockTeorico: Number(row.stock_teorico || 0)
    })));
  } catch (error) {
    console.error('Error al leer productos:', error);
    res.status(500).json({ error: 'No se pudo leer productos' });
  }
});

// Todos los usuarios autenticados pueden dar de alta repuestos.  Las
// modificaciones posteriores se mantienen en la ruta PUT, protegida para el
// administrador.
app.post('/api/products', async (req, res) => {
  try {
    const body = parseBody(req);
    const payload = body.payload || body;
    const codigo = String(payload.codigo || '').trim();
    const descripcion = String(payload.descripcion || '').trim();
    const marca = String(payload.marca || '').trim();
    const talle = String(payload.talle || '').trim();
    const color = String(payload.color || '').trim();
    const ubicacion = String(payload.ubicacion || '').trim();
    const stockTeorico = Number(payload.stockTeorico ?? payload.stock_teorico ?? 0);

    if (!codigo || !descripcion || !marca || !ubicacion) {
      return res.status(400).json({ error: 'Faltan datos del producto' });
    }

    const existing = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);

    if (existing) return res.status(409).json({ error: 'Ya existe un producto con ese código. Solo el administrador puede editarlo.' });

    const result = await run(
      'INSERT INTO productos (codigo, descripcion, marca, talle, color, ubicacion, stock_teorico) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [codigo, descripcion, marca, talle, color, ubicacion, stockTeorico]
    );

    res.json({
      status: 'success',
      id: result.id,
      product: {
        codigo,
        descripcion,
        marca,
        talle,
        color,
        ubicacion,
        stockTeorico
      }
    });
  } catch (error) {
    console.error('Error al guardar producto:', error);
    res.status(500).json({ error: 'No se pudo guardar el producto' });
  }
});

app.put('/api/products/:codigo', requireAdmin, async (req, res) => {
  try {
    const codigoOriginal = String(req.params.codigo || '').trim();
    const body = parseBody(req);
    const payload = body.payload || body;
    const codigo = String(payload.codigo || codigoOriginal).trim();
    const descripcion = String(payload.descripcion || '').trim();
    const marca = String(payload.marca || '').trim();
    const talle = String(payload.talle || '').trim();
    const color = String(payload.color || '').trim();
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
      'UPDATE productos SET codigo = ?, descripcion = ?, marca = ?, talle = ?, color = ?, ubicacion = ?, stock_teorico = ? WHERE id = ?',
      [codigo, descripcion, marca, talle, color, ubicacion, stockTeorico, existing.id]
    );

    return res.json({ status: 'updated', codigo, descripcion, marca, talle, color, ubicacion, stockTeorico });
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'No se pudo actualizar el producto' });
  }
});

app.delete('/api/products/:codigo', requireAdmin, async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    const existing = await get('SELECT * FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);
    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await run('DELETE FROM productos WHERE LOWER(codigo) = LOWER(?)', [codigo]);

    return res.json({ status: 'deleted', codigo });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ error: 'No se pudo eliminar el producto' });
  }
});

// El historial alimenta los reportes. Los operarios solo registran nuevos
// ingresos mediante POST; no pueden consultar ni modificar los ya existentes.
app.get('/api/counts', requireAdmin, async (req, res) => {
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
