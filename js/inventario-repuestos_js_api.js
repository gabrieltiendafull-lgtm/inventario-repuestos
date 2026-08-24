// Permite forzar el servidor desde `index.html` con `window.API_BASE = 'http://192.168.x.x:3000'`
const API_BASE = window.API_BASE || (() => {
  // Si se abrió el HTML desde file:// asumimos servidor en localhost:3000
  if (window.location.protocol === 'file:') return 'http://localhost:3000';
  // Si estamos en un servidor normal, usamos el origin (incluye protocolo + host + puerto si aplica)
  return window.location.origin || 'http://localhost:3000';
})();

const API_URL = API_BASE.endsWith('/api') ? API_BASE : `${API_BASE}/api`;

async function tryFetch(urls, options, acceptedStatusCodes = []) {
  let lastError = null;
  // Render puede tardar algunos segundos en despertar. Reintentamos antes de
  // marcar la base como caída, para no dejar cambios sólo en el navegador.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const u of urls) {
      try {
        const res = await fetch(u, { ...options, headers: { ...(options && options.headers ? options.headers : {}), ...(API.authHeaders ? API.authHeaders() : {}) } });
        if (res && (res.ok || acceptedStatusCodes.includes(res.status))) {
          API.isOnline = true;
          return res;
        }
        lastError = new Error(`El servidor respondió ${res.status} en ${u}`);
      } catch (err) {
        lastError = err;
      }
    }

    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  API.isOnline = false;
  throw lastError || new Error('No se pudo conectar a ninguna URL');
}

