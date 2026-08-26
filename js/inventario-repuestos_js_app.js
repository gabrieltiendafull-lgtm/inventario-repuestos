let productsDB = [];
let currentProduct = null;
let importedStockMap = {};
let editingProductCode = null;
let globalSearchQuery = '';
let databaseHealth = null;
let depositsDB = [{ nombre: 'Ático' }];

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.requireSession();
  applyUserPermissions();
  const savedImport = JSON.parse(localStorage.getItem('db_imported_stock') || '{}');
  importedStockMap = savedImport || {};

  await loadDeposits();
  await loadDatabase();
  setupEvents();
  renderReportTable();
  renderHistoryTable();
  attemptSync();
});

function applyUserPermissions() {
  const isAdmin = Auth.user && Auth.user.rol === 'admin';
  document.body.classList.toggle('is-admin', isAdmin);
  document.getElementById('current-operator').textContent = `Operador activo: ${Auth.user.nombre}`;
  document.getElementById('btn-registrar').textContent = Auth.user.rol === 'salida' ? 'Registrar salida (ENTER)' : 'Registrar ingreso (ENTER)';
  document.getElementById('stock-info-label').textContent = Auth.user.rol === 'salida' ? 'Stock disponible:' : 'Stock en depósito:';
}

async function loadDeposits() {
  try {
    const data = await API.fetchDeposits();
    if (Array.isArray(data) && data.length) depositsDB = data;
  } catch (_) { /* permite abrir datos antiguos hasta ejecutar la migración */ }
  const selected = document.getElementById('input-deposito');
  const report = document.getElementById('report-deposito');
  const options = depositsDB.map((deposit) => `<option value="${deposit.nombre}">${deposit.nombre}</option>`).join('');
  selected.innerHTML = options;
  report.innerHTML = `<option value="todos">Todos los depósitos</option>${options}`;
}

function getSelectedDeposit() { return document.getElementById('input-deposito').value; }

// Intento de sincronización: empuja pendientes y refresca vistas si hubo cambios
async function attemptSync() {
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;

  if (!navigator.onLine) {
    statusEl.textContent = 'Desconectado - trabajando offline';
    statusEl.className = 'status-offline';
    return;
  }

  try {
    statusEl.textContent = 'Sincronizando...';
    statusEl.className = 'status-syncing';
    const changed = await API.syncAll();
    if (changed) {
      await loadDatabase();
      renderReportTable();
      renderHistoryTable();
    }
    const pending = API.pendingSummary();
    if (pending.total) {
      statusEl.textContent = `Hay ${pending.total} cambio(s) pendiente(s) de sincronizar`;
      statusEl.className = 'status-offline';
    } else if (databaseHealth && databaseHealth.persistent === false) {
      statusEl.textContent = 'ATENCIÓN: base temporal; los cambios pueden perderse';
      statusEl.className = 'status-offline';
    } else if (API.isOnline) {
      statusEl.textContent = `Base compartida lista (${productsDB.length} productos)`;
      statusEl.className = 'status-online';
    } else {
      statusEl.textContent = 'Servidor no disponible - datos locales';
      statusEl.className = 'status-offline';
    }
  } catch (err) {
    statusEl.textContent = 'Error sincronizando';
    statusEl.className = 'status-offline';
  }
}

async function loadDatabase() {
  const statusEl = document.getElementById('sync-status');
  productsDB = await API.fetchProducts();
  await loadCounts();
  databaseHealth = await API.fetchHealth();
  
  const pending = API.pendingSummary();
  if (pending.total) {
    statusEl.textContent = `Hay ${pending.total} cambio(s) pendiente(s) de sincronizar`;
    statusEl.className = 'status-offline';
  } else if (databaseHealth && databaseHealth.persistent === false) {
    statusEl.textContent = 'ATENCIÓN: base temporal; los cambios pueden perderse';
    statusEl.className = 'status-offline';
  } else if (API.isOnline) {
    statusEl.textContent = `Base compartida lista (${productsDB.length} productos)`;
    statusEl.className = 'status-online';
  } else if (productsDB.length > 0) {
    statusEl.textContent = 'Servidor no disponible - datos locales';
    statusEl.className = 'status-offline';
  } else {
    statusEl.textContent = 'Modo sin datos';
    statusEl.className = 'status-offline';
  }
}

