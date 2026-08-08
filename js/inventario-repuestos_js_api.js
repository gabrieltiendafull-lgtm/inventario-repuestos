const API_URL = (() => {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? 'http://localhost:3000/api' : `${window.location.origin}/api`;
})();

const API = {
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

  async fetchProducts() {
    const cached = this.readLocal('db_products', null);

    try {
      const response = await fetch(`${API_URL}/products`);
      if (!response.ok) throw new Error('Respuesta no válida');

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        this.writeLocal('db_products', data);
        return data;
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
      const response = await fetch(`${API_URL}/counts`);
      if (!response.ok) throw new Error('Respuesta no válida');

      const data = await response.json();
      if (Array.isArray(data)) {
        this.writeLocal('db_counts', data);
        return data;
      }

      return cached;
    } catch (err) {
      console.warn('No se pudo traer el historial del backend, usando caché local:', err);
      return cached;
    }
  },

  async saveProduct(productData) {
    const products = this.readLocal('db_products', []);
    const existingIndex = products.findIndex(item => item.codigo.toLowerCase() === productData.codigo.toLowerCase());

    if (existingIndex >= 0) {
      products[existingIndex] = { ...products[existingIndex], ...productData };
    } else {
      products.push(productData);
    }

    this.writeLocal('db_products', products);

    try {
      const response = await fetch(`${API_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: productData })
      });
      return await response.json();
    } catch (err) {
      console.error('Modo offline: Producto guardado localmente.', err);
      return { status: 'offline' };
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
      const response = await fetch(`${API_URL}/products/${encodeURIComponent(codigoOriginal)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: productData })
      });
      return await response.json();
    } catch (err) {
      console.error('Modo offline: Producto actualizado localmente.', err);
      return { status: 'offline' };
    }
  },

  async deleteProduct(codigo) {
    const products = this.readLocal('db_products', []);
    const filtered = products.filter(item => item.codigo.toLowerCase() !== String(codigo).toLowerCase());
    this.writeLocal('db_products', filtered);

    try {
      const response = await fetch(`${API_URL}/products/${encodeURIComponent(codigo)}`, {
        method: 'DELETE'
      });
      return await response.json();
    } catch (err) {
      console.error('Modo offline: Producto eliminado localmente.', err);
      return { status: 'offline' };
    }
  },

  async saveCount(countData) {
    let localCounts = this.readLocal('db_counts', []);
    localCounts.push(countData);
    this.writeLocal('db_counts', localCounts);

    try {
      const response = await fetch(`${API_URL}/counts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: countData })
      });
      return await response.json();
    } catch (err) {
      console.error('Modo offline: Guardado localmente, se sincronizará luego.', err);
      return { status: 'offline' };
    }
  }
};
