'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck, Phone, Building2, User as UserIcon, Bot, Eye, Loader2, CalendarX, Plus, CheckCheck, CheckSquare, Square, Send } from 'lucide-react';
import { cancelarCitaAdmin, confirmarCitas } from '@/app/actions/agenda';
import ModalNuevaCita from './ModalNuevaCita';
import SolicitudesApertura from './SolicitudesApertura';

interface Cita {
  id: string;
  franja_id: string;
  inmueble_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_email: string | null;
  origen: string;
  confirmada_at?: string | null; // última vez enviada al flujo n8n de confirmación (→ Kommo)
  alcance?: string; // 'inmueble' | 'unidad'
  unidad?: string | null; // nombre de la unidad cuando alcance='unidad'
  aptos_snapshot?: { titulo: string }[] | null; // aptos disponibles al agendar (solo unidad)
  inmuebles: { titulo: string; direccion: string; unidad?: string | null } | null;
  franjas_horarias: { asesor_id: string; usuarios: { id: string; nombre_completo: string } | null } | null;
}

interface Asesor {
  id: string;
  nombre_completo: string;
}

interface FranjaDisponible {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  inmuebles: { titulo: string; direccion: string; unidad?: string | null } | null;
  usuarios: { nombre_completo: string } | null;
}

interface CitasViewProps {
  citas: Cita[];
  asesores: Asesor[];
  franjasDisponibles: FranjaDisponible[];
  solicitudes?: any[]; // solicitudes de apertura pendientes (solo admin)
  isAdmin: boolean;
  hoy: string; // 'YYYY-MM-DD' en la zona horaria de Colombia
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Suma días a una fecha 'YYYY-MM-DD' sin desfase de zona horaria (todo en UTC).
function sumarDias(fechaStr: string, n: number): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().split('T')[0];
}

// Etiqueta legible de un día: "Hoy", "Mañana" o "jueves 18 de junio".
function etiquetaDia(fechaStr: string, hoy: string): { rel: string | null; resto: string } {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const base = `${DIAS[dt.getUTCDay()]} ${d} de ${MESES[m - 1]}`;
  if (fechaStr === hoy) return { rel: 'Hoy', resto: base };
  if (fechaStr === sumarDias(hoy, 1)) return { rel: 'Mañana', resto: base };
  return { rel: null, resto: base.charAt(0).toUpperCase() + base.slice(1) };
}

// Texto de ubicación de una cita. Si es a nivel unidad → "Mi Mundo · 3 aptos";
// si es a un apto puntual → unidad · dirección (o dirección/título como fallback).
function textoUbicacion(c: Cita): string {
  if (c.alcance === 'unidad') {
    const n = c.aptos_snapshot?.length ?? 0;
    const uni = (c.unidad || c.inmuebles?.unidad || 'Unidad').trim();
    return `${uni} · ${n} apto${n !== 1 ? 's' : ''}`;
  }
  if (!c.inmuebles) return '';
  const uni = c.inmuebles.unidad?.trim();
  return uni
    ? `${uni}${c.inmuebles.direccion ? ` · ${c.inmuebles.direccion}` : ''}`
    : (c.inmuebles.direccion || c.inmuebles.titulo);
}