async function loadCounts() {
  // El historial y los reportes son exclusivos del administrador. El operador
  // conserva en este dispositivo sus propios registros recientes para poder
  // continuar trabajando sin pedir acceso al historial compartido.
  const sharedCounts = Auth.user && Auth.user.rol === 'admin' ? await API.fetchCounts() : [];
  const safeCounts = Array.isArray(sharedCounts) ? sharedCounts : [];
  const localCounts = JSON.parse(localStorage.getItem('db_counts') || '[]');

  const mergedCounts = [...(Array.isArray(localCounts) ? localCounts : []), ...safeCounts]
    .filter(Boolean)
    .reduce((acc, item) => {
      const key = `${item.codigo || ''}|${item.fecha || ''}|${item.hora || ''}|${item.usuario || ''}|${Number(item.cantidad) || 0}|${item.tipo || 'ingreso'}|${item.deposito || 'Ático'}`;
      if (!acc.has(key)) acc.set(key, item);
      return acc;
    }, new Map());

  const finalCounts = Array.from(mergedCounts.values());
  localStorage.setItem('db_counts', JSON.stringify(finalCounts));
  return finalCounts;
}

function refreshReportViews() {
  renderReportTable();
  renderHistoryTable();
}

function normalizeCodigo(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeColumnName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseImportedQuantity(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return NaN;

  // Acepta tanto 1.234,50 como 1,234.50 y 1234,50.
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');

  return Number(normalized);
}

function findImportValue(row, patterns) {
  const entries = Object.entries(row || {});
  for (const pattern of patterns) {
    const normalizedPattern = normalizeColumnName(pattern);
    const entry = entries.find(([key]) => {
      const normalizedKey = normalizeColumnName(key);
      return normalizedKey === normalizedPattern || normalizedKey.includes(normalizedPattern);
    });
    if (entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
      return entry[1];
    }
  }
  return null;
}

function buildImportedStockFromFile(rows) {
  const normalized = {};

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;

    const codigo = normalizeCodigo(findImportValue(row, ['codigo', 'cod', 'codigo_repuesto', 'codigo_producto']));
    const cantidad = findImportValue(row, ['cantidad', 'stock', 'stock_fisico', 'total', 'qty', 'cantidad_fisica', 'fisico', 'actual']);

    if (!codigo) return;

    const parsed = parseImportedQuantity(cantidad);
    if (Number.isFinite(parsed)) {
      normalized[codigo] = parsed;
    }
  });

  return normalized;
}

function buildProductsFromImport(rows) {
  const products = new Map();

  rows.forEach((row) => {
    const codigo = String(findImportValue(row, ['codigo', 'cod', 'codigo_repuesto', 'codigo_producto']) || '').trim();
    if (!codigo) return;

    const stockTeoricoValue = findImportValue(row, ['stock_teorico', 'teorico', 'stock_inicial']);
    const stockFisicoValue = findImportValue(row, ['stock_fisico', 'cantidad_fisica', 'fisico', 'cantidad', 'stock', 'total', 'qty']);
    const stockTeorico = parseImportedQuantity(stockTeoricoValue);
    const stockFisico = parseImportedQuantity(stockFisicoValue);
    const key = normalizeCodigo(codigo);

    products.set(key, {
      codigo,
      descripcion: String(findImportValue(row, ['descripcion', 'descripcion_producto', 'producto', 'nombre', 'detalle', 'articulo']) || `Producto importado (${codigo})`).trim(),
      marca: String(findImportValue(row, ['marca', 'brand']) || 'Sin marca').trim(),
      talle: String(findImportValue(row, ['talle', 'tamano', 'tamaño', 'size']) || '').trim(),
      color: String(findImportValue(row, ['color', 'colour']) || '').trim(),
      ubicacion: String(findImportValue(row, ['ubicacion', 'ubicacion_producto', 'deposito', 'sector', 'pasillo']) || 'Sin ubicación').trim(),
      // En archivos de conteo, StockTeorico suele venir en 0 y StockFisico
      // representa el stock real de alta. Tomamos ese valor para no crear
      // productos nuevos sin existencias.
      stockTeorico: Number.isFinite(stockTeorico) && stockTeorico !== 0
        ? stockTeorico
        : (Number.isFinite(stockFisico) ? stockFisico : 0)
    });
  });

  return Array.from(products.values());
}

