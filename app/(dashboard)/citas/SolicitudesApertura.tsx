'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Phone, Building2, Loader2, Check, X, AlertTriangle, Clock } from 'lucide-react';
import { aprobarSolicitud, denegarSolicitud, descartarSolicitud } from '@/app/actions/solicitudes';

interface Solicitud {
  id: string;
  inmueble_id: string;
  alcance: string; // 'inmueble' | 'unidad'
  unidad: string | null;
  tipo_transaccion: string | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cliente_nombre: string;
  cliente_telefono: string;
  notas: string | null;
  created_at: string;
  inmuebles: {
    titulo: string;
    direccion: string;
    unidad?: string | null;
    asesor_id?: string | null;
    asesor_id_override?: string | null;
  } | null;
}

interface Asesor {
  id: string;
  nombre_completo: string;
}

interface SolicitudesAperturaProps {
  solicitudes: Solicitud[];
  asesores: Asesor[];
  hoy: string; // 'YYYY-MM-DD' en la zona horaria de Colombia
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(fechaStr: string): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

function ubicacionSolicitud(s: Solicitud): string {
  if (s.alcance === 'unidad') return (s.unidad || s.inmuebles?.unidad || 'Unidad').trim();
  if (!s.inmuebles) return '';
  const uni = s.inmuebles.unidad?.trim();
  return uni
    ? `${uni}${s.inmuebles.direccion ? ` · ${s.inmuebles.direccion}` : ''}`
    : (s.inmuebles.direccion || s.inmuebles.titulo);
}

export default function SolicitudesApertura({ solicitudes, asesores, hoy }: SolicitudesAperturaProps) {
  const router = useRouter();
  // Panel expandido por solicitud: 'aprobar' (selector de asesor) o 'denegar' (motivo)
  const [expandida, setExpandida] = useState<{ id: string; modo: 'aprobar' | 'denegar' } | null>(null);
  const [asesorSel, setAsesorSel] = useState<string>('');
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);
  // Horario en el que el asesor SÍ puede atender: arranca en el que pidió el
  // cliente y se puede ajustar. Ajustarlo en vez de denegar es lo que convierte
  // un "no puedo a esa hora" en una contraoferta que el cliente recibe.
  const [fechaSel, setFechaSel] = useState('');
  const [horaSel, setHoraSel] = useState('');

  if (solicitudes.length === 0) return null;

  const abrirAprobar = (s: Solicitud) => {
    // Preseleccionar el asesor asignado del inmueble (respetando el override local)
    const defaultAsesor = s.inmuebles?.asesor_id_override || s.inmuebles?.asesor_id || '';
    setAsesorSel(asesores.some(a => a.id === defaultAsesor) ? defaultAsesor : (asesores[0]?.id || ''));
    setFechaSel(s.fecha);
    setHoraSel(s.hora_inicio.substring(0, 5));
    setMotivo('');
    setExpandida({ id: s.id, modo: 'aprobar' });
  };

  const abrirDenegar = (s: Solicitud) => {
    setMotivo('');
    setExpandida({ id: s.id, modo: 'denegar' });
  };

  const cerrar = () => {
    if (procesando) return;
    setExpandida(null);
  };

  const aprobar = async (s: Solicitud) => {
    if (!asesorSel) { alert('Selecciona el asesor que atenderá la visita.'); return; }
    if (!fechaSel || !horaSel) { alert('Indica la fecha y la hora de la visita.'); return; }
    // La franja es de 30 min: la hora de fin se deriva de la de inicio.
    const [h, m] = horaSel.split(':').map(Number);
    const fin = new Date(Date.UTC(2000, 0, 1, h, m + 30));
    const horaFin = `${String(fin.getUTCHours()).padStart(2, '0')}:${String(fin.getUTCMinutes()).padStart(2, '0')}`;
    setProcesando(true);
    const result = await aprobarSolicitud({
      solicitud_id: s.id,
      asesor_id: asesorSel,
      fecha: fechaSel,
      hora_inicio: horaSel,
      hora_fin: horaFin,
    });
    setProcesando(false);
    if (!result.success) {
      alert(result.error || 'No se pudo aprobar la solicitud.');
      return;
    }
    alert(result.message);
    setExpandida(null);
    router.refresh();
  };

  const denegar = async (s: Solicitud) => {
    setProcesando(true);
    const result = await denegarSolicitud({ solicitud_id: s.id, motivo });
    setProcesando(false);
    if (!result.success) {
      alert(result.error || 'No se pudo denegar la solicitud.');
      return;
    }
    alert(result.message);
    setExpandida(null);
    router.refresh();
  };

