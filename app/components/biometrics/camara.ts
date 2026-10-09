// Cámara del asistente de firma: qué decir cuando no abre y la captura simulada para pruebas.
//
// Hasta oct 2026, sin cámara el asistente ofrecía en producción «Usar Captura Simulada (Modo
// Pruebas)» y «Pasar a Captura Manual». Entregaban un SVG que el servidor guardaba como 21 bytes
// sin sentido con nombre .jpg, y el acta mostraba imagen rota. Ahora, sin cámara, se explica la
// causa y se ofrece «Reintentar»; la captura simulada solo existe en local (ver abajo).

/** Por qué no abrió la cámara, dicho para quien tiene el dispositivo en la mano. */
export interface ErrorCamara {
  titulo: string;
  detalle: string;
}

export function describirErrorCamara(err: unknown): ErrorCamara {
  // El navegador solo da la cámara en conexiones seguras (https o localhost). Por http desde otra
  // máquina, p. ej. el celular contra `next dev` en la red local, navigator.mediaDevices no existe.
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return {
      titulo: 'Conexión no segura',
      detalle: 'El navegador solo permite usar la cámara en páginas https. Abre la app desde su dirección segura.'
    };
  }

  const nombre = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
  switch (nombre) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        titulo: 'Permiso de cámara denegado',
        detalle: 'Permite la cámara para este sitio en la configuración del navegador y pulsa «Reintentar».'
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return {
        titulo: 'No se encontró una cámara',
        detalle: 'Este dispositivo no tiene una cámara disponible. Usa otro dispositivo para firmar.'
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        titulo: 'La cámara está ocupada',
        detalle: 'Otra aplicación la está usando. Ciérrala y pulsa «Reintentar».'
      };
    default:
      return {
        titulo: 'Cámara no disponible',
        detalle: 'No pudimos abrir la cámara. Pulsa «Reintentar» o usa otro dispositivo.'
      };
  }
}

/**
 * La captura simulada sirve para probar el asistente sin cámara, y solo existe con `next dev`
 * contra un Supabase local (127.0.0.1 o localhost). `next build` deja NODE_ENV en 'production', y
 * `.env.local` apunta a la base real: con `next dev` contra ella tampoco aparece, para que una
 * imagen de relleno nunca termine en un acta de verdad.
 */
export const CAPTURA_SIMULADA_DISPONIBLE =
  process.env.NODE_ENV === 'development' &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');

/**
 * Dibuja una imagen de relleno y la entrega como JPEG, igual que una captura real: una silueta
 * para el rostro o una tarjeta para la cédula, con la leyenda «CAPTURA SIMULADA».
 */
export function generarCapturaSimulada(tipo: 'rostro' | 'cedula'): string {
  const canvas = document.createElement('canvas');
  canvas.width = tipo === 'rostro' ? 480 : 800;
  canvas.height = tipo === 'rostro' ? 480 : 450;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite dibujar la captura simulada.');

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#475569';
  if (tipo === 'rostro') {
    // Cabeza y hombros
    ctx.beginPath();
    ctx.arc(240, 190, 95, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(240, 480, 180, 160, 0, Math.PI, 0);
    ctx.fill();
  } else {
    // Foto y renglones de una cédula
    ctx.fillRect(60, 110, 200, 240);
    ctx.fillRect(300, 130, 420, 34);
    ctx.fillRect(300, 200, 320, 28);
    ctx.fillRect(300, 260, 240, 28);
  }

  ctx.fillStyle = '#00abd8';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CAPTURA SIMULADA', canvas.width / 2, canvas.height / 2);

  return canvas.toDataURL('image/jpeg', 0.85);
}