async function importStockFile() {
  const input = document.getElementById('import-stock-file');
  if (!input || !input.files || !input.files[0]) {
    alert('Seleccioná un archivo CSV o Excel antes de importar.');
    return;
  }

  const file = input.files[0];
  const reader = new FileReader();

  reader.onload = async function (event) {
    try {
      const data = event.target.result;
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) {
        alert('El archivo no tiene filas para importar.');
        return;
      }

      importedStockMap = buildImportedStockFromFile(rows);
      localStorage.setItem('db_imported_stock', JSON.stringify(importedStockMap));

      const productCodes = new Set(productsDB.map((product) => normalizeCodigo(product.codigo)));
      const importedProducts = buildProductsFromImport(rows);
      const newProducts = importedProducts.filter((product) => !productCodes.has(normalizeCodigo(product.codigo)));
      const productsWithStockToUpdate = importedProducts.filter((product) => {
        const existing = productsDB.find((item) => normalizeCodigo(item.codigo) === normalizeCodigo(product.codigo));
        return existing && Number(existing.stockTeorico || 0) === 0 && Number(product.stockTeorico || 0) > 0;
      });
      const productsToSave = [...newProducts, ...productsWithStockToUpdate];

      for (const product of productsToSave) {
        await API.saveProduct(product);
      }

      if (productsToSave.length) {
        await loadDatabase();
      }
      renderReportTable();

      alert(`Se importaron ${importedProducts.length} código(s). Se agregaron ${newProducts.length} producto(s) nuevo(s) y se actualizaron ${productsWithStockToUpdate.length} producto(s) que tenían stock en cero.`);
    } catch (error) {
      console.error(error);
      alert('No se pudo leer el archivo. Asegurate de subir un CSV o Excel válido.');
    }
  };

  reader.readAsArrayBuffer(file);
}

function clearImportedStock() {
  importedStockMap = {};
  localStorage.removeItem('db_imported_stock');
  renderReportTable();
  document.getElementById('import-stock-file').value = '';
  alert('Se limpiaron los datos importados del stock físico.');
}

function getEffectivePhysicalMap(deposito = document.getElementById('report-deposito')?.value || 'todos') {
  const localCounts = JSON.parse(localStorage.getItem('db_counts') || '[]');
  const physicalMap = {};

  // Las importaciones antiguas no tenían depósito: se conservan en Ático.
  if (deposito === 'todos' || deposito === 'Ático') Object.entries(importedStockMap).forEach(([key, value]) => {
    const normalizedKey = normalizeCodigo(key);
    physicalMap[normalizedKey] = Number(value || 0);
  });

  localCounts.filter((item) => deposito === 'todos' || String(item.deposito || 'Ático').toLowerCase() === deposito.toLowerCase()).forEach((item) => {
    if (!item || !item.codigo) return;
    const key = normalizeCodigo(item.codigo);
    physicalMap[key] = (physicalMap[key] || 0) + (item.tipo === 'salida' ? -1 : 1) * Number(item.cantidad || 0);
  });

  return physicalMap;
}

