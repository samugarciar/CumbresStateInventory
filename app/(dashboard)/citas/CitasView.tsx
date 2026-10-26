'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck, Phone, Building2, User as UserIcon, Loader2, CalendarX, Plus, CheckCheck, CheckSquare, Square, Send, AlertTriangle, Clock } from 'lucide-react';
import { cancelarCitaAdmin, confirmarCitas, marcarCitaRealizada } from '@/app/actions/agenda';
import ModalNuevaCita from './ModalNuevaCita';
import SolicitudesApertura, { type Solicitud } from './SolicitudesApertura';
import { telefonoLegible } from './telefono';

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
  confirmada_at?: string | null; // cuándo salió la última confirmación por WhatsApp
  confirmacion_error?: string | null; // por qué falló el último intento
  confirmacion_fallida_at?: string | null;
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
  solicitudes?: Solicitud[]; // solicitudes de apertura pendientes (solo admin)
  isAdmin: boolean;
  hoy: string; // 'YYYY-MM-DD' en la zona horaria de Colombia
  ahora: string; // 'YYYY-MM-DDTHH:MM' en la zona horaria de Colombia (al cargar)
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

// «hoy lunes 26», «ayer domingo 25» o «el sábado 24 de octubre», para preguntar
// por una visita sin que haya duda de cuál es.
function cuandoFue(fechaStr: string, hoy: string): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (fechaStr === hoy) return `de hoy ${dia} ${d}`;
  if (fechaStr === sumarDias(hoy, -1)) return `de ayer ${dia} ${d}`;
  return `del ${dia} ${d} de ${MESES[m - 1]}`;
}

// Fecha corta para las visitas de «Sin marcar», que mezclan varios días.
function fechaCorta(fechaStr: string): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3);
  return `${dia} ${d} ${MESES[m - 1].slice(0, 3)}`;
}