export default function CitasView({ citas, asesores, franjasDisponibles, solicitudes = [], isAdmin, hoy }: CitasViewProps) {
  const router = useRouter();
  const [filtroAsesor, setFiltroAsesor] = useState<string>('todos');
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Modo "Confirmar citas": selección múltiple para disparar el flujo n8n
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);

  // Filtro por asesor (solo admin)
  const citasFiltradas = useMemo(() => {
    if (!isAdmin || filtroAsesor === 'todos') return citas;
    return citas.filter(c => c.franjas_horarias?.asesor_id === filtroAsesor);
  }, [citas, isAdmin, filtroAsesor]);

  // Agrupadas por fecha (ya vienen ordenadas por fecha y hora desde el servidor)
  const grupos = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of citasFiltradas) {
      if (!map.has(c.fecha)) map.set(c.fecha, []);
      map.get(c.fecha)!.push(c);
    }
    return Array.from(map.entries());
  }, [citasFiltradas]);

  const cancelar = async (cita: Cita) => {
    if (!confirm(`¿Cancelar la cita de ${cita.cliente_nombre} (${cita.hora_inicio.substring(0, 5)})?`)) return;
    setCancelandoId(cita.id);
    const result = await cancelarCitaAdmin(cita.id);
    setCancelandoId(null);
    if (!result.success) {
      alert(result.error || 'No se pudo cancelar la cita.');
      return;
    }
    router.refresh();
  };

  const salirSeleccion = () => {
    setSeleccionando(false);
    setSeleccionadas(new Set());
  };

  const toggleCita = (id: string) => {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmar = async () => {
    const ids = Array.from(seleccionadas);
    if (ids.length === 0) return;
    if (!confirm(`¿Enviar ${ids.length} cita(s) al flujo de confirmación de n8n?`)) return;
    setConfirmando(true);
    const result = await confirmarCitas(ids);
    setConfirmando(false);
    if (result.success) {
      alert(`${result.count} cita(s) enviada(s) al flujo de confirmación.`);
      salirSeleccion();
      router.refresh();
    } else {
      alert(result.error || 'No se pudieron enviar las citas.');
    }
  };

  const totalCitas = citasFiltradas.length;

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="responsive-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={styles.pageTitle}>
            <CalendarCheck size={28} color="var(--primary)" />
            Citas
          </h1>
          <p style={styles.pageSubtitle}>
            {isAdmin
              ? 'Visitas agendadas de todos los asesores, de hoy en adelante'
              : 'Tus visitas agendadas, de hoy en adelante'}
          </p>
        </div>
        <div className="responsive-header-buttons">
          {isAdmin && seleccionando && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
              Marca las citas que quieres confirmar
            </span>
          )}
          {isAdmin && !seleccionando && (
            <>
              {totalCitas > 0 && (
                <button className="btn btn-secondary" onClick={() => setSeleccionando(true)}>
                  <CheckCheck size={18} />
                  Confirmar citas
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
                <Plus size={18} />
                Nueva cita
              </button>
            </>
          )}
          {!isAdmin && (
            <span className="badge badge-info" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
              <Eye size={14} style={{ marginRight: 4 }} />
              Solo lectura
            </span>
          )}
        </div>
      </div>

      {/* Solicitudes de apertura pendientes (solo admin) */}
      {isAdmin && (
        <SolicitudesApertura solicitudes={solicitudes} asesores={asesores} hoy={hoy} />
      )}

      {/* Filtro por asesor (solo admin) */}
      {isAdmin && asesores.length > 0 && (
        <div style={styles.controlsBar} className="glass-card">
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
          <span style={styles.contador}>
            {totalCitas} cita{totalCitas !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Lista de citas agrupada por día */}
      {totalCitas === 0 ? (
        <div className="glass-card" style={styles.emptyState}>
          <CalendarX size={42} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ fontWeight: '600', color: 'var(--text-secondary)', margin: 0 }}>
            {isAdmin ? 'No hay citas próximas' : 'No tienes citas próximas'}
          </p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Las visitas que se agenden aparecerán aquí.
          </p>
        </div>
      ) : (
        grupos.map(([fecha, citasDia]) => {
          const { rel, resto } = etiquetaDia(fecha, hoy);
          return (
            <div key={fecha} style={{ marginBottom: '1.5rem' }}>
              <div style={styles.diaHeader}>
                {rel && <span style={styles.diaRel}>{rel}</span>}
                <span style={styles.diaResto}>{resto}</span>
                <span style={styles.diaCount}>{citasDia.length}</span>
              </div>

              {citasDia.map(c => {
                const asesorNombre = c.franjas_horarias?.usuarios?.nombre_completo;
                const estaSeleccionada = seleccionadas.has(c.id);
                return (
                  <div
                    key={c.id}
                    className="glass-card"
                    style={{
                      ...styles.citaCard,
                      ...(seleccionando ? { cursor: 'pointer' } : {}),
                      ...(seleccionando && estaSeleccionada ? styles.citaCardSel : {}),
                    }}
                    onClick={seleccionando ? () => toggleCita(c.id) : undefined}
                  >
                    {seleccionando && (
                      <div style={styles.checkboxWrap}>
                        {estaSeleccionada
                          ? <CheckSquare size={20} color="var(--primary)" />
                          : <Square size={20} color="var(--text-muted)" />}
                      </div>
                    )}
                    {/* Hora */}
                    <div style={styles.horaBlock}>
                      <span style={styles.horaInicio}>{c.hora_inicio.substring(0, 5)}</span>
                      <span style={styles.horaFin}>{c.hora_fin.substring(0, 5)}</span>
                    </div>

                    {/* Cliente + inmueble */}
                    <div style={styles.centro}>
                      <div style={styles.cliente}>{c.cliente_nombre}</div>
                      <div style={styles.detalleLinea}>
                        <Phone size={13} style={{ flexShrink: 0 }} />
                        <span>{c.cliente_telefono}</span>
                      </div>
                      {(c.alcance === 'unidad' || c.inmuebles) && (
                        <div style={styles.detalleLinea}>
                          <Building2 size={13} style={{ flexShrink: 0 }} />
                          <span style={styles.inmuebleTxt}>{textoUbicacion(c)}</span>
                          {c.alcance === 'unidad' && (
                            <span style={styles.unidadBadge}>Unidad</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Badges + acción */}
                    <div style={styles.derecha}>
                      {c.confirmada_at && (
                        <span
                          style={styles.confirmadaBadge}
                          title={`Enviada a Kommo el ${new Date(c.confirmada_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                        >
                          <CheckCheck size={12} style={{ marginRight: 3, verticalAlign: '-2px' }} />
                          Confirmada
                        </span>
                      )}
                      {isAdmin && asesorNombre && (
                        <span style={styles.asesorBadge}>
                          <UserIcon size={12} style={{ marginRight: 3, verticalAlign: '-1px' }} />
                          {asesorNombre.split(' ')[0]}
                        </span>
                      )}
                      {c.origen === 'n8n' ? (
                        <span className="badge badge-info" style={styles.origenBadge}>
                          <Bot size={12} style={{ marginRight: 3, verticalAlign: '-1px' }} />
                          Agente
                        </span>
                      ) : (
                        <span style={styles.manualBadge}>Manual</span>
                      )}
                      {isAdmin && !seleccionando && (
                        <button
                          type="button"
                          onClick={() => cancelar(c)}
                          disabled={cancelandoId === c.id}
                          className="btn btn-danger"
                          style={styles.cancelarBtn}
                        >
                          {cancelandoId === c.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : 'Cancelar'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {/* Barra inferior del modo selección */}
      {seleccionando && (
        <>
          <div style={{ height: '76px' }} />
          <div style={styles.barraConfirmar}>
            <span style={styles.barraTexto}>
              {seleccionadas.size} cita{seleccionadas.size !== 1 ? 's' : ''} seleccionada{seleccionadas.size !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={salirSeleccion} disabled={confirmando}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmar}
                disabled={confirmando || seleccionadas.size === 0}
              >
                {confirmando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Confirmar{seleccionadas.size > 0 ? ` ${seleccionadas.size}` : ''}
              </button>
            </div>
          </div>
        </>
      )}

      {isAdmin && (
        <ModalNuevaCita
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); router.refresh(); }}
          franjas={franjasDisponibles}
        />
      )}
    </div>
  );
}

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
    marginBottom: '1.25rem',
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
  contador: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
  },
  emptyState: {
    padding: '2.5rem 2rem',
    textAlign: 'center' as const,
  },
  diaHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.65rem',
    paddingLeft: '0.15rem',
  },
  diaRel: {
    fontSize: '0.82rem',
    fontWeight: '700',
    color: 'var(--primary)',
  },
  diaResto: {
    fontSize: '0.82rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  diaCount: {
    fontSize: '0.72rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '0.05rem 0.5rem',
  },
  citaCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0.85rem 1rem',
    marginBottom: '0.6rem',
    borderRadius: 'var(--border-radius-md)',
  },
  citaCardSel: {
    border: '1px solid var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
  },
  checkboxWrap: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  barraConfirmar: {
    position: 'fixed' as const,
    left: '50%',
    bottom: '1.25rem',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1.5rem',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    boxShadow: '0 8px 28px rgba(15, 23, 42, 0.18)',
    padding: '0.65rem 1rem 0.65rem 1.25rem',
    zIndex: 200,
    width: 'min(520px, calc(100% - 2rem))',
  },
  barraTexto: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  horaBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: '48px',
    flexShrink: 0,
  },
  horaInicio: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--primary)',
    lineHeight: 1.1,
  },
  horaFin: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  centro: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.15rem',
  },
  cliente: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  detalleLinea: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
  },
  inmuebleTxt: {
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  derecha: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: '0.35rem',
    flexShrink: 0,
  },
  asesorBadge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  origenBadge: {
    fontSize: '0.7rem',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  manualBadge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  unidadBadge: {
    fontSize: '0.62rem',
    fontWeight: '700',
    color: 'var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '8px',
    padding: '0.02rem 0.4rem',
    flexShrink: 0,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },
  confirmadaBadge: {
    fontSize: '0.7rem',
    fontWeight: '700',
    color: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  cancelarBtn: {
    padding: '0.25rem 0.6rem',
    fontSize: '0.72rem',
    minWidth: '70px',
    justifyContent: 'center',
  },
};