function setupEvents() {
  const inputCodigo = document.getElementById('input-codigo');
  const btnAddNewProduct = document.getElementById('btn-add-new-product');
  const btnSaveNewProduct = document.getElementById('btn-save-new-product');
  const btnCancelNewProduct = document.getElementById('btn-cancel-new-product');
  const reportTable = document.getElementById('table-report');
  const newProductCodigoInput = document.getElementById('new-product-codigo');
  const globalSearchInput = document.getElementById('global-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  
  reportTable.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const codigo = actionButton.dataset.codigo;
    const action = actionButton.dataset.action;

    if (action === 'edit') {
      if (Auth.user.rol !== 'admin') return;
      const product = productsDB.find(item => item.codigo.toLowerCase() === codigo.toLowerCase());
      if (product) openNewProductForm(product.codigo, product);
      return;
    }

    if (action === 'delete') {
      if (Auth.user.rol !== 'admin') return;
      const product = productsDB.find(item => item.codigo.toLowerCase() === codigo.toLowerCase());
      if (!product) return;

      const confirmed = confirm(`¿Seguro que querés eliminar "${product.descripcion}" (${product.codigo})?`);
      if (!confirmed) return;

      const result = await API.deleteProduct(product.codigo);
      productsDB = productsDB.filter(item => item.codigo.toLowerCase() !== product.codigo.toLowerCase());
      localStorage.setItem('db_products', JSON.stringify(productsDB));

      // También quitamos el valor proveniente de una importación de CSV/Excel.
      // De otro modo, si se vuelve a crear el mismo código, ese stock físico
      // importado se sumaría aunque el producto y sus conteos se hayan borrado.
      delete importedStockMap[normalizeCodigo(product.codigo)];
      localStorage.setItem('db_imported_stock', JSON.stringify(importedStockMap));

      await loadCounts();
      refreshReportViews();
      if (result && result.status === 'pending') {
        alert('No se pudo confirmar la eliminación en el servidor. Quedó pendiente de sincronizar; no cierres ni borres los datos del navegador.');
      } else {
        alert('Producto eliminado correctamente.');
      }
    }
  });
  
  // Escaneo por pistola USB / Teclado (Lanza evento Enter)
  inputCodigo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchProduct(inputCodigo.value.trim());
    }
  });

  inputCodigo.addEventListener('blur', () => {
    if (inputCodigo.value.trim() !== '' && !currentProduct) {
      searchProduct(inputCodigo.value.trim());
    }
  });

  btnAddNewProduct.addEventListener('click', () => {
    openNewProductForm(inputCodigo.value.trim());
  });

  btnSaveNewProduct.addEventListener('click', submitNewProduct);
  btnCancelNewProduct.addEventListener('click', hideNewProductForm);

  // Alerta en tiempo real si el código ingresado para nuevo producto ya existe
  if (newProductCodigoInput) {
    newProductCodigoInput.addEventListener('blur', () => {
      const codigo = (newProductCodigoInput.value || '').trim();
      if (!codigo) return;
      const duplicate = productsDB.find(p => p.codigo.toLowerCase() === codigo.toLowerCase() && p.codigo.toLowerCase() !== (editingProductCode || '').toLowerCase());
      if (duplicate) {
        alert(`El código "${codigo}" ya existe para "${duplicate.descripcion}".`);
        newProductCodigoInput.focus();
      }
    });
  }

  // Búsqueda global: filtra la tabla de reporte en tiempo real
  if (globalSearchInput) {
    globalSearchInput.addEventListener('input', () => {
      globalSearchQuery = (globalSearchInput.value || '').trim().toLowerCase();
      // Navegar a la pestaña reporte si hay texto y no está visible
      if (globalSearchQuery && !document.getElementById('sec-reporte').classList.contains('active')) {
        switchTab('reporte');
      }
      renderReportTable();
    });

    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearGlobalSearch();
      }
    });
  }

  if (btnClearSearch) {
  btnClearSearch.addEventListener('click', clearGlobalSearch);
  document.getElementById('deposit-form').addEventListener('submit', createDeposit);
  }

  const operatorForm = document.getElementById('operator-form');
  if (operatorForm) operatorForm.addEventListener('submit', createOperator);
}

// Eventos de red y sincronización periódica
window.addEventListener('online', () => {
  attemptSync();
});

window.addEventListener('offline', () => {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.textContent = 'Desconectado - trabajando offline';
    statusEl.className = 'status-offline';
  }
});

// Intento periódico cada 30s
setInterval(() => {
  if (navigator.onLine) attemptSync();
}, 30000);

function manualSearchProduct() {
  const codigo = document.getElementById('input-codigo').value.trim();
  searchProduct(codigo);
}

function openNewProductForm(codigo = '', product = null) {
  const panel = document.getElementById('new-product-panel');
  const inputCodigo = document.getElementById('input-codigo');
  const title = document.getElementById('new-product-title');
  const saveButton = document.getElementById('btn-save-new-product');

  editingProductCode = product ? product.codigo : null;

  document.getElementById('not-found-box').classList.add('hidden');
  document.getElementById('new-product-codigo').value = product ? product.codigo : (codigo || inputCodigo.value.trim());
  document.getElementById('new-product-descripcion').value = product ? product.descripcion : '';
  document.getElementById('new-product-marca').value = product ? product.marca : '';
  document.getElementById('new-product-talle').value = product ? product.talle || '' : '';
  document.getElementById('new-product-color').value = product ? product.color || '' : '';
  document.getElementById('new-product-ubicacion').value = product ? product.ubicacion || '' : '';
  document.getElementById('new-product-stock').value = product ? product.stockTeorico : 0;
  document.getElementById('new-product-cantidad').value = 0;

  title.textContent = product ? 'Editar repuesto' : 'Agregar nuevo repuesto';
  saveButton.textContent = product ? 'Guardar cambios' : 'Guardar repuesto';

  panel.classList.remove('hidden');
  document.getElementById('new-product-descripcion').focus();
}

