let html5QrcodeScanner = null;

function toggleCameraScanner() {
  const container = document.getElementById('camera-scanner-container');
  if (container.classList.contains('hidden')) {
    startCameraScanner();
  } else {
    stopCameraScanner();
  }
}

function startCameraScanner() {
  const container = document.getElementById('camera-scanner-container');
  container.classList.remove('hidden');

  if (html5QrcodeScanner === null) {
    html5QrcodeScanner = new Html5Qrcode("reader");
  }

  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  html5QrcodeScanner.start(
    { facingMode: "environment" },
    config,
    onScanSuccess,
    onScanFailure
  ).catch(err => {
    alert("Error al acceder a la cámara: " + err);
    container.classList.add('hidden');
  });
}

function stopCameraScanner() {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.stop().then(() => {
      document.getElementById('camera-scanner-container').classList.add('hidden');
    }).catch(err => console.error("Error deteniendo escáner:", err));
  } else {
    document.getElementById('camera-scanner-container').classList.add('hidden');
  }
}

function onScanSuccess(decodedText, decodedResult) {
  // Asignar el código escaneado al input
  const inputCodigo = document.getElementById('input-codigo');
  inputCodigo.value = decodedText.trim();
  
  // Buscar inmediatamente el producto
  searchProduct(decodedText.trim());

  // Opcional: Sonido Beep corto al escanear exitosamente
  playBeepSound();

  // Cerrar cámara automáticamente
  stopCameraScanner();
}

function onScanFailure(error) {
  // Ignorar errores continuos de búsqueda de marcos
}

function playBeepSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    // Si la política de audio del navegador lo bloquea, no rompe la ejecución
  }
}
