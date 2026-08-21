/*
 * Uso (PowerShell):
 * $env:SUPABASE_URL='https://<proyecto>.supabase.co'
 * $env:SUPABASE_SECRET_KEY='<clave-secreta>'
 * node scripts/import-render-data-to-supabase.js https://inventario-repuestos-q2m2.onrender.com
 */
const { createClient } = require('@supabase/supabase-js');

const sourceUrl = (process.argv[2] || '').replace(/\/$/, '');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!sourceUrl || !supabaseUrl || !supabaseKey) {
  console.error('Falta la URL de Render o las variables SUPABASE_URL y SUPABASE_SECRET_KEY.');
  process.exit(1);
}

async function main() {
  const [productsResponse, countsResponse] = await Promise.all([
    fetch(`${sourceUrl}/api/products`),
    fetch(`${sourceUrl}/api/counts`)
  ]);
  if (!productsResponse.ok || !countsResponse.ok) throw new Error('No se pudo leer el inventario actual de Render.');

  const products = await productsResponse.json();
  const counts = await countsResponse.json();
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (products.length) {
    const { error } = await supabase.from('productos').insert(products.map((product) => ({
      codigo: product.codigo,
      descripcion: product.descripcion,
      marca: product.marca,
      ubicacion: product.ubicacion,
      stock_teorico: product.stockTeorico
    })));
    if (error) throw error;
  }

  if (counts.length) {
    const { error } = await supabase.from('movimientos').insert(counts.map((count) => ({
      codigo: count.codigo,
      descripcion: count.descripcion,
      cantidad: count.cantidad,
      usuario: count.usuario,
      fecha: count.fecha,
      hora: count.hora,
      tipo: 'conteo'
    })));
    if (error) throw error;
  }

  console.log(`Importación terminada: ${products.length} productos y ${counts.length} conteos.`);
}

main().catch((error) => {
  console.error(`Error de importación: ${error.message}`);
  process.exit(1);
});