  // Descartar: borra la solicitud sin responderle al cliente (para spam/irrelevantes).
  const descartar = async (s: Solicitud) => {
    if (!window.confirm(`¿Descartar la solicitud de ${s.cliente_nombre}? Se elimina sin enviarle respuesta al cliente.`)) return;
    setProcesando(true);
    const result = await descartarSolicitud({ solicitud_id: s.id });
    setProcesando(false);
    if (!result.success) {
      alert(result.error || 'No se pudo descartar la solicitud.');
      return;
    }
    router.refresh();
  };

  return (
    <div className="glass-card" style={styles.seccion}>
      <div style={styles.header}>
        <CalendarPlus size={18} color="var(--warning, #f59e0b)" />
        <span style={styles.titulo}>Solicitudes de apertura</span>
        <span style={styles.contador}>{solicitudes.length}</span>
        <span style={styles.subtitulo}>
          El agente capturó estos horarios pedidos por clientes que la agenda no cubre
        </span>
      </div>

      {solicitudes.map(s => {
        const vencida = s.fecha < hoy;
        const estaExpandida = expandida?.id === s.id;
        return (
          <div key={s.id} style={styles.card}>
            <button
              type="button"
              style={styles.descartarBtn}
              onClick={() => descartar(s)}
              disabled={procesando}
              title="Descartar sin responder al cliente"
              aria-label="Descartar solicitud"
            >
              <X size={15} />
            </button>
            <div style={styles.fila}>
              {/* Slot deseado */}
              <div style={styles.slotBlock}>
                <span style={styles.slotFecha}>{fechaCorta(s.fecha)}</span>
                <span style={styles.slotHora}>
                  {s.hora_inicio.substring(0, 5)}–{s.hora_fin.substring(0, 5)}
                </span>
              </div>

              {/* Cliente + ubicación */}
              <div style={styles.centro}>
                <div style={styles.cliente}>{s.cliente_nombre}</div>
                <div style={styles.detalleLinea}>
                  <Phone size={13} style={{ flexShrink: 0 }} />
                  <span>{s.cliente_telefono}</span>
                </div>
                <div style={styles.detalleLinea}>
                  <Building2 size={13} style={{ flexShrink: 0 }} />
                  <span style={styles.ubicacionTxt}>{ubicacionSolicitud(s)}</span>
                  {s.alcance === 'unidad' && <span style={styles.unidadBadge}>Unidad</span>}
                  {s.tipo_transaccion && <span style={styles.tipoBadge}>{s.tipo_transaccion}</span>}
                  {vencida && (
                    <span style={styles.vencidaBadge}>
                      <AlertTriangle size={11} style={{ marginRight: 3, verticalAlign: '-1.5px' }} />
                      Vencida
                    </span>
                  )}
                </div>
                {s.notas && <div style={styles.notas}>“{s.notas}”</div>}
              </div>

              {/* Acciones */}
              {!estaExpandida && (
                <div style={styles.acciones}>
                  <button
                    className="btn btn-primary"
                    style={styles.accionBtn}
                    onClick={() => abrirAprobar(s)}
                    disabled={procesando}
                    title={
                      vencida
                        ? 'El horario que pidió ya pasó, pero podés ofrecerle otro: elegí fecha y hora'
                        : 'Crear la franja y agendar la cita'
                    }
                  >
                    <Check size={14} />
                    {vencida ? 'Ofrecer otro horario' : 'Aprobar'}
                  </button>
                  {/* Botón propio para la contraoferta: con solo "Aprobar" y "Denegar",
                      el asesor que no puede a esa hora le da a Denegar y escribe la
                      alternativa en el motivo, donde no crea agenda ni cierra nada
                      (pasó en 23 de 36 solicitudes, y volvió a pasar en la prueba
                      del 10/ago aun teniendo los campos de hora disponibles). */}
                  {!vencida && (
                    <button
                      className="btn btn-secondary"
                      style={styles.accionBtn}
                      onClick={() => abrirAprobar(s)}
                      disabled={procesando}
                      title="No podés a esa hora pero sí a otra: elegí la tuya y el cliente la recibe por WhatsApp"
                    >
                      <Clock size={14} />
                      Proponer otra hora
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    style={styles.accionBtn}
                    onClick={() => abrirDenegar(s)}
                    disabled={procesando}
                    title="Solo si la visita no es posible en ninguna hora"
                  >
                    <X size={14} />
                    Denegar
                  </button>
                </div>
              )}
            </div>

            {/* Panel de confirmación */}
            {estaExpandida && expandida.modo === 'aprobar' && (
              <div style={styles.panel}>
                <label style={styles.panelLabel}>
                  Horario en el que vas a atender la visita. Si no podés a la hora que pidió, ofrecele otra
                  aquí en vez de denegar — el cliente la recibe por WhatsApp y puede responder si no le sirve.
                </label>
                <div style={styles.panelFila}>
                  <input
                    className="form-input"
                    style={styles.inputFecha}
                    type="date"
                    min={hoy}
                    value={fechaSel}
                    onChange={e => setFechaSel(e.target.value)}
                    disabled={procesando}
                  />
                  <input
                    className="form-input"
                    style={styles.inputHora}
                    type="time"
                    step={1800}
                    value={horaSel}
                    onChange={e => setHoraSel(e.target.value)}
                    disabled={procesando}
                  />
                  <select
                    className="form-input"
                    style={styles.select}
                    value={asesorSel}
                    onChange={e => setAsesorSel(e.target.value)}
                    disabled={procesando}
                  >
                    <option value="">— Selecciona asesor —</option>
                    {asesores.map(a => (
                      <option key={a.id} value={a.id}>{a.nombre_completo}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" style={styles.accionBtn} onClick={() => aprobar(s)} disabled={procesando}>
                    {procesando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Confirmar
                  </button>
                  <button className="btn btn-secondary" style={styles.accionBtn} onClick={cerrar} disabled={procesando}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {estaExpandida && expandida.modo === 'denegar' && (
              <div style={styles.panel}>
                <label style={styles.panelLabel}>
                  Motivo (obligatorio, se le envía al cliente). Si el problema es solo la hora, cerrá esto y
                  usá “{vencida ? 'Ofrecer otro horario' : 'Aprobar'}” con el horario que sí puedas: denegar hace desistir al cliente.
                </label>
                <div style={styles.panelFila}>
                  <input
                    className="form-input"
                    style={styles.select}
                    type="text"
                    placeholder="Ej. Ese inmueble ya se arrendó, pero tenemos otros similares en la zona"
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    disabled={procesando}
                  />
                  <button className="btn btn-danger" style={styles.accionBtn} onClick={() => denegar(s)} disabled={procesando}>
                    {procesando ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    Denegar
                  </button>
                  <button className="btn btn-secondary" style={styles.accionBtn} onClick={cerrar} disabled={procesando}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  seccion: {
    padding: '1rem',
    marginBottom: '1.25rem',
    border: '1px solid rgba(245, 158, 11, 0.35)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.85rem',
    flexWrap: 'wrap' as const,
  },
  titulo: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  contador: {
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: '10px',
    padding: '0.05rem 0.5rem',
  },
  subtitulo: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  card: {
    position: 'relative' as const,
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    padding: '0.75rem 0.9rem',
    marginBottom: '0.55rem',
    backgroundColor: 'var(--bg-secondary)',
  },
  descartarBtn: {
    position: 'absolute' as const,
    top: '0.4rem',
    right: '0.4rem',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    zIndex: 2,
    lineHeight: 1,
  },
  fila: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  slotBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: '76px',
    flexShrink: 0,
  },
  slotFecha: {
    fontSize: '0.78rem',
    fontWeight: '700',
    color: '#f59e0b',
    lineHeight: 1.2,
    whiteSpace: 'nowrap' as const,
  },
  slotHora: {
    fontSize: '0.82rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  centro: {
    flex: 1,
    minWidth: '200px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.15rem',
  },
  cliente: {
    fontSize: '0.92rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  detalleLinea: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    flexWrap: 'wrap' as const,
  },
  ubicacionTxt: {
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
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
  tipoBadge: {
    fontSize: '0.62rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '0.02rem 0.4rem',
    flexShrink: 0,
    textTransform: 'capitalize' as const,
  },
  vencidaBadge: {
    fontSize: '0.62rem',
    fontWeight: '700',
    color: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '8px',
    padding: '0.02rem 0.4rem',
    flexShrink: 0,
  },
  notas: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic' as const,
    marginTop: '0.1rem',
  },
  acciones: {
    display: 'flex',
    gap: '0.4rem',
    flexShrink: 0,
  },
  accionBtn: {
    padding: '0.35rem 0.7rem',
    fontSize: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    whiteSpace: 'nowrap' as const,
  },
  panel: {
    marginTop: '0.65rem',
    paddingTop: '0.65rem',
    borderTop: '1px dashed var(--border-color)',
  },
  panelLabel: {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '0.4rem',
  },
  panelFila: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  select: {
    flex: 1,
    minWidth: '220px',
    fontSize: '0.82rem',
    padding: '0.4rem 0.6rem',
  },
  inputFecha: {
    width: '150px',
    fontSize: '0.82rem',
    padding: '0.4rem 0.6rem',
  },
  inputHora: {
    width: '110px',
    fontSize: '0.82rem',
    padding: '0.4rem 0.6rem',
  },
};
