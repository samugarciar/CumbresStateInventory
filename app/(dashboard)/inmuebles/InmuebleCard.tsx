'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  MapPin,
  Camera,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Settings2,
  ClipboardList,
  UserCheck,
} from 'lucide-react';
import StateSelector from './StateSelector';
import AsesorSelector from './AsesorSelector';
import UnidadEditor from './UnidadEditor';
import OfertarControl from './OfertarControl';
import PhotosGallery from './PhotosGallery';

interface Asesor {
  id: string;
  nombre_completo: string;
}

interface InmuebleCardProps {
  inmueble: any; // fila de inmuebles con joins usuarios / usuarios_override
  asesores: Asesor[];
  unidadesExistentes: string[];
  isAdmin: boolean;
}

// Tarjeta "feed" del catálogo: la foto manda, la info clave se lee de un
// vistazo y los controles de gestión viven colapsados bajo "Gestionar".
export default function InmuebleCard({ inmueble: inm, asesores, unidadesExistentes, isAdmin }: InmuebleCardProps) {
  const [fotoIdx, setFotoIdx] = useState(0);
  const [rotas, setRotas] = useState<Set<number>>(new Set());
  const [gestionar, setGestionar] = useState(false);

  // Sanitizar imágenes (mismo criterio que PhotosGallery)
  let fotos: string[] = [];
  if (Array.isArray(inm.imagenes)) {
    fotos = inm.imagenes.map((img: any) => (typeof img === 'string' ? img : img?.imagen)).filter(Boolean);
  }
  const tieneFoto = fotos.length > 0 && !rotas.has(fotoIdx);

  const esArriendo = inm.tipo_transaccion === 'arriendo';
  const ofertado = inm.estado_override === 'disponible';
  const asesorNombre = inm.usuarios_override?.nombre_completo || inm.usuarios?.nombre_completo;

  const anterior = (e: React.MouseEvent) => {
    e.preventDefault();
    setFotoIdx(prev => (prev === 0 ? fotos.length - 1 : prev - 1));
  };
  const siguiente = (e: React.MouseEvent) => {
    e.preventDefault();
    setFotoIdx(prev => (prev === fotos.length - 1 ? 0 : prev + 1));
  };

  // Ventana deslizante de máximo 6 puntos alrededor de la foto actual
  const puntos = () => {
    const MAX = 6;
    if (fotos.length <= MAX) return fotos.map((_, i) => i);
    let inicio = Math.max(0, Math.min(fotoIdx - 2, fotos.length - MAX));
    return Array.from({ length: MAX }, (_, k) => inicio + k);
  };

  // Chip de estado sobre la foto (colores sólidos, legibles sobre cualquier imagen)
  const estadoChip = () => {
    if (inm.estado === 'disponible') return { txt: 'Disponible', bg: '#dcfce7', color: '#166534' };
    if (inm.estado === 'arrendado') return { txt: 'Arrendado', bg: '#e2e8f0', color: '#334155' };
    return { txt: inm.estado, bg: '#e2e8f0', color: '#334155' };
  };
  const chip = estadoChip();

  // Línea de contexto: unidad · barrio, ciudad · tipo · hab · baños
  const metaPartes: string[] = [];
  if (inm.unidad?.trim()) metaPartes.push(inm.unidad.trim());
  const zona = [inm.barrio, inm.ciudad].filter(Boolean).join(', ');
  if (zona) metaPartes.push(zona);
  if (inm.tipo_inmueble) metaPartes.push(inm.tipo_inmueble);
  if (inm.habitaciones) metaPartes.push(`${inm.habitaciones} hab`);
  if (inm.banos) metaPartes.push(`${inm.banos} baño${inm.banos !== 1 ? 's' : ''}`);

  return (
    <div className="glass-card animate-fade-in" style={styles.card}>
      {/* ---- Foto (o placeholder) con badges ---- */}
      <div style={styles.media}>
        {tieneFoto ? (
          <img
            src={fotos[fotoIdx]}
            alt={inm.titulo || 'Foto del inmueble'}
            loading="lazy"
            style={styles.mediaImg}
            onError={() => setRotas(prev => new Set(prev).add(fotoIdx))}
          />
        ) : (
          <div style={styles.mediaVacia}>
            <ImageOff size={30} color="var(--text-muted)" />
            <span style={styles.mediaVaciaTxt}>{fotos.length === 0 ? 'Sin fotos aún' : 'Foto no disponible'}</span>
          </div>
        )}

        <span style={{ ...styles.chipEstado, backgroundColor: chip.bg, color: chip.color }}>{chip.txt}</span>
        {ofertado && <span style={{ ...styles.chipEstado, top: '2.55rem', backgroundColor: '#fef3c7', color: '#92400e' }}>Desocupación</span>}
        <span style={{ ...styles.chipTransaccion, backgroundColor: esArriendo ? '#e0f2fe' : '#ede9fe', color: esArriendo ? '#075985' : '#5b21b6' }}>
          {esArriendo ? 'Arriendo' : 'Venta'}
        </span>

        {fotos.length > 0 && (
          <span style={styles.chipFotos}>
            <Camera size={11} style={{ marginRight: 3, verticalAlign: '-1.5px' }} />
            {fotos.length}
          </span>
        )}

        {fotos.length > 1 && (
          <>
            <button onClick={anterior} style={{ ...styles.navBtn, left: '0.5rem' }} title="Foto anterior" aria-label="Foto anterior">
              <ChevronLeft size={17} />
            </button>
            <button onClick={siguiente} style={{ ...styles.navBtn, right: '0.5rem' }} title="Foto siguiente" aria-label="Foto siguiente">
              <ChevronRight size={17} />
            </button>
            <div style={styles.dots}>
              {puntos().map(i => (
                <span
                  key={i}
                  style={{
                    ...styles.dot,
                    opacity: i === fotoIdx ? 1 : 0.55,
                    width: i === fotoIdx ? '7px' : '5px',
                    height: i === fotoIdx ? '7px' : '5px',
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Info clave ---- */}
      <div style={styles.body}>
        <p style={styles.precio}>
          {inm.precio
            ? <>${Number(inm.precio).toLocaleString('es-CO')}<span style={styles.precioSufijo}>{esArriendo ? ' COP/mes' : ' COP'}</span></>
            : <span style={{ ...styles.precioSufijo, fontSize: '0.85rem' }}>Sin precio registrado</span>}
        </p>
        <p style={styles.direccion} title={inm.titulo || undefined}>
          <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0 }} />
          <span style={styles.direccionTxt}>{inm.direccion || inm.titulo}</span>
        </p>
        {metaPartes.length > 0 && <p style={styles.meta}>{metaPartes.join(' · ')}</p>}

        <div style={styles.chipsRow}>
          <span style={styles.codigo}>{inm.arrendasoft_id ? `#${inm.arrendasoft_id}` : 'Local'}</span>
          {isAdmin && asesorNombre && (
            <span style={styles.asesorChip} title={asesorNombre}>
              <UserCheck size={11} style={{ marginRight: 3, verticalAlign: '-1.5px' }} />
              {asesorNombre}
              {inm.usuarios_override && <span style={styles.reasignado}> · reasignado</span>}
            </span>
          )}
        </div>
      </div>

      {/* ---- Barra de acciones ---- */}
      <div style={styles.acciones}>
        <div style={styles.accionCelda}>
          <PhotosGallery imagenes={inm.imagenes} variant="bar" />
        </div>
        <div style={{ ...styles.accionCelda, borderLeft: '1px solid var(--border-color)' }}>
          <Link href={`/inventarios?action=new&inmuebleId=${inm.id}`} style={styles.accionLink}>
            <ClipboardList size={14} />
            Inventario
          </Link>
        </div>
        <div style={{ ...styles.accionCelda, borderLeft: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setGestionar(g => !g)}
            style={{ ...styles.accionBtn, color: gestionar ? 'var(--primary)' : 'var(--text-secondary)' }}
            title="Estado, asesor y unidad"
          >
            <Settings2 size={14} />
            Gestionar
          </button>
        </div>
      </div>

      {/* ---- Panel de gestión (colapsable) ---- */}
      {gestionar && (
        <div style={styles.panel}>
          <div style={styles.panelItem}>
            <span style={styles.panelLabel}>Estado</span>
            <StateSelector inmuebleId={inm.id} currentEstado={inm.estado} />
          </div>
          {isAdmin && (
            <div style={styles.panelItem}>
              <span style={styles.panelLabel}>Asignar asesor</span>
              <AsesorSelector
                inmuebleId={inm.id}
                asesorOverrideId={inm.asesor_id_override}
                defaultAsesorName={inm.usuarios?.nombre_completo || 'Sin asesor'}
                asesores={asesores}
              />
            </div>
          )}
          {isAdmin && (
            <div style={styles.panelItem}>
              <span style={styles.panelLabel}>Unidad</span>
              <UnidadEditor inmuebleId={inm.id} unidad={inm.unidad} unidadesExistentes={unidadesExistentes} />
            </div>
          )}
          {/* OfertarControl solo aplica si el ERP lo tiene arrendado o ya está ofertado */}
          {isAdmin && (inm.estado_erp === 'arrendado' || inm.estado_override) && (
            <div style={styles.panelItem}>
              <span style={styles.panelLabel}>Estado comercial</span>
              <OfertarControl inmuebleId={inm.id} estadoErp={inm.estado_erp} estadoOverride={inm.estado_override} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    overflow: 'hidden',
    minWidth: 0,
  },
  media: {
    position: 'relative',
    aspectRatio: '4 / 3',
    backgroundColor: 'var(--bg-secondary)',
    overflow: 'hidden',
  },
  mediaImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    display: 'block',
  },
  mediaVacia: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.35rem',
  },
  mediaVaciaTxt: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
  },
  chipEstado: {
    position: 'absolute' as const,
    top: '0.65rem',
    left: '0.65rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    padding: '0.18rem 0.65rem',
    borderRadius: '999px',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.18)',
  },
  chipTransaccion: {
    position: 'absolute' as const,
    top: '0.65rem',
    right: '0.65rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    padding: '0.18rem 0.65rem',
    borderRadius: '999px',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.18)',
  },
  chipFotos: {
    position: 'absolute' as const,
    bottom: '0.6rem',
    right: '0.6rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    padding: '0.12rem 0.5rem',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    color: '#475569',
  },
  navBtn: {
    position: 'absolute' as const,
    top: '50%',
    transform: 'translateY(-50%)',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    color: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.22)',
    padding: 0,
  },
  dots: {
    position: 'absolute' as const,
    bottom: '0.7rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  dot: {
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 3px rgba(15, 23, 42, 0.4)',
    transition: 'all 0.15s ease',
  },
  body: {
    padding: '0.8rem 1rem 0.7rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.28rem',
    minWidth: 0,
  },
  precio: {
    fontSize: '1.15rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
    letterSpacing: '-0.01em',
  },
  precioSufijo: {
    fontSize: '0.72rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
  },
  direccion: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: 0,
    minWidth: 0,
  },
  direccionTxt: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  meta: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  chipsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    marginTop: '0.3rem',
    minWidth: 0,
  },
  codigo: {
    fontSize: '0.72rem',
    fontWeight: '700',
    fontFamily: 'monospace',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  asesorChip: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '0.08rem 0.5rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  reasignado: {
    color: '#10b981',
    fontWeight: '700',
  },
  acciones: {
    display: 'flex',
    borderTop: '1px solid var(--border-color)',
    marginTop: 'auto',
  },
  accionCelda: {
    flex: 1,
    display: 'flex',
    minWidth: 0,
  },
  accionLink: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.35rem',
    padding: '0.6rem 0.5rem',
    fontSize: '0.78rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textDecoration: 'none',
  },
  accionBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.35rem',
    padding: '0.6rem 0.5rem',
    fontSize: '0.78rem',
    fontWeight: '600',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
  },
  panel: {
    borderTop: '1px dashed var(--border-color)',
    backgroundColor: 'var(--bg-secondary)',
    padding: '0.75rem 1rem 0.9rem',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '0.65rem 1rem',
  },
  panelItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
    minWidth: 0,
  },
  panelLabel: {
    fontSize: '0.68rem',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
};