// Hora actual de Colombia como 'YYYY-MM-DDTHH:MM' (se compara como texto).
function ahoraColombia(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(x => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
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

export default function CitasView({ citas, asesores, franjasDisponibles, solicitudes = [], isAdmin, hoy, ahora: ahoraInicial }: CitasViewProps) {
  const router = useRouter();
  const [filtroAsesor, setFiltroAsesor] = useState<string>('todos');
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [realizandoId, setRealizandoId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Modo "Confirmar citas": selección múltiple para mandar la confirmación por WhatsApp
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  // Hora de Colombia; arranca con la del servidor y se pone al día cada minuto,
  // para que «Marcar realizada» aparezca cuando empieza la visita.
  const [ahora, setAhora] = useState(ahoraInicial);
  useEffect(() => {
    const id = setInterval(() => setAhora(ahoraColombia()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filtro por asesor (solo admin)
  const citasFiltradas = useMemo(() => {
    if (!isAdmin || filtroAsesor === 'todos') return citas;
    return citas.filter(c => c.franjas_horarias?.asesor_id === filtroAsesor);
  }, [citas, isAdmin, filtroAsesor]);

  // Visitas de días anteriores que siguen 'agendada' (solo le llegan al asesor):
  // van arriba, en «Sin marcar», para que no se pierdan.
  const sinMarcar = useMemo(() => citasFiltradas.filter(c => c.fecha < hoy), [citasFiltradas, hoy]);
  const proximas = useMemo(() => citasFiltradas.filter(c => c.fecha >= hoy), [citasFiltradas, hoy]);

  // Agrupadas por fecha (ya vienen ordenadas por fecha y hora desde el servidor)
  const grupos = useMemo(() => {
    const map = new Map<string, Cita[]>();
    for (const c of proximas) {
      if (!map.has(c.fecha)) map.set(c.fecha, []);
      map.get(c.fecha)!.push(c);
    }
    return Array.from(map.entries());
  }, [proximas]);

  const yaEmpezo = (c: Cita) => `${c.fecha}T${c.hora_inicio.substring(0, 5)}` <= ahora;

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

  // Solo asesores: marca una de sus visitas como realizada (sale de la lista).
  const marcarRealizada = async (cita: Cita) => {
    const hora = cita.hora_inicio.substring(0, 5);
    if (!confirm(`¿La visita ${cuandoFue(cita.fecha, hoy)} a las ${hora} con ${cita.cliente_nombre} ya se hizo?`)) return;
    setRealizandoId(cita.id);
    const result = await marcarCitaRealizada(cita.id);
    setRealizandoId(null);
    if (!result.success) {
      alert(result.error || 'No se pudo marcar la cita como realizada.');
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
    if (!confirm(`¿Mandar la confirmación por WhatsApp a ${ids.length} cliente(s)?`)) return;
    setConfirmando(true);
    const result = await confirmarCitas(ids);
    setConfirmando(false);
    if (result.success) {
      // Antes decía "N enviadas" y todas quedaban en verde, salieran o no.
      // Ahora se dice cuáles NO salieron, que son las que hay que confirmar a mano.
      const partes = [`${result.confirmadas ?? 0} de ${result.count} cita(s) confirmada(s) por WhatsApp.`];
      if (result.fallidas?.length) {
        partes.push(
          `\nNo se pudieron confirmar ${result.fallidas.length} — confírmalas a mano:\n` +
            result.fallidas.map((f) => `• ${f.cliente}: ${f.motivo}`).join('\n')
        );
      }
      if (result.sinRespuesta?.length) {
        partes.push(
          `\nNo se supo si le llegó a ${result.sinRespuesta.length} (falló la conexión): ` +
            result.sinRespuesta.map((s) => s.cliente).join(', ') +
            '. Revisa su chat en el CRM antes de volver a intentarlo.'
        );
      }
      alert(partes.join('\n'));
      salirSeleccion();
      router.refresh();
    } else {
      alert(result.error || 'No se pudieron enviar las citas.');
    }
  };

  const totalCitas = proximas.length;

  // Una tarjeta de cita. En «Sin marcar» lleva además la fecha, porque mezcla días.
  const tarjeta = (c: Cita, { conFecha = false }: { conFecha?: boolean } = {}) => {
    const asesorNombre = c.franjas_horarias?.usuarios?.nombre_completo;
    const estaSeleccionada = seleccionadas.has(c.id);
    // El último intento falló y no hubo una confirmación después.
    // En una visita de un día anterior («Sin marcar») ya no hay nada que confirmar:
    // el aviso «Confírmala a mano» solo confundiría.
    const noConfirmada = c.fecha >= hoy && Boolean(
      c.confirmacion_fallida_at &&
        (!c.confirmada_at || c.confirmacion_fallida_at > c.confirmada_at)
    );
    const tel = telefonoLegible(c.cliente_telefono);
    const ubicacion = (c.alcance === 'unidad' || c.inmuebles) ? textoUbicacion(c) : '';
    const hayInsignias = noConfirmada || Boolean(c.confirmada_at) || (isAdmin && Boolean(asesorNombre));
    return (
      <div
        key={c.id}
        className="glass-card cita-card"
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
          {conFecha && <span style={styles.fechaMini}>{fechaCorta(c.fecha)}</span>}
          <span style={styles.horaInicio}>{c.hora_inicio.substring(0, 5)}</span>
          <span style={styles.horaFin}>{c.hora_fin.substring(0, 5)}</span>
        </div>

        {/* Cliente, teléfono, inmueble y avisos */}
        <div style={styles.centro}>
          <div style={styles.cliente}>{c.cliente_nombre}</div>
          {tel.href ? (
            <a
              href={tel.href}
              className="cita-tel"
              style={styles.telefono}
              onClick={e => e.stopPropagation()}
              aria-label={`Llamar a ${c.cliente_nombre}: ${tel.texto}`}
            >
              <Phone size={13} style={{ flexShrink: 0 }} />
              {tel.texto}
            </a>
          ) : tel.texto ? (
            <div style={styles.detalleLinea}>
              <Phone size={13} style={{ flexShrink: 0 }} />
              <span>{tel.texto}</span>
            </div>
          ) : null}
          {ubicacion && (
            <div style={styles.detalleLinea}>
              <Building2 size={13} style={{ flexShrink: 0 }} />
              <span className="cita-card-ubicacion">{ubicacion}</span>
              {c.alcance === 'unidad' && (
                <span style={styles.unidadBadge}>Unidad</span>
              )}
            </div>
          )}
          {noConfirmada && (
            <div style={styles.motivoNoConfirmada}>
              No se pudo confirmar: {c.confirmacion_error ?? 'motivo desconocido'}. Confírmala a mano.
            </div>
          )}
          {c.origen === 'n8n' && (
            <div style={styles.origenTxt}>Agendada por el bot</div>
          )}
        </div>

        {/* Insignias en una fila + acción */}
        <div className="cita-card-derecha">
          {hayInsignias && (
            <div style={styles.insignias}>
              {noConfirmada ? (
                <span style={styles.noConfirmadaBadge}>
                  <AlertTriangle size={12} style={{ marginRight: 3, verticalAlign: '-2px' }} />
                  No confirmada
                </span>
              ) : c.confirmada_at && (
                <span
                  style={styles.confirmadaBadge}
                  title={`Confirmación enviada por WhatsApp el ${new Date(c.confirmada_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
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
            </div>
          )}
          {isAdmin && !seleccionando && (
            <button
              type="button"
              onClick={() => cancelar(c)}
              disabled={cancelandoId === c.id}
              className="cita-btn-cancelar"
              style={styles.cancelarBtn}
            >
              {cancelandoId === c.id
                ? <Loader2 size={13} className="animate-spin" />
                : 'Cancelar'}
            </button>
          )}
          {!isAdmin && (yaEmpezo(c) ? (
            <button
              type="button"
              onClick={() => marcarRealizada(c)}
              disabled={realizandoId === c.id}
              className="btn btn-primary"
              style={styles.realizadaBtn}
            >
              {realizandoId === c.id
                ? <Loader2 size={13} className="animate-spin" />
                : <><CalendarCheck size={14} />Marcar realizada</>}
            </button>
          ) : (
            <span style={styles.despuesTxt}>
              <Clock size={13} />
              Después de la visita
            </span>
          ))}
        </div>
      </div>
    );
  };

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
              : 'Tus visitas agendadas, de hoy en adelante. Cuando termines una, márcala como realizada.'}
          </p>
        </div>
        {isAdmin && (
          <div className="responsive-header-buttons">
            {seleccionando ? (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                Marca las citas que quieres confirmar
              </span>
            ) : (
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
          </div>
        )}
      </div>

      {/* Solicitudes de apertura pendientes (solo admin) */}
      {isAdmin && (
        <SolicitudesApertura solicitudes={solicitudes} asesores={asesores} hoy={hoy} />
      )}

      {/* Filtro por asesor (solo admin) */}
      {isAdmin && asesores.length > 0 && (
        <div style={styles.controlsBar} className="glass-card">
          <div style={styles.filtroAsesor} role="group" aria-label="Filtrar por asesor">
            <button
              onClick={() => setFiltroAsesor('todos')}
              aria-pressed={filtroAsesor === 'todos'}
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
                aria-pressed={filtroAsesor === a.id}
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

      {/* Sin marcar: visitas de días anteriores que siguen pendientes (asesor) */}
      {sinMarcar.length > 0 && (
        <section style={{ marginBottom: '1.75rem' }} aria-label="Visitas sin marcar">
          <div style={styles.diaHeader}>
            <span style={styles.sinMarcarTitulo}>Sin marcar</span>
            <span style={styles.diaCount}>{sinMarcar.length}</span>
          </div>
          <p style={styles.sinMarcarAyuda}>
            Visitas de días anteriores que siguen pendientes. Si ya se hicieron, márcalas.
          </p>
          {sinMarcar.map(c => tarjeta(c, { conFecha: true }))}
        </section>
      )}

      {/* Lista de citas agrupada por día */}
      {totalCitas === 0 ? (
        <div className="glass-card" style={styles.emptyState}>
          <CalendarX size={42} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
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
            <section key={fecha} style={{ marginBottom: '1.5rem' }}>
              <div style={styles.diaHeader}>
                {rel && <span style={styles.diaRel}>{rel}</span>}
                <span style={styles.diaResto}>{resto}</span>
                <span style={styles.diaCount}>{citasDia.length}</span>
              </div>
              {citasDia.map(c => tarjeta(c))}
            </section>
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
    fontWeight: 800,
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
    fontSize: '0.8rem',
    fontWeight: 600,
    borderRadius: '20px',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  },
  contador: {
    fontSize: '0.8rem',
    fontWeight: 600,
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
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--primary)',
  },
  diaResto: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  diaCount: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '0.05rem 0.5rem',
  },
  sinMarcarTitulo: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--warning)',
  },
  sinMarcarAyuda: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    margin: '-0.35rem 0 0.65rem 0.15rem',
  },
  citaCard: {
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
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  horaBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: '48px',
    flexShrink: 0,
  },
  fechaMini: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--warning)',
    whiteSpace: 'nowrap' as const,
  },
  horaInicio: {
    fontSize: '0.95rem',
    fontWeight: 700,
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
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  telefono: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    alignSelf: 'flex-start',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: 'var(--primary)',
    padding: '0.1rem 0',
  },
  detalleLinea: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    minWidth: 0,
  },
  motivoNoConfirmada: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--danger)',
    marginTop: '0.1rem',
  },
  origenTxt: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  insignias: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.3rem',
    justifyContent: 'flex-end',
  },
  asesorBadge: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  unidadBadge: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: 'var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '8px',
    padding: '0.02rem 0.4rem',
    flexShrink: 0,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },
  confirmadaBadge: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--success)',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  noConfirmadaBadge: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--danger)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.35)',
    borderRadius: '12px',
    padding: '0.1rem 0.55rem',
    whiteSpace: 'nowrap' as const,
  },
  // Secundario: texto rojo, sin relleno.
  cancelarBtn: {
    background: 'none',
    border: '1px solid rgba(185, 28, 28, 0.28)',
    color: 'var(--danger)',
    borderRadius: '8px',
    padding: '0.35rem 0.8rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: '84px',
    minHeight: '32px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  realizadaBtn: {
    padding: '0.4rem 0.8rem',
    fontSize: '0.8rem',
    gap: '0.35rem',
    minHeight: '34px',
  },
  despuesTxt: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap' as const,
  },
};