const API = {
  // Se actualiza en cada consulta; evita indicar conexión al usar solo caché local.
  isOnline: false,
  lastError: null,
  // Datos demo por si la API aún no está conectada
  demoProducts: [
    { codigo: "FMPD00812", descripcion: "Pastilla de freno delantera", marca: "Frasle", stockTeorico: 15, ubicacion: "A-01-2" },
    { codigo: "FLTF00120", descripcion: "Filtro de aceite motor 1.6", marca: "Fram", stockTeorico: 40, ubicacion: "B-03-1" },
    { codigo: "BGB009400", descripcion: "Bujía de encendido Iridium", marca: "NGK", stockTeorico: 100, ubicacion: "A-05-4" },
    { codigo: "AMR002100", descripcion: "Amortiguador delantero izq.", marca: "Monroe", stockTeorico: 8, ubicacion: "C-02-1" },
    { codigo: "COR005432", descripcion: "Correa de distribución 124T", marca: "Dayco", stockTeorico: 20, ubicacion: "B-01-3" }
  ],

  readLocal(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      console.warn(`No se pudo leer ${key} del almacenamiento local:`, err);
      return fallback;
    }
  },

  writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`No se pudo guardar ${key} en almacenamiento local:`, err);
      return false;
    }
  },

  async fetchHealth() {
    try {
      const response = await tryFetch([`${API_URL}/health`, 'http://localhost:3000/api/health']);
      return await response.json();
    } catch (err) {
      this.lastError = err.message;
      return null;
    }
  },

  async fetchProducts() {
    const cached = this.readLocal('db_products', null);

    try {
      const urls = [`${API_URL}/products`, `http://localhost:3000/api/products`];
      const response = await tryFetch(urls);
      const data = await response.json();
      if (Array.isArray(data)) {
        // Nunca descartamos altas o cambios que todavía no llegaron al servidor.
        const pendingDeletes = new Set(this.readLocal('db_pending_deletes', []).map((code) => String(code).toLowerCase()));
        const merged = new Map(data
          .filter((product) => !pendingDeletes.has(String(product.codigo || '').toLowerCase()))
          .map((product) => [String(product.codigo || '').toLowerCase(), product]));
        (cached || []).filter((product) => product && product._pending).forEach((product) => {
          merged.set(String(product.codigo || '').toLowerCase(), product);
        });
        const products = Array.from(merged.values());
        this.writeLocal('db_products', products);
        return products;
      }

      if (cached) return cached;
      this.writeLocal('db_products', this.demoProducts);
      return this.demoProducts;
    } catch (err) {
      console.warn('No se pudo conectar con el backend local, usando caché local:', err);
      return cached || this.demoProducts;
    }
  },

  async fetchCounts() {
    const cached = this.readLocal('db_counts', []);

    try {
      const urls = [`${API_URL}/counts`, `http://localhost:3000/api/counts`];
      const response = await tryFetch(urls);
      const data = await response.json();
      if (Array.isArray(data)) {
        const pending = cached.filter((count) => count && count._pending);
        const remoteKeys = new Set(data.map((count) => `${count.codigo}|${count.fecha}|${count.hora}|${count.usuario}|${count.cantidad}`));
        const counts = [...data, ...pending.filter((count) => !remoteKeys.has(`${count.codigo}|${count.fecha}|${count.hora}|${count.usuario}|${count.cantidad}`))];
        this.writeLocal('db_counts', counts);
        return counts;
      }

      return cached;
    } catch (err) {
      console.warn('No se pudo traer el historial del backend, usando caché local:', err);
      return cached;
    }
  },

  async saveProduct(productData) {
    const products = this.readLocal('db_products', []);
    const normalizedCodigo = String(productData.codigo || '').trim().toLowerCase();

    // assign a local id for tracking
    const localId = `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const localCopy = { ...productData, _localId: localId, _pending: true };

    const existingIndex = products.findIndex(item => String(item.codigo || '').toLowerCase() === normalizedCodigo);

    if (existingIndex >= 0) {
      products[existingIndex] = { ...products[existingIndex], ...localCopy };
    } else {
      products.push(localCopy);
    }

    this.writeLocal('db_products', products);

    try {
      const urls = [`${API_URL}/products`];
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: productData })
      };
      const res = await tryFetch(urls, options);
      const body = await res.json();

      // mark as synced locally
      const updated = this.readLocal('db_products', []).map(item => {
        if (item._localId === localId) {
          const copy = { ...item };
          delete copy._pending;
          delete copy._localId;
          return { ...copy };
        }
        return item;
      });
      this.writeLocal('db_products', updated);

      return body;
    } catch (err) {
      console.error('Modo offline: Producto guardado localmente.', err);
      this.lastError = err.message;
      return { status: 'pending', error: err.message };
    }
  },

  async updateProduct(codigoOriginal, productData) {
    const products = this.readLocal('db_products', []);
    const index = products.findIndex(item => item.codigo.toLowerCase() === codigoOriginal.toLowerCase());
    if (index >= 0) {
      products[index] = { ...products[index], ...productData };
      this.writeLocal('db_products', products);
    }
    try {
      const urls = [`${API_URL}/products/${encodeURIComponent(codigoOriginal)}`];
      const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: productData })
      };
      const res = await tryFetch(urls, options);

      // on success, clear any pending flag for this product
      const productsList = this.readLocal('db_products', []).map(item => {
        if (String(item.codigo || '').toLowerCase() === String(codigoOriginal).toLowerCase()) {
          const copy = { ...item, ...productData };
          delete copy._pending;
          delete copy._localId;
          return copy;
        }
        return item;
      });
      this.writeLocal('db_products', productsList);

      return await res.json();
    } catch (err) {
      // mark local product as pending
      const productsList = this.readLocal('db_products', []);
      const updated = productsList.map(item => {
        if (String(item.codigo || '').toLowerCase() === String(codigoOriginal).toLowerCase()) {
          return { ...item, ...productData, _pending: true, _localId: item._localId || `p_${Date.now()}_${Math.random().toString(36).slice(2)}` };
        }
        return item;
      });
      this.writeLocal('db_products', updated);

      console.error('Modo offline: Producto actualizado localmente.', err);
      this.lastError = err.message;
      return { status: 'pending', error: err.message };
    }
  },

  async deleteProduct(codigo) {
    const products = this.readLocal('db_products', []);
    const filtered = products.filter(item => item.codigo.toLowerCase() !== String(codigo).toLowerCase());
    this.writeLocal('db_products', filtered);
    try {
      const urls = [`${API_URL}/products/${encodeURIComponent(codigo)}`];
      const options = { method: 'DELETE' };
      const res = await tryFetch(urls, options);
      return await res.json();
    } catch (err) {
      // store pending delete list
      const pendingDeletes = this.readLocal('db_pending_deletes', []);
      if (!pendingDeletes.includes(codigo)) pendingDeletes.push(codigo);
      this.writeLocal('db_pending_deletes', pendingDeletes);

      console.error('Modo offline: Producto eliminado localmente.', err);
      this.lastError = err.message;
      return { status: 'pending', error: err.message };
    }
  },

  async saveCount(countData) {
    let localCounts = this.readLocal('db_counts', []);

    const localId = `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const localCopy = { ...countData, _localId: localId, _pending: true };
    localCounts.push(localCopy);
    this.writeLocal('db_counts', localCounts);

    try {
      const urls = [`${API_URL}/counts`];
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: countData })
      };
      const res = await tryFetch(urls, options);

      // mark as synced locally
      const updated = this.readLocal('db_counts', []).map(item => {
        if (item._localId === localId) {
          const copy = { ...item };
          delete copy._pending;
          delete copy._localId;
          return copy;
        }
        return item;
      });
      this.writeLocal('db_counts', updated);

      return await res.json();
    } catch (err) {
      console.error('Modo offline: Guardado localmente, se sincronizará luego.', err);
      this.lastError = err.message;
      return { status: 'pending', error: err.message };
    }
  }
};

