import { createAdminClient } from '@/lib/supabase/admin';
import { fotosDeInmueble } from '@/lib/fotos';
import type { Metadata } from 'next';
import GaleriaCliente from './GaleriaCliente';

// Galería pública de fotos de un inmueble, para que el agente comercial
// comparta UN enlace corto por WhatsApp en vez de 3-4 URLs crudas del ERP.
// El campo de Kommo por donde sale el mensaje admite 256 caracteres y cada
// URL del ERP mide ~99, así que solo cabía una por mensaje: el cliente
// recibía varios mensajes seguidos con enlaces largos. Este enlace mide ~52
// y muestra TODAS las fotos (18 en promedio) en vez de las 4 que cabían.
//
// Es pública a propósito (el middleware solo protege /dashboard, /inmuebles,
// /inventarios): el cliente la abre desde WhatsApp sin cuenta. Solo expone
// datos que ya son de publicidad —los mismos del portal— nunca datos del
// propietario, del inquilino ni del contrato.

export const revalidate = 300;

interface Props {
  params: Promise<{ codigo: string }>;
}

async function traerInmueble(codigo: string) {
  const digits = codigo.replace(/\D/g, '');
  if (!digits || digits.length > 18) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('inmuebles')
    .select('titulo, descripcion, direccion, barrio, ciudad, unidad, precio, habitaciones, banos, tipo_inmueble, tipo_transaccion, estado, imagenes, arrendasoft_id')
    .eq('arrendasoft_id', Number(digits))
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo } = await params;
  const inm = await traerInmueble(codigo);
  if (!inm) return { title: 'Inmueble no encontrado | Cumbres' };
  const donde = [inm.barrio, inm.ciudad].filter(Boolean).join(', ');
  return {
    title: `${inm.unidad || inm.titulo} — Cumbres Inmobiliaria`,
    description: `${inm.habitaciones ?? '?'} habitaciones · ${donde}`,
    // Vista previa en WhatsApp: la primera foto real del inmueble.
    openGraph: {
      title: `${inm.unidad || inm.titulo}`,
      description: donde,
      images: fotosDeInmueble(inm.imagenes).slice(0, 1),
    },
  };
}

export default async function GaleriaInmueble({ params }: Props) {
  const { codigo } = await params;
  const inm = await traerInmueble(codigo);

  if (!inm) {
    return (
      <main style={estilos.vacio}>
        <img src="/logo.png" alt="Cumbres Inmobiliaria" style={{ height: 48, marginBottom: 20 }} />
        <h1 style={estilos.vacioTitulo}>No encontramos ese inmueble</h1>
        <p style={estilos.vacioTexto}>
          Escríbenos por WhatsApp y con gusto te ayudamos a encontrar el que buscas.
        </p>
      </main>
    );
  }

  // Repara las URLs partidas del ERP (ver lib/fotos.ts): el 40% de las fotos
  // guardadas apunta a un dominio que no existe y no cargaría.
  const fotos: string[] = fotosDeInmueble(inm.imagenes);
  const donde = [inm.barrio, inm.ciudad].filter(Boolean).join(', ');
  const precio = inm.precio
    ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(inm.precio)
    : null;

  return (
    <main style={estilos.pagina}>
      <header style={estilos.header}>
        <img src="/logo.png" alt="Cumbres Inmobiliaria" style={{ height: 40 }} />
      </header>

      <section style={estilos.ficha}>
        <h1 style={estilos.titulo}>{inm.unidad || inm.titulo}</h1>
        {donde && <p style={estilos.ubicacion}>{donde}</p>}
        {precio && (
          <p style={estilos.precio}>
            {precio}
            {inm.tipo_transaccion === 'arriendo' && <span style={estilos.mes}> /mes</span>}
          </p>
        )}
        <div style={estilos.datos}>
          {inm.habitaciones != null && <span style={estilos.dato}>{inm.habitaciones} habitaciones</span>}
          {inm.banos != null && <span style={estilos.dato}>{inm.banos} baños</span>}
          {inm.tipo_inmueble && <span style={estilos.dato}>{inm.tipo_inmueble}</span>}
        </div>
        {inm.estado !== 'disponible' && (
          <p style={estilos.noDisponible}>Este inmueble ya no está disponible.</p>
        )}
      </section>

      <GaleriaCliente fotos={fotos} titulo={inm.unidad || inm.titulo} />

      <footer style={estilos.footer}>
        <p style={estilos.footerTexto}>
          ¿Quieres visitarlo? Respóndenos por WhatsApp y te agendamos.
        </p>
        <p style={estilos.footerMarca}>Cumbres Inmobiliaria · Código {inm.arrendasoft_id}</p>
      </footer>
    </main>
  );
}

const estilos: Record<string, React.CSSProperties> = {
  pagina: { minHeight: '100vh', background: '#f6f7f9', color: '#0f172a', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  header: { padding: '16px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb' },
  ficha: { padding: '20px', background: '#fff', marginBottom: 12 },
  titulo: { fontSize: '1.35rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' },
  ubicacion: { margin: '4px 0 0', color: '#64748b', fontSize: '0.95rem' },
  precio: { margin: '12px 0 0', fontSize: '1.5rem', fontWeight: 800, color: '#00abd8' },
  mes: { fontSize: '0.9rem', fontWeight: 600, color: '#64748b' },
  datos: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  dato: { background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '5px 12px', fontSize: '0.85rem', textTransform: 'capitalize' },
  noDisponible: { marginTop: 14, padding: '10px 12px', background: '#fef3c7', color: '#92400e', borderRadius: 8, fontSize: '0.9rem', fontWeight: 600 },
  footer: { padding: '24px 20px 40px', textAlign: 'center' },
  footerTexto: { margin: 0, fontSize: '0.95rem', fontWeight: 600 },
  footerMarca: { margin: '8px 0 0', fontSize: '0.8rem', color: '#94a3b8' },
  vacio: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif', background: '#f6f7f9' },
  vacioTitulo: { fontSize: '1.2rem', margin: 0 },
  vacioTexto: { color: '#64748b', marginTop: 8 },
};