function hideNewProductForm() {
  const container = document.getElementById('new-product-form');
  editingProductCode = null;
  document.getElementById('new-product-panel').classList.add('hidden');
  document.getElementById('new-product-title').textContent = 'Agregar nuevo repuesto';
  document.getElementById('btn-save-new-product').textContent = 'Guardar repuesto';

  if (container) {
    container.querySelectorAll('input').forEach(input => {
      if (input.type !== 'button' && input.type !== 'submit') {
        input.value = input.defaultValue || '';
      }
    });
  }

  document.getElementById('input-codigo').focus();
}

async function submitNewProduct() {
  const codigo = document.getElementById('new-product-codigo').value.trim();
  const descripcion = document.getElementById('new-product-descripcion').value.trim();
  const marca = document.getElementById('new-product-marca').value.trim();
  const talle = document.getElementById('new-product-talle').value.trim();
  const color = document.getElementById('new-product-color').value.trim();
  const ubicacion = document.getElementById('new-product-ubicacion').value.trim();
  const stockTeorico = Number(document.getElementById('new-product-stock').value);
  const cantidad = Number(document.getElementById('new-product-cantidad').value);
  // El usuario se obtiene de la sesión activa; no existe un campo editable
  // `input-usuario` en este formulario.
  const usuario = (Auth.user && Auth.user.nombre) || 'Operador 1';

  if (!codigo || !descripcion || !marca || !ubicacion) {
    alert('Completá código, descripción, marca y ubicación para crear o editar el item.');
    return;
  }

  if (Number.isNaN(stockTeorico) || stockTeorico < 0) {
    alert('El stock inicial debe ser un número válido mayor o igual a 0.');
    return;
  }

  if (Number.isNaN(cantidad) || cantidad < 0) {
    alert('La cantidad encontrada debe ser un número válido mayor o igual a 0.');
    return;
  }

  const normalizedCodigo = codigo.toLowerCase();
  const duplicate = productsDB.find(item => item.codigo.toLowerCase() === normalizedCodigo && item.codigo.toLowerCase() !== (editingProductCode || '').toLowerCase());

  if (duplicate) {
    alert(`El código "${codigo}" ya existe para "${duplicate.descripcion}". Solo el administrador puede editar ese repuesto.`);
    document.getElementById('new-product-codigo').focus();
    return;
  }

  const newProduct = {
    codigo,
    descripcion,
    marca,
    talle,
    color,
    ubicacion,
    stockTeorico
  };

  if (editingProductCode) {
    const index = productsDB.findIndex(item => item.codigo.toLowerCase() === editingProductCode.toLowerCase());
    if (index >= 0) {
      productsDB[index] = { ...productsDB[index], ...newProduct };
    }

    localStorage.setItem('db_products', JSON.stringify(productsDB));
    const result = await API.updateProduct(editingProductCode, newProduct);
    if (result && result.status === 'pending') {
      alert('No se pudo guardar el cambio en el servidor. Quedó pendiente de sincronizar; la app no lo confirma como guardado todavía.');
      await attemptSync();
      return;
    }
    if (result && result.error) {
      alert(result.error);
      return;
    }

    if (cantidad > 0) {
      const now = new Date();
      await API.saveCount({
        codigo,
        descripcion,
        cantidad,
        usuario,
        fecha: now.toLocaleDateString(),
        hora: now.toLocaleTimeString(),
        deposito: getSelectedDeposit(), tipo: 'ingreso'
      });
      await loadCounts();
    }

    refreshReportViews();
    hideNewProductForm();
    alert(`Se actualizó el ítem "${descripcion}".`);
    resetForm();
    return;
  }

  productsDB.push(newProduct);
  localStorage.setItem('db_products', JSON.stringify(productsDB));
  const result = await API.saveProduct(newProduct);
  if (result && result.status === 'pending') {
    alert('No se pudo guardar el ítem en el servidor. Quedó pendiente de sincronizar; no se confirmó el alta.');
    await attemptSync();
    return;
  }

  if (cantidad > 0) {
    const now = new Date();
    await API.saveCount({
      codigo,
      descripcion,
      cantidad,
        usuario,
        fecha: now.toLocaleDateString(),
        hora: now.toLocaleTimeString(),
        deposito: getSelectedDeposit(), tipo: 'ingreso'
    });
    await loadCounts();
  }

  refreshReportViews();
  hideNewProductForm();
  alert(`Se agregó el ítem "${descripcion}" con stock inicial ${stockTeorico}.`);
  resetForm();
}