// --- Sincronización de pendientes ---
API.syncPendingCounts = async function () {
  const localCounts = this.readLocal('db_counts', []);
  let changed = false;

  for (const item of localCounts.slice()) {
    if (!item || !item._pending) continue;
    try {
      const res = await tryFetch([`${API_URL}/counts`], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { codigo: item.codigo, descripcion: item.descripcion, cantidad: item.cantidad, usuario: item.usuario, fecha: item.fecha, hora: item.hora } })
      });
      if (res && res.ok) {
        // remove pending flags
        const updated = this.readLocal('db_counts', []).map(i => {
          if (i._localId === item._localId) {
            const copy = { ...i };
            delete copy._pending;
            delete copy._localId;
            return copy;
          }
          return i;
        });
        this.writeLocal('db_counts', updated);
        changed = true;
      }
    } catch (err) {
      // leave it pending
    }
  }

  return changed;
};

API.syncPendingProducts = async function () {
  let changed = false;
  const products = this.readLocal('db_products', []);

  for (const p of products.slice()) {
    if (!p || !p._pending) continue;
    try {
      const payload = { codigo: p.codigo, descripcion: p.descripcion, marca: p.marca, talle: p.talle, color: p.color, ubicacion: p.ubicacion, stockTeorico: p.stockTeorico };
      const res = await tryFetch([`${API_URL}/products`], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload })
      });
      if (res && res.ok) {
        const updated = this.readLocal('db_products', []).map(i => {
          if (i._localId === p._localId) {
            const copy = { ...i };
            delete copy._pending;
            delete copy._localId;
            return copy;
          }
          return i;
        });
        this.writeLocal('db_products', updated);
        changed = true;
      }
    } catch (err) {
      // ignore
    }
  }

  // process pending deletes
  const pendingDeletes = this.readLocal('db_pending_deletes', []);
  if (Array.isArray(pendingDeletes) && pendingDeletes.length) {
    const remaining = [];
    for (const codigo of pendingDeletes) {
      try {
        // Un 404 significa que el producto ya no existe en el servidor: la
        // eliminación ya está resuelta y no debe quedar pendiente para siempre.
        const res = await tryFetch([`${API_URL}/products/${encodeURIComponent(codigo)}`], { method: 'DELETE' }, [404]);
        if (res && (res.ok || res.status === 404)) changed = true;
        else remaining.push(codigo);
      } catch (err) {
        remaining.push(codigo);
      }
    }
    this.writeLocal('db_pending_deletes', remaining);
  }

  return changed;
};

API.syncAll = async function () {
  try {
    const p1 = await this.syncPendingProducts();
    const p2 = await this.syncPendingCounts();
    return p1 || p2;
  } catch (err) {
    return false;
  }
};

API.pendingSummary = function () {
  const pendingProducts = this.readLocal('db_products', []).filter((product) => product && product._pending).length;
  const pendingCounts = this.readLocal('db_counts', []).filter((count) => count && count._pending).length;
  const pendingDeletes = this.readLocal('db_pending_deletes', []).length;
  return { pendingProducts, pendingCounts, pendingDeletes, total: pendingProducts + pendingCounts + pendingDeletes };
};
