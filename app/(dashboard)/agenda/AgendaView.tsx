'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Eye, X, Loader2 } from 'lucide-react';
import ModalFranja from './ModalFranja';
import { eliminarFranjaHoraria } from '@/app/actions/agenda';

// --- Tipos ---
interface Franja {
  id: string;
  inmueble_id: string;
  asesor_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  color: string;
  inmuebles: { id: string; titulo: string; direccion: string; unidad?: string | null } | null;
  usuarios: { id: string; nombre_completo: string } | null;
}

interface Cita {
  id: string;
  franja_id: string;
  inmueble_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cliente_nombre: string;
  cliente_telefono: string;
  origen: string;
  alcance?: string;
  unidad?: string | null;
  aptos_snapshot?: { titulo: string }[] | null;
  inmuebles: { titulo: string; direccion?: string; unidad?: string | null } | null;
}

interface Asesor { id: string; nombre_completo: string; }
interface Inmueble { id: string; titulo: string; direccion: string; unidad?: string | null; }

interface AgendaViewProps {
  franjas: Franja[];
  citas: Cita[];
  asesores: Asesor[];
  inmuebles: Inmueble[];
  isAdmin: boolean;
  userId: string;
  inmobiliariaId: string;
  fechaInicioSemana: string;
}

// --- Constantes ---
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const HORA_INICIO = 8;
const HORA_FIN = 18;