function getAccumulatedCount(codigo, deposito = getSelectedDeposit()) {
  const history = JSON.parse(localStorage.getItem('db_counts') || '[]');
  return history
    .filter(item => item.codigo.toLowerCase() === codigo.toLowerCase() && String(item.deposito || 'Ático').toLowerCase() === deposito.toLowerCase())
    .reduce((sum, item) => sum + (item.tipo === 'salida' ? -Number(item.cantidad) : Number(item.cantidad)), 0);
}

async function searchProduct(codigo) {
  if (!codigo) return;
  
  currentProduct = productsDB.find(p => p.codigo.toLowerCase() === codigo.toLowerCase());
  
  const infoBox = document.getElementById('product-info');
  const inputCantidad = document.getElementById('input-cantidad');
  const btnRegistrar = document.getElementById('btn-registrar');

  if (currentProduct) {
    let acumulado = getAccumulatedCount(currentProduct.codigo);
    if (Auth.user.rol === 'salida') {
      try { acumulado = Number((await API.fetchStock(currentProduct.codigo, getSelectedDeposit())).stock || 0); } catch (_) { /* el servidor validará la salida al confirmar */ }
    }

    document.getElementById('info-desc').textContent = currentProduct.descripcion;
    document.getElementById('info-marca').textContent = currentProduct.marca;
    document.getElementById('info-talle').textContent = currentProduct.talle || '-';
    document.getElementById('info-color').textContent = currentProduct.color || '-';
    document.getElementById('info-ubicacion').textContent = getSelectedDeposit();
    document.getElementById('info-teorico').textContent = currentProduct.stockTeorico;
    document.getElementById('info-acumulado').textContent = acumulado;
    
    infoBox.classList.remove('hidden');
    inputCantidad.disabled = false;
    btnRegistrar.disabled = false;
    inputCantidad.focus();
    inputCantidad.select();
    document.getElementById('not-found-box').classList.add('hidden');
    hideNewProductForm();
  } else {
    document.getElementById('not-found-code').textContent = codigo;
    document.getElementById('not-found-box').classList.remove('hidden');
    document.getElementById('input-cantidad').disabled = true;
    document.getElementById('btn-registrar').disabled = true;
    document.getElementById('product-info').classList.add('hidden');
    document.getElementById('new-product-panel').classList.add('hidden');
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  
  const cantidad = parseFloat(document.getElementById('input-cantidad').value);
  const usuario = Auth.user.nombre;
  const deposito = getSelectedDeposit();
  const tipo = Auth.user.rol === 'salida' ? 'salida' : 'ingreso';

  if (!currentProduct || isNaN(cantidad) || cantidad <= 0) {
    alert("Ingrese una cantidad válida mayor a 0.");
    return;
  }

  const now = new Date();
  if (tipo === 'salida') {
    const available = await API.fetchStock(currentProduct.codigo, deposito);
    if (Number(available.stock || 0) < cantidad) {
      alert(`Stock insuficiente en ${deposito}. Disponible: ${available.stock || 0}.`);
      return;
    }
  }

  const payload = {
    codigo: currentProduct.codigo,
    descripcion: currentProduct.descripcion,
    cantidad: cantidad,
    usuario,
    fecha: now.toLocaleDateString(),
    hora: now.toLocaleTimeString(), deposito, tipo
  };

  // Guardar conteo
  const result = await API.saveCount(payload);
  await loadCounts();
  refreshReportViews();

  if (result && result.status === 'pending') {
    alert('No se pudo guardar el conteo en el servidor. Quedó pendiente de sincronizar; no se confirmó el registro todavía.');
    await attemptSync();
    return;
  }

  // Limpiar y preparar para el siguiente escaneo
  resetForm();
}

function resetForm() {
  const container = document.getElementById('new-product-form');
  document.getElementById('input-codigo').value = '';
  document.getElementById('input-cantidad').value = '';
  document.getElementById('input-cantidad').disabled = true;
  document.getElementById('btn-registrar').disabled = true;
  document.getElementById('product-info').classList.add('hidden');
  document.getElementById('not-found-box').classList.add('hidden');

  if (container) {
    container.querySelectorAll('input').forEach(input => {
      if (input.type !== 'button' && input.type !== 'submit') {
        input.value = input.defaultValue || '';
      }
    });
  }

  document.getElementById('new-product-panel').classList.add('hidden');
  currentProduct = null;
  
  // Foco inmediato en el código para el ciclo ESCANEAR -> CANTIDAD -> ENTER -> SIGUIENTE
  document.getElementById('input-codigo').focus();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  if (tab === 'conteo') {
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.getElementById('sec-conteo').classList.add('active');
    document.getElementById('input-codigo').focus();
  } else if (tab === 'reporte') {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('sec-reporte').classList.add('active');
    renderReportTable();
  } else if (tab === 'historial') {
    document.querySelectorAll('.tab-btn')[2].classList.add('active');
    document.getElementById('sec-historial').classList.add('active');
    renderHistoryTable();
  } else if (tab === 'usuarios' && Auth.user.rol === 'admin') {
    document.querySelectorAll('.tab-btn')[3].classList.add('active');
    document.getElementById('sec-usuarios').classList.add('active');
    loadOperators();
    renderDeposits();
  }
}

async function createDeposit(event) {
  event.preventDefault();
  const error = document.getElementById('deposit-error'); error.textContent = '';
  try {
    await API.createDeposit(document.getElementById('deposit-name').value.trim());
    document.getElementById('deposit-form').reset();
    await loadDeposits(); renderDeposits();
  } catch (err) { error.textContent = err.message; }
}

function renderDeposits() {
  const tbody = document.querySelector('#table-deposits tbody');
  if (tbody) tbody.innerHTML = depositsDB.map((deposit) => `<tr><td>${deposit.nombre}</td><td>${deposit.activo === false ? 'Inactivo' : 'Activo'}</td></tr>`).join('');
}

async function createOperator(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById('operator-error'); error.textContent = '';
  try {
    await Auth.request('/auth/users', { method: 'POST', body: JSON.stringify({ nombre: document.getElementById('operator-name').value.trim(), password: document.getElementById('operator-password').value, rol: document.getElementById('operator-role').value }) });
    form.reset(); await loadOperators();
  } catch (err) { error.textContent = err.message; }
}

async function loadOperators() {
  const tbody = document.querySelector('#table-operators tbody');
  try {
    const users = await Auth.request('/auth/users');
    const roleName = { admin: 'Administrador', operador: 'Operador de ingreso', salida: 'Operador de salida' };
    tbody.innerHTML = users.map((user) => `<tr><td>${user.nombre}</td><td>${roleName[user.rol] || user.rol}</td><td>${user.activo ? 'Activo' : 'Inactivo'}</td><td>${user.activo && user.id !== Auth.user.id ? `<button type="button" class="btn-action btn-delete" onclick="deactivateOperator(${user.id}, '${String(user.nombre).replace(/'/g, '')}')">Desactivar</button>` : '-'}</td></tr>`).join('');
  } catch (err) { document.getElementById('operator-error').textContent = err.message; }
}

async function deactivateOperator(id, nombre) {
  if (!confirm(`¿Desactivar a ${nombre}?`)) return;
  try { await Auth.request(`/auth/users/${id}`, { method: 'DELETE' }); await loadOperators(); }
  catch (err) { document.getElementById('operator-error').textContent = err.message; }
}

function renderReportTable() {
  const tbody = document.querySelector('#table-report tbody');
  const filter = document.getElementById('filter-status').value;
  tbody.innerHTML = '';

  const physicalMap = getEffectivePhysicalMap();
  const query = (document.getElementById('global-search')?.value || '').trim().toLowerCase();

  let kpiTotal = productsDB.length;
  let kpiFaltantes = 0;
  let kpiSobrantes = 0;
  let kpiNoContados = 0;

  productsDB.forEach(prod => {
    // Si hay query, filtramos por código, descripción o marca
    if (query) {
      const matches = (prod.codigo || '').toLowerCase().includes(query)
        || (prod.descripcion || '').toLowerCase().includes(query)
        || (prod.marca || '').toLowerCase().includes(query)
        || (prod.talle || '').toLowerCase().includes(query)
        || (prod.color || '').toLowerCase().includes(query);
      if (!matches) return;
    }
    const productKey = normalizeCodigo(prod.codigo);
    const contado = Object.prototype.hasOwnProperty.call(physicalMap, productKey);
    const stockFisico = physicalMap[productKey] || 0;
    const diferencia = stockFisico - Number(prod.stockTeorico || 0);

    let estado = 'correcto';
    let badgeClass = 'badge-correcto';
    let labelEstado = 'Sin diferencia';

    if (!contado) {
      estado = 'no_contado';
      badgeClass = 'badge-nocontado';
      labelEstado = 'No contado';
      kpiNoContados++;
    } else if (diferencia < 0) {
      estado = 'faltante';
      badgeClass = 'badge-faltante';
      labelEstado = 'Faltante';
      kpiFaltantes++;
    } else if (diferencia > 0) {
      estado = 'sobrante';
      badgeClass = 'badge-sobrante';
      labelEstado = 'Sobrante';
      kpiSobrantes++;
    }

    if (filter !== 'todos' && filter !== estado) return;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${prod.codigo}</strong></td>
      <td>${prod.descripcion}</td>
      <td>${prod.marca}</td>
      <td>${prod.talle || '-'}</td>
      <td>${prod.color || '-'}</td>
      <td>${prod.ubicacion || '-'}</td>
      <td>${prod.stockTeorico}</td>
      <td><strong>${contado ? stockFisico : 0}</strong></td>
      <td style="color: ${diferencia < 0 ? '#dc2626' : (diferencia > 0 ? '#16a34a' : '#475569')}; font-weight: bold;">
        ${contado ? (diferencia > 0 ? '+' + diferencia : diferencia) : '-'}
      </td>
      <td><span class="${badgeClass}">${labelEstado}</span></td>
      <td class="action-cell">
        <button type="button" class="btn-action btn-edit" data-action="edit" data-codigo="${prod.codigo}">Editar</button>
        <button type="button" class="btn-action btn-delete" data-action="delete" data-codigo="${prod.codigo}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  // Actualizar KPIs
  document.getElementById('kpi-total').textContent = kpiTotal;
  document.getElementById('kpi-faltantes').textContent = kpiFaltantes;
  document.getElementById('kpi-sobrantes').textContent = kpiSobrantes;
  document.getElementById('kpi-nocontados').textContent = kpiNoContados;
}

function renderHistoryTable() {
  const tbody = document.querySelector('#table-history tbody');
  const countsHistory = JSON.parse(localStorage.getItem('db_counts') || '[]');
  tbody.innerHTML = '';

  [...countsHistory].reverse().forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.fecha} ${item.hora || ''}</td>
      <td><strong>${item.codigo}</strong></td>
      <td>${item.descripcion || '-'}</td>
      <td>${item.tipo === 'salida' ? 'Salida' : 'Ingreso'}</td>
      <td>${item.deposito || 'Ático'}</td>
      <td><strong style="color: ${item.tipo === 'salida' ? '#dc2626' : '#2563eb'};">${item.tipo === 'salida' ? '-' : '+'}${item.cantidad}</strong></td>
      <td>${item.usuario}</td>
    `;
    tbody.appendChild(row);
  });
}

function clearLocalHistory() {
  if (confirm("¿Estás seguro de reiniciar los conteos locales del navegador?")) {
    localStorage.removeItem('db_counts');
    renderHistoryTable();
    renderReportTable();
  }
}

function clearGlobalSearch() {
  const input = document.getElementById('global-search');
  if (input) {
    input.value = '';
    globalSearchQuery = '';
    renderReportTable();
  }
}

function exportToCSV() {
  const physicalMap = getEffectivePhysicalMap();

  let csv = "\uFEFF"; // BOM para asegurar caracteres UTF-8 en Excel
  csv += "Codigo;Descripcion;Marca;Talle;Color;Ubicacion;StockTeorico;StockFisico;Diferencia;Estado\n";

  productsDB.forEach(prod => {
    const key = normalizeCodigo(prod.codigo);
    const contado = Object.prototype.hasOwnProperty.call(physicalMap, key);
    const stockFisico = physicalMap[key] || 0;
    const diferencia = stockFisico - prod.stockTeorico;
    let estado = !contado ? 'No Contado' : (diferencia < 0 ? 'Faltante' : (diferencia > 0 ? 'Sobrante' : 'Correcto'));

    csv += `"${prod.codigo}";"${prod.descripcion}";"${prod.marca}";"${prod.talle || ''}";"${prod.color || ''}";"${prod.ubicacion || ''}";${prod.stockTeorico};${stockFisico};${diferencia};"${estado}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Inventario_Repuestos_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
