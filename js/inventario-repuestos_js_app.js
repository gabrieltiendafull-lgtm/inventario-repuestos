let productsDB = [];
let currentProduct = null;
let importedStockMap = {};
let editingProductCode = null;
let globalSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  const savedImport = JSON.parse(localStorage.getItem('db_imported_stock') || '{}');
  importedStockMap = savedImport || {};

  await loadDatabase();
  setupEvents();
  renderReportTable();
  renderHistoryTable();
  attemptSync();
});

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
    if (API.isOnline) {
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
  
  if (API.isOnline) {
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
  const sharedCounts = await API.fetchCounts();
  const safeCounts = Array.isArray(sharedCounts) ? sharedCounts : [];
  const localCounts = JSON.parse(localStorage.getItem('db_counts') || '[]');

  const mergedCounts = [...(Array.isArray(localCounts) ? localCounts : []), ...safeCounts]
    .filter(Boolean)
    .reduce((acc, item) => {
      const key = `${item.codigo || ''}|${item.fecha || ''}|${item.hora || ''}|${item.usuario || ''}|${Number(item.cantidad) || 0}`;
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

function buildImportedStockFromFile(rows) {
  const normalized = {};

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;

    const entries = Object.entries(row);
    const findValue = (patterns) => {
      for (const pattern of patterns) {
        const normalizedPattern = normalizeColumnName(pattern);
        const entry = entries.find(([key]) => {
          const normalizedKey = normalizeColumnName(key);
          return normalizedKey === normalizedPattern || normalizedKey.includes(normalizedPattern);
        });
        if (entry) {
          const value = entry[1];
          if (value !== undefined && value !== null && value !== '') return value;
        }
      }
      return null;
    };

    const codigo = normalizeCodigo(findValue(['codigo', 'cod', 'codigo_repuesto', 'codigo_producto']));
    const cantidad = findValue(['cantidad', 'stock', 'stock_fisico', 'total', 'qty', 'cantidad_fisica', 'fisico', 'actual']);

    if (!codigo) return;

    const parsed = parseImportedQuantity(cantidad);
    if (Number.isFinite(parsed)) {
      normalized[codigo] = parsed;
    }
  });

  return normalized;
}

function importStockFile() {
  const input = document.getElementById('import-stock-file');
  if (!input || !input.files || !input.files[0]) {
    alert('Seleccioná un archivo CSV o Excel antes de importar.');
    return;
  }

  const file = input.files[0];
  const reader = new FileReader();

  reader.onload = function (event) {
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
      renderReportTable();

      const importedCodes = Object.keys(importedStockMap);
      const productCodes = new Set(productsDB.map((product) => normalizeCodigo(product.codigo)));
      const unmatchedCodes = importedCodes.filter((codigo) => !productCodes.has(codigo));
      const matchedCount = importedCodes.length - unmatchedCodes.length;
      const unmatchedMessage = unmatchedCodes.length
        ? `\n\n${unmatchedCodes.length} código(s) no aparecen en el reporte porque no existen en el catálogo de productos: ${unmatchedCodes.slice(0, 5).join(', ')}${unmatchedCodes.length > 5 ? '…' : ''}.`
        : '';

      alert(`Se importaron ${importedCodes.length} código(s). ${matchedCount} coinciden con productos del reporte.${unmatchedMessage}`);
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

function getEffectivePhysicalMap() {
  const localCounts = JSON.parse(localStorage.getItem('db_counts') || '[]');
  const physicalMap = {};

  Object.entries(importedStockMap).forEach(([key, value]) => {
    const normalizedKey = normalizeCodigo(key);
    physicalMap[normalizedKey] = Number(value || 0);
  });

  localCounts.forEach((item) => {
    if (!item || !item.codigo) return;
    const key = normalizeCodigo(item.codigo);
    physicalMap[key] = (physicalMap[key] || 0) + Number(item.cantidad || 0);
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
      const product = productsDB.find(item => item.codigo.toLowerCase() === codigo.toLowerCase());
      if (product) openNewProductForm(product.codigo, product);
      return;
    }

    if (action === 'delete') {
      const product = productsDB.find(item => item.codigo.toLowerCase() === codigo.toLowerCase());
      if (!product) return;

      const confirmed = confirm(`¿Seguro que querés eliminar "${product.descripcion}" (${product.codigo})?`);
      if (!confirmed) return;

      await API.deleteProduct(product.codigo);
      productsDB = productsDB.filter(item => item.codigo.toLowerCase() !== product.codigo.toLowerCase());
      localStorage.setItem('db_products', JSON.stringify(productsDB));
      await loadCounts();
      refreshReportViews();
      alert('Producto eliminado correctamente.');
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
  }
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
  const ubicacion = document.getElementById('new-product-ubicacion').value.trim();
  const stockTeorico = Number(document.getElementById('new-product-stock').value);
  const cantidad = Number(document.getElementById('new-product-cantidad').value);
  const usuario = document.getElementById('input-usuario').value.trim() || 'Operador 1';

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
    const shouldProceed = confirm(`El código "${codigo}" ya existe para "${duplicate.descripcion}". ¿Deseás continuar igual?`);
    if (!shouldProceed) {
      document.getElementById('new-product-codigo').focus();
      return;
    }
  }

  const newProduct = {
    codigo,
    descripcion,
    marca,
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
        hora: now.toLocaleTimeString()
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
  await API.saveProduct(newProduct);

  if (cantidad > 0) {
    const now = new Date();
    await API.saveCount({
      codigo,
      descripcion,
      cantidad,
      usuario,
      fecha: now.toLocaleDateString(),
      hora: now.toLocaleTimeString()
    });
    await loadCounts();
  }

  refreshReportViews();
  hideNewProductForm();
  alert(`Se agregó el ítem "${descripcion}" con stock inicial ${stockTeorico}.`);
  resetForm();
}

function getAccumulatedCount(codigo) {
  const history = JSON.parse(localStorage.getItem('db_counts') || '[]');
  return history
    .filter(item => item.codigo.toLowerCase() === codigo.toLowerCase())
    .reduce((sum, item) => sum + item.cantidad, 0);
}

function searchProduct(codigo) {
  if (!codigo) return;
  
  currentProduct = productsDB.find(p => p.codigo.toLowerCase() === codigo.toLowerCase());
  
  const infoBox = document.getElementById('product-info');
  const inputCantidad = document.getElementById('input-cantidad');
  const btnRegistrar = document.getElementById('btn-registrar');

  if (currentProduct) {
    const acumulado = getAccumulatedCount(currentProduct.codigo);

    document.getElementById('info-desc').textContent = currentProduct.descripcion;
    document.getElementById('info-marca').textContent = currentProduct.marca;
    document.getElementById('info-ubicacion').textContent = currentProduct.ubicacion || 'Sin ubicar';
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
  const usuario = document.getElementById('input-usuario').value.trim();

  if (!currentProduct || isNaN(cantidad) || cantidad <= 0) {
    alert("Ingrese una cantidad válida mayor a 0.");
    return;
  }

  const now = new Date();
  const payload = {
    codigo: currentProduct.codigo,
    descripcion: currentProduct.descripcion,
    cantidad: cantidad,
    usuario: usuario || 'Operador 1',
    fecha: now.toLocaleDateString(),
    hora: now.toLocaleTimeString()
  };

  // Guardar conteo
  await API.saveCount(payload);
  await loadCounts();
  refreshReportViews();

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
  }
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
        || (prod.marca || '').toLowerCase().includes(query);
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
      <td>${prod.ubicacion || '-'}</td>
      <td>${prod.stockTeorico}</td>
      <td><strong>${contado ? stockFisico : '-'}</strong></td>
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
      <td><strong style="color: #2563eb;">${item.cantidad}</strong></td>
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
  csv += "Codigo;Descripcion;Marca;Ubicacion;StockTeorico;StockFisico;Diferencia;Estado\n";

  productsDB.forEach(prod => {
    const key = normalizeCodigo(prod.codigo);
    const contado = Object.prototype.hasOwnProperty.call(physicalMap, key);
    const stockFisico = physicalMap[key] || 0;
    const diferencia = stockFisico - prod.stockTeorico;
    let estado = !contado ? 'No Contado' : (diferencia < 0 ? 'Faltante' : (diferencia > 0 ? 'Sobrante' : 'Correcto'));

    csv += `"${prod.codigo}";"${prod.descripcion}";"${prod.marca}";"${prod.ubicacion || ''}";${prod.stockTeorico};${stockFisico};${diferencia};"${estado}"\n`;
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