// Genera las franjas horarias de 30 min
function generarSlots(): string[] {
  const slots: string[] = [];
  for (let h = HORA_INICIO; h < HORA_FIN; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}
const SLOTS = generarSlots();

// Helpers de fecha
function getLunes(fecha: Date): Date {
  const d = new Date(fecha);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatFecha(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDiasSemana(lunes: Date): Date[] {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });
}

function esHoy(fecha: Date): boolean {
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getFullYear() === hoy.getFullYear();
}

// Cuántos slots de 30 min ocupa una franja
function calcSlots(horaInicio: string, horaFin: string): number {
  const [h1, m1] = horaInicio.split(':').map(Number);
  const [h2, m2] = horaFin.split(':').map(Number);
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 30;
}

// Etiqueta de ubicación para mostrar: la unidad si existe; si no, la dirección
function etiquetaUbicacion(inm?: { unidad?: string | null; direccion?: string | null } | null): string {
  if (!inm) return 'Sin ubicación';
  const u = (inm.unidad || '').trim();
  return u || inm.direccion || 'Sin ubicación';
}

export default function AgendaView({
  franjas: franjasIniciales, citas, asesores, inmuebles, isAdmin, userId, inmobiliariaId, fechaInicioSemana
}: AgendaViewProps) {
  const router = useRouter();
  // La semana mostrada la dicta el servidor (prop), que la lee de la URL (?semana=)
  const lunes = useMemo(() => new Date(fechaInicioSemana + 'T00:00:00'), [fechaInicioSemana]);
  const [filtroAsesor, setFiltroAsesor] = useState<string>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [defaultFecha, setDefaultFecha] = useState('');
  const [defaultHora, setDefaultHora] = useState('');
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  // Móvil: día seleccionado (0-5 = lun-sáb)
  const [diaMovil, setDiaMovil] = useState(0);

  React.useEffect(() => {
    const hoy = new Date();
    const day = hoy.getDay();
    setDiaMovil(day === 0 ? 5 : Math.min(day - 1, 5));
  }, []);

  const dias = useMemo(() => getDiasSemana(lunes), [lunes]);

  // Citas agendadas agrupadas por franja
  const citasPorFranja = useMemo(() => {
    const map: Record<string, Cita[]> = {};
    for (const c of citas) {
      if (!map[c.franja_id]) map[c.franja_id] = [];
      map[c.franja_id].push(c);
    }
    return map;
  }, [citas]);

  // Filtrar franjas según asesor seleccionado
  const franjasFiltradas = useMemo(() => {
    if (filtroAsesor === 'todos') return franjasIniciales;
    return franjasIniciales.filter(f => f.asesor_id === filtroAsesor);
  }, [franjasIniciales, filtroAsesor]);

  // Mapa: fecha → hora_inicio → franja (para lookup rápido)
  const franjaMap = useMemo(() => {
    const map: Record<string, Record<string, Franja>> = {};
    for (const f of franjasFiltradas) {
      if (!map[f.fecha]) map[f.fecha] = {};
      const hora = f.hora_inicio.substring(0, 5);
      map[f.fecha][hora] = f;
    }
    return map;
  }, [franjasFiltradas]);

  // Set de celdas ocupadas por franjas multi-slot (para no renderizar celdas intermedias)
  const celdasOcupadas = useMemo(() => {
    const set = new Set<string>();
    for (const f of franjasFiltradas) {
      const slots = calcSlots(f.hora_inicio.substring(0, 5), f.hora_fin.substring(0, 5));
      const [h, m] = f.hora_inicio.substring(0, 5).split(':').map(Number);
      for (let i = 1; i < slots; i++) {
        const minTotal = h * 60 + m + i * 30;
        const hh = String(Math.floor(minTotal / 60)).padStart(2, '0');
        const mm = String(minTotal % 60).padStart(2, '0');
        set.add(`${f.fecha}_${hh}:${mm}`);
      }
    }
    return set;
  }, [franjasFiltradas]);

  // Navegación semanal: cambia la URL (?semana=) para que el servidor traiga esa semana
  const navSemana = useCallback((dir: number) => {
    const nueva = new Date(lunes);
    nueva.setDate(lunes.getDate() + dir * 7);
    router.push(`/agenda?semana=${formatFecha(nueva)}`);
  }, [lunes, router]);

  const irHoy = useCallback(() => {
    router.push(`/agenda?semana=${formatFecha(getLunes(new Date()))}`);
  }, [router]);

  // Abrir modal para nueva franja
  const abrirNueva = (fecha: string, hora: string) => {
    setEditData(null);
    setDefaultFecha(fecha);
    setDefaultHora(hora);
    setModalOpen(true);
  };

  // Abrir modal para editar
  const abrirEdicion = (franja: Franja) => {
    if (!isAdmin) return;
    setEditData({
      id: franja.id,
      inmueble_id: franja.inmueble_id,
      asesor_id: franja.asesor_id,
      fecha: franja.fecha,
      hora_inicio: franja.hora_inicio,
      hora_fin: franja.hora_fin,
      color: franja.color,
    });
    setDefaultFecha('');
    setDefaultHora('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditData(null);
    router.refresh();
  };

  // Eliminar una franja directo desde el calendario (X roja), sin abrir el modal.
  // El server action rechaza si la franja tiene citas agendadas.
  const eliminarFranja = useCallback(async (e: React.MouseEvent, franja: Franja) => {
    e.stopPropagation(); // no disparar la edición de la celda
    const nombre = franja.inmuebles?.titulo || 'esta franja';
    const horario = `${franja.hora_inicio.substring(0, 5)}–${franja.hora_fin.substring(0, 5)}`;
    if (!confirm(`¿Eliminar la franja de "${nombre}" (${horario})?`)) return;
    setEliminandoId(franja.id);
    const result = await eliminarFranjaHoraria(franja.id);
    setEliminandoId(null);
    if (!result.success) {
      alert(result.error || 'No se pudo eliminar la franja.');
      return;
    }
    router.refresh();
  }, [router]);

  // Formato de semana para el header
  const textoSemana = `${dias[0].getDate()} ${MESES_SHORT[dias[0].getMonth()]}. — ${dias[5].getDate()} ${MESES_SHORT[dias[5].getMonth()]}. de ${dias[5].getFullYear()}`;

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="responsive-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={styles.pageTitle}>
            <CalendarDays size={28} color="var(--primary)" />
            Agenda Semanal
          </h1>
          <p style={styles.pageSubtitle}>
            {isAdmin ? 'Programa franjas horarias para tus asesores' : 'Consulta tu agenda de la semana'}
          </p>
        </div>
        <div className="responsive-header-buttons">
          {!isAdmin && (
            <span className="badge badge-info" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
              <Eye size={14} style={{ marginRight: 4 }} />
              Solo lectura
            </span>
          )}
          {isAdmin && (
            <button
              className="btn btn-primary"
              onClick={() => abrirNueva(formatFecha(dias[0]), '08:00')}
            >
              <Plus size={18} />
              Nueva Franja
            </button>
          )}
        </div>
      </div>

      {/* Controles: Navegación de semana + Filtro asesor */}
      <div style={styles.controlsBar} className="glass-card">
        {/* Navegación semanal */}
        <div style={styles.navSemana}>
          <button onClick={() => navSemana(-1)} style={styles.navBtn} title="Semana anterior">
            <ChevronLeft size={18} />
          </button>
          <span style={styles.semanaTexto}>{textoSemana}</span>
          <button onClick={() => navSemana(1)} style={styles.navBtn} title="Semana siguiente">
            <ChevronRight size={18} />
          </button>
          <button onClick={irHoy} className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}>
            Hoy
          </button>
        </div>

        {/* Filtro por asesor (solo admin) */}
        {isAdmin && asesores.length > 0 && (
          <div style={styles.filtroAsesor}>
            <button
              onClick={() => setFiltroAsesor('todos')}
              style={{
                ...styles.filtroBtn,
                backgroundColor: filtroAsesor === 'todos' ? 'var(--primary)' : 'transparent',
                color: filtroAsesor === 'todos' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Todos
            </button>
            {asesores.map(a => (
              <button
                key={a.id}
                onClick={() => setFiltroAsesor(a.id)}
                style={{
                  ...styles.filtroBtn,
                  backgroundColor: filtroAsesor === a.id ? 'var(--primary)' : 'transparent',
                  color: filtroAsesor === a.id ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {a.nombre_completo.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selector de día para móvil */}
      <div className="mobile-only" style={styles.diasMovil}>
        {dias.map((d, i) => (
          <button
            key={i}
            onClick={() => setDiaMovil(i)}
            style={{
              ...styles.diaMovilBtn,
              backgroundColor: diaMovil === i ? 'var(--primary)' : esHoy(d) ? 'rgba(0,171,216,0.08)' : 'transparent',
              color: diaMovil === i ? '#fff' : esHoy(d) ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: diaMovil === i || esHoy(d) ? '700' : '500',
            }}
          >
            <span style={{ fontSize: '0.7rem' }}>{DIAS_SEMANA[i]}</span>
            <span style={{ fontSize: '1rem' }}>{d.getDate()}</span>
          </button>
        ))}
      </div>

      {/* ========== CALENDARIO DESKTOP ========== */}
      <div className="desktop-only" style={styles.calendarWrapper}>
        <div style={styles.calendar}>
          {/* Header de días */}
          <div style={styles.headerVacio} />
          {dias.map((d, i) => (
            <div
              key={i}
              style={{
                ...styles.headerDia,
                backgroundColor: esHoy(d) ? 'rgba(0,171,216,0.06)' : 'transparent',
                borderBottom: esHoy(d) ? '2px solid var(--primary)' : '1px solid var(--border-color)',
              }}
            >
              <span style={styles.headerDiaNombre}>{DIAS_SEMANA[i]}</span>
              <span style={{
                ...styles.headerDiaNum,
                color: esHoy(d) ? 'var(--primary)' : 'var(--text-primary)',
              }}>
                {d.getDate()}
              </span>
            </div>
          ))}

          {/* Filas de slots */}
          {SLOTS.map(slot => (
            <React.Fragment key={slot}>
              {/* Label de hora */}
              <div style={styles.horaLabel}>
                {slot.endsWith(':00') ? slot : ''}
              </div>

              {/* 6 celdas (Lun-Sáb) */}
              {dias.map((d, diaIdx) => {
                const fechaStr = formatFecha(d);
                const key = `${fechaStr}_${slot}`;

                // Celda ocupada por franja multi-slot → no renderizar
                if (celdasOcupadas.has(key)) return null;

                const franja = franjaMap[fechaStr]?.[slot];

                if (franja) {
                  const numSlots = calcSlots(franja.hora_inicio.substring(0, 5), franja.hora_fin.substring(0, 5));
                  const inmuebleNombre = etiquetaUbicacion(franja.inmuebles);
                  const asesorNombre = franja.usuarios?.nombre_completo || '';
                  const citasFranja = citasPorFranja[franja.id] || [];

                  return (
                    <div
                      key={diaIdx}
                      style={{
                        ...styles.celdaConFranja,
                        gridRow: `span ${numSlots}`,
                        borderLeftColor: franja.color || 'var(--primary)',
                        cursor: isAdmin ? 'pointer' : 'default',
                      }}
                      onClick={() => abrirEdicion(franja)}
                      title={`${inmuebleNombre}\n${franja.hora_inicio.substring(0,5)} – ${franja.hora_fin.substring(0,5)}\n${asesorNombre}${citasFranja.length > 0 ? `\n${citasFranja.length} cita(s) agendada(s)` : ''}`}
                    >
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => eliminarFranja(e, franja)}
                          disabled={eliminandoId === franja.id}
                          style={styles.franjaDeleteBtn}
                          title="Eliminar franja"
                        >
                          {eliminandoId === franja.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <X size={11} />}
                        </button>
                      )}
                      <span style={styles.franjaTitle}>{inmuebleNombre}</span>
                      <span style={styles.franjaHora}>
                        {franja.hora_inicio.substring(0, 5)} – {franja.hora_fin.substring(0, 5)}
                      </span>
                      {filtroAsesor === 'todos' && asesorNombre && (
                        <span style={styles.franjaAsesor}>{asesorNombre.split(' ')[0]}</span>
                      )}
                      {citasFranja.length > 0 && (
                        <span style={styles.franjaCitasBadge}>
                          {citasFranja.length} cita{citasFranja.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  );
                }

                // Celda vacía
                return (
                  <div
                    key={diaIdx}
                    style={{
                      ...styles.celda,
                      borderBottom: slot.endsWith(':00') ? '1px solid var(--border-color)' : '1px solid rgba(226,232,240,0.4)',
                      cursor: isAdmin ? 'pointer' : 'default',
                    }}
                    onClick={isAdmin ? () => abrirNueva(fechaStr, slot) : undefined}
                    onMouseEnter={isAdmin ? (e) => { (e.target as HTMLElement).style.backgroundColor = 'rgba(0,171,216,0.04)'; } : undefined}
                    onMouseLeave={isAdmin ? (e) => { (e.target as HTMLElement).style.backgroundColor = 'transparent'; } : undefined}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ========== CALENDARIO MÓVIL (vista de día) ========== */}
      <div className="mobile-only" style={{ marginTop: '0.75rem' }}>
        {(() => {
          const diaSeleccionado = dias[diaMovil];
          const fechaStr = formatFecha(diaSeleccionado);
          const franjasDelDia = franjasFiltradas
            .filter(f => f.fecha === fechaStr)
            .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

          if (franjasDelDia.length === 0) {
            return (
              <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <CalendarDays size={40} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
                <p style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Sin franjas programadas</p>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {DIAS_SEMANA[diaMovil]} {diaSeleccionado.getDate()} de {MESES_LONG[diaSeleccionado.getMonth()]}
                </p>
                {isAdmin && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '1rem' }}
                    onClick={() => abrirNueva(fechaStr, '08:00')}
                  >
                    <Plus size={16} /> Agregar Franja
                  </button>
                )}
              </div>
            );
          }

          return franjasDelDia.map(f => (
            <div
              key={f.id}
              className="glass-card"
              style={{
                ...styles.movilCard,
                borderLeft: `4px solid ${f.color || 'var(--primary)'}`,
                cursor: isAdmin ? 'pointer' : 'default',
              }}
              onClick={() => isAdmin && abrirEdicion(f)}
            >
              <div style={styles.movilCardHeader}>
                <span style={styles.movilCardHora}>
                  {f.hora_inicio.substring(0, 5)} – {f.hora_fin.substring(0, 5)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {filtroAsesor === 'todos' && f.usuarios && (
                    <span className="badge badge-info" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>
                      {f.usuarios.nombre_completo.split(' ')[0]}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => eliminarFranja(e, f)}
                      disabled={eliminandoId === f.id}
                      style={styles.movilDeleteBtn}
                      title="Eliminar franja"
                    >
                      {eliminandoId === f.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <X size={14} />}
                    </button>
                  )}
                </div>
              </div>
              <div style={styles.movilCardTitle}>{etiquetaUbicacion(f.inmuebles)}</div>
              {f.inmuebles?.unidad?.trim() && f.inmuebles?.direccion && (
                <div style={styles.movilCardDireccion}>{f.inmuebles.direccion}</div>
              )}
              {(citasPorFranja[f.id] || []).map(c => (
                <div key={c.id} style={styles.movilCita}>
                  {c.hora_inicio.substring(0, 5)}–{c.hora_fin.substring(0, 5)} · {c.cliente_nombre} ({c.cliente_telefono})
                </div>
              ))}
            </div>
          ));
        })()}
      </div>

      {/* Modal */}
      <ModalFranja
        isOpen={modalOpen}
        onClose={cerrarModal}
        asesores={asesores}
        inmuebles={inmuebles}
        citasFranja={editData ? citasPorFranja[editData.id] || [] : []}
        editData={editData}
        defaultFecha={defaultFecha}
        defaultHora={defaultHora}
        defaultAsesorId={filtroAsesor !== 'todos' ? filtroAsesor : undefined}
      />
    </div>
  );
}

// --- Estilos ---
const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: '1.65rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  pageSubtitle: {
    fontSize: '0.88rem',
    color: 'var(--text-muted)',
    marginTop: '0.25rem',
  },
  controlsBar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
  },
  navSemana: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  navBtn: {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    transition: 'all 0.15s',
  },
  semanaTexto: {
    fontSize: '0.92rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    minWidth: '180px',
    textAlign: 'center' as const,
  },
  filtroAsesor: {
    display: 'flex',
    gap: '0.25rem',
    flexWrap: 'wrap' as const,
  },
  filtroBtn: {
    padding: '0.35rem 0.75rem',
    fontSize: '0.78rem',
    fontWeight: '600',
    borderRadius: '20px',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  },
  diasMovil: {
    display: 'flex',
    gap: '0.25rem',
    padding: '0.5rem',
    justifyContent: 'space-between',
    marginTop: '0.5rem',
  },
  diaMovilBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.15rem',
    padding: '0.5rem 0.6rem',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
    flex: 1,
  },

  // ---- Calendario Desktop ----
  calendarWrapper: {
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as any,
    borderRadius: 'var(--border-radius-md)',
    border: '1px solid var(--border-color)',
    backgroundColor: '#fff',
  },
  calendar: {
    display: 'grid',
    gridTemplateColumns: '56px repeat(6, 1fr)',
    minWidth: '700px',
  },
  headerVacio: {
    padding: '0.5rem',
    borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-secondary)',
  },
  headerDia: {
    padding: '0.6rem 0.35rem',
    textAlign: 'center' as const,
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.15rem',
  },
  headerDiaNombre: {
    fontSize: '0.72rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  headerDiaNum: {
    fontSize: '1.1rem',
    fontWeight: '700',
  },
  horaLabel: {
    padding: '0.2rem 0.4rem',
    fontSize: '0.7rem',
    fontWeight: '500',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border-color)',
    borderBottom: '1px solid rgba(226,232,240,0.4)',
    textAlign: 'right' as const,
    height: '36px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  celda: {
    borderRight: '1px solid var(--border-color)',
    height: '36px',
    transition: 'background-color 0.1s',
  },
  celdaConFranja: {
    position: 'relative' as const,
    borderRight: '1px solid var(--border-color)',
    borderLeft: '3px solid var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.06)',
    borderRadius: '4px',
    margin: '1px 2px',
    padding: '0.2rem 0.35rem',
    paddingRight: '1.1rem',
    overflow: 'hidden' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1px',
    transition: 'box-shadow 0.15s',
  },
  franjaDeleteBtn: {
    position: 'absolute' as const,
    top: '2px',
    right: '2px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    color: '#ef4444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
    zIndex: 1,
  },
  movilDeleteBtn: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    color: '#ef4444',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  franjaTitle: {
    fontSize: '0.72rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  franjaHora: {
    fontSize: '0.65rem',
    color: 'var(--text-muted)',
  },
  franjaAsesor: {
    fontSize: '0.62rem',
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
  franjaCitasBadge: {
    fontSize: '0.6rem',
    fontWeight: '700',
    color: '#fff',
    backgroundColor: 'var(--primary)',
    borderRadius: '8px',
    padding: '0 0.35rem',
    alignSelf: 'flex-start' as const,
    marginTop: '1px',
  },

  // ---- Calendario Móvil ----
  movilCard: {
    padding: '0.85rem 1rem',
    marginBottom: '0.5rem',
    borderRadius: 'var(--border-radius-md)',
  },
  movilCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.3rem',
  },
  movilCardHora: {
    fontSize: '0.82rem',
    fontWeight: '700',
    color: 'var(--primary)',
  },
  movilCardTitle: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  movilCardDireccion: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    marginTop: '0.15rem',
  },
  movilCita: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(0, 171, 216, 0.07)',
    borderRadius: '6px',
    padding: '0.25rem 0.5rem',
    marginTop: '0.35rem',
  },
};
