'use client';

import React, { useState } from 'react';
import { X, Loader2, Trash2, Building2, Clock, Users, PhoneCall } from 'lucide-react';
import { crearFranjaHoraria, actualizarFranjaHoraria, eliminarFranjaHoraria, cancelarCitaAdmin } from '@/app/actions/agenda';

interface Inmueble {
  id: string;
  titulo: string;
  direccion: string;
  unidad?: string | null;
}

interface Cita {
  id: string;
  hora_inicio: string;
  hora_fin: string;
  cliente_nombre: string;
  cliente_telefono: string;
  origen: string;
  inmuebles: { titulo: string; direccion?: string; unidad?: string | null } | null;
}

interface Asesor {
  id: string;
  nombre_completo: string;
}

interface ModalFranjaProps {
  isOpen: boolean;
  onClose: () => void;
  asesores: Asesor[];
  inmuebles: Inmueble[];
  citasFranja?: Cita[];
  // Datos prellenados (edición o nuevo)
  editData?: {
    id: string;
    inmueble_id: string;
    asesor_id: string;
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    color: string;
  } | null;
  defaultFecha?: string;
  defaultHora?: string;
  defaultAsesorId?: string;
}

const COLORES = [
  { valor: '#00abd8', nombre: 'Azul' },
  { valor: '#8b5cf6', nombre: 'Violeta' },
  { valor: '#10b981', nombre: 'Verde' },
  { valor: '#f59e0b', nombre: 'Ámbar' },
  { valor: '#ef4444', nombre: 'Rojo' },
  { valor: '#ec4899', nombre: 'Rosa' },
];

// Genera opciones de hora cada 30 min de 8:00 a 18:00
function generarOpcionesHora(): string[] {
  const opciones: string[] = [];
  for (let h = 8; h <= 17; h++) {
    opciones.push(`${String(h).padStart(2, '0')}:00`);
    opciones.push(`${String(h).padStart(2, '0')}:30`);
  }
  opciones.push('18:00');
  return opciones;
}

const HORAS = generarOpcionesHora();

// Misma regla que la BD: los inmuebles comparten ubicación si tienen la misma
// unidad, o la misma dirección exacta cuando no tienen unidad
function ubicacionKey(i: Inmueble): string {
  const u = (i.unidad || '').trim();
  return (u !== '' ? u : i.direccion).trim().toLowerCase();
}

export default function ModalFranja({
  isOpen, onClose, asesores, inmuebles, citasFranja = [],
  editData, defaultFecha, defaultHora, defaultAsesorId
}: ModalFranjaProps) {
  const isEditing = !!editData;

  const [inmuebleId, setInmuebleId] = useState(editData?.inmueble_id || '');
  const [asesorId, setAsesorId] = useState(editData?.asesor_id || defaultAsesorId || '');
  const [fecha, setFecha] = useState(editData?.fecha || defaultFecha || '');
  const [horaInicio, setHoraInicio] = useState(editData?.hora_inicio?.substring(0, 5) || defaultHora || '08:00');
  const [horaFin, setHoraFin] = useState(editData?.hora_fin?.substring(0, 5) || calcularHoraFin(defaultHora || '08:00'));
  const [color, setColor] = useState(editData?.color || '#00abd8');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busquedaInmueble, setBusquedaInmueble] = useState('');
  const [cancelandoCitaId, setCancelandoCitaId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Inmuebles que comparten ubicación con el seleccionado: la franja los cubre a todos
  const inmuebleSeleccionado = inmuebles.find(i => i.id === inmuebleId);
  const inmueblesCubiertos = inmuebleSeleccionado
    ? inmuebles.filter(i => ubicacionKey(i) === ubicacionKey(inmuebleSeleccionado)).length
    : 0;

  // Datos para el resumen de info de la franja (modo edición)
  const asesorSeleccionado = asesores.find(a => a.id === asesorId);
  const ubicacionInmueble = inmuebleSeleccionado
    ? (inmuebleSeleccionado.unidad?.trim() || inmuebleSeleccionado.direccion)
    : '';
  const fechaLegible = fecha
    ? new Date(fecha + 'T00:00:00')
        .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
        .replace(/^\w/, c => c.toUpperCase())
    : '';

  function calcularHoraFin(inicio: string): string {
    const idx = HORAS.indexOf(inicio);
    if (idx >= 0 && idx < HORAS.length - 1) return HORAS[idx + 1];
    return '18:00';
  }

  const handleHoraInicioChange = (val: string) => {
    setHoraInicio(val);
    // Auto-ajustar hora fin si es menor o igual
    if (val >= horaFin) {
      setHoraFin(calcularHoraFin(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inmuebleId || !asesorId || !fecha || !horaInicio || !horaFin) {
      setError('Todos los campos son obligatorios.');
      return;
    }

    if (horaInicio >= horaFin) {
      setError('La hora de fin debe ser posterior a la hora de inicio.');
      return;
    }

    setLoading(true);
    const data = { inmueble_id: inmuebleId, asesor_id: asesorId, fecha, hora_inicio: horaInicio, hora_fin: horaFin, color };

    const result = isEditing
      ? await actualizarFranjaHoraria(editData!.id, data)
      : await crearFranjaHoraria(data);

    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Error desconocido.');
    }
    setLoading(false);
  };

  const handleCancelarCita = async (citaId: string) => {
    if (!confirm('¿Cancelar esta cita? El cliente ya no aparecerá en la agenda.')) return;
    setCancelandoCitaId(citaId);
    const result = await cancelarCitaAdmin(citaId);
    setCancelandoCitaId(null);
    if (result.success) {
      onClose(); // el padre refresca la agenda al cerrar
    } else {
      setError(result.error || 'Error al cancelar la cita.');
    }
  };

  const handleDelete = async () => {
    if (!editData) return;
    if (!confirm('¿Eliminar esta franja horaria?')) return;
    setLoading(true);
    const result = await eliminarFranjaHoraria(editData.id);
    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Error al eliminar.');
    }
    setLoading(false);
  };

  const inmueblesFiltrados = busquedaInmueble
    ? inmuebles.filter(i =>
        i.titulo.toLowerCase().includes(busquedaInmueble.toLowerCase()) ||
        i.direccion.toLowerCase().includes(busquedaInmueble.toLowerCase())
      )
    : inmuebles;

  return (
    <div style={styles.overlay} className="animate-fade-in">
      <div style={styles.modal} className="glass-card">
        {/* Header */}
        <div style={styles.header}>
          <h3 style={styles.title}>
            <Clock size={20} color="var(--primary)" />
            {isEditing ? 'Editar Franja Horaria' : 'Nueva Franja Horaria'}
          </h3>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="badge badge-danger" style={styles.errorBanner}>
            {error}
          </div>
        )}

        {/* Resumen de la franja (solo al editar una existente) */}
        {isEditing && (
          <div style={styles.infoResumen}>
            <div style={styles.infoFila}>
              <Building2 size={14} style={{ flexShrink: 0, color: 'var(--primary)' }} />
              <span style={styles.infoTexto}>{ubicacionInmueble || '—'}</span>
            </div>
            <div style={styles.infoFila}>
              <Users size={14} style={{ flexShrink: 0, color: 'var(--primary)' }} />
              <span style={styles.infoTexto}>{asesorSeleccionado?.nombre_completo || '—'}</span>
            </div>
            <div style={styles.infoFila}>
              <Clock size={14} style={{ flexShrink: 0, color: 'var(--primary)' }} />
              <span style={styles.infoTexto}>{fechaLegible} · {horaInicio} – {horaFin}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Inmueble */}
          <div className="form-group">
            <label className="form-label">
              <Building2 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Inmueble
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Buscar inmueble..."
              value={busquedaInmueble}
              onChange={e => setBusquedaInmueble(e.target.value)}
              style={{ marginBottom: '0.35rem' }}
            />
            <select
              className="form-select"
              value={inmuebleId}
              onChange={e => setInmuebleId(e.target.value)}
              required
              size={Math.min(inmueblesFiltrados.length + 1, 5)}
              style={{ minHeight: '2.5rem' }}
            >
              <option value="">Seleccionar inmueble</option>
              {inmueblesFiltrados.map(i => (
                <option key={i.id} value={i.id}>
                  {i.titulo} — {i.direccion}
                </option>
              ))}
            </select>
            {inmueblesCubiertos > 1 && (
              <div style={styles.coberturaHint}>
                <Users size={13} style={{ flexShrink: 0 }} />
                Este horario cubrirá los {inmueblesCubiertos} inmuebles de la misma{' '}
                {inmuebleSeleccionado?.unidad?.trim() ? `unidad (${inmuebleSeleccionado.unidad.trim()})` : 'dirección'}.
              </div>
            )}
          </div>

          {/* Asesor */}
          <div className="form-group">
            <label className="form-label">Asesor Asignado</label>
            <select
              className="form-select"
              value={asesorId}
              onChange={e => setAsesorId(e.target.value)}
              required
            >
              <option value="">Seleccionar asesor</option>
              {asesores.map(a => (
                <option key={a.id} value={a.id}>{a.nombre_completo}</option>
              ))}
            </select>
          </div>

          {/* Fecha */}
          <div className="form-group">
            <label className="form-label">Fecha</label>
            <input
              type="date"
              className="form-input"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              required
            />
          </div>

          {/* Horas */}
          <div style={styles.horasRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Hora Inicio</label>
              <select
                className="form-select"
                value={horaInicio}
                onChange={e => handleHoraInicioChange(e.target.value)}
                required
              >
                {HORAS.filter(h => h < '18:00').map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Hora Fin</label>
              <select
                className="form-select"
                value={horaFin}
                onChange={e => setHoraFin(e.target.value)}
                required
              >
                {HORAS.filter(h => h > horaInicio).map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Color */}
          <div className="form-group">
            <label className="form-label">Color</label>
            <div style={styles.coloresRow}>
              {COLORES.map(c => (
                <button
                  key={c.valor}
                  type="button"
                  title={c.nombre}
                  onClick={() => setColor(c.valor)}
                  style={{
                    ...styles.colorBtn,
                    backgroundColor: c.valor,
                    boxShadow: color === c.valor ? `0 0 0 3px ${c.valor}40, 0 0 0 5px white` : 'none',
                    transform: color === c.valor ? 'scale(1.2)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Citas agendadas en esta franja */}
          {isEditing && citasFranja.length > 0 && (
            <div className="form-group">
              <label className="form-label">
                <PhoneCall size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Citas agendadas ({citasFranja.length})
              </label>
              {citasFranja.map(c => (
                <div key={c.id} style={styles.citaRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.citaHora}>
                      {c.hora_inicio.substring(0, 5)} – {c.hora_fin.substring(0, 5)}
                      {c.origen === 'n8n' && (
                        <span className="badge badge-info" style={{ fontSize: '0.62rem', padding: '0.05rem 0.4rem', marginLeft: '0.4rem' }}>
                          Agente
                        </span>
                      )}
                    </div>
                    <div style={styles.citaCliente}>
                      {c.cliente_nombre} · {c.cliente_telefono}
                      {c.inmuebles
                        ? ` · ${c.inmuebles.unidad?.trim() || c.inmuebles.direccion || c.inmuebles.titulo}`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', flexShrink: 0 }}
                    disabled={cancelandoCitaId === c.id}
                    onClick={() => handleCancelarCita(c.id)}
                  >
                    {cancelandoCitaId === c.id ? <Loader2 size={13} className="animate-spin" /> : 'Cancelar'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                className="btn btn-danger"
                disabled={loading}
                style={{ marginRight: 'auto' }}
              >
                <Trash2 size={16} />
                Eliminar
              </button>
            )}
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {isEditing ? 'Guardar Cambios' : 'Programar Franja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '1rem',
  },
  modal: {
    width: '100%',
    maxWidth: '520px',
    maxHeight: '90vh',
    overflowY: 'auto',
    padding: '1.5rem',
    borderRadius: 'var(--border-radius-lg)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.25rem',
  },
  title: {
    fontSize: '1.15rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0.25rem',
    borderRadius: '6px',
    display: 'flex',
  },
  errorBanner: {
    padding: '0.65rem 1rem',
    borderRadius: '8px',
    marginBottom: '1rem',
    textAlign: 'center' as const,
    width: '100%',
  },
  infoResumen: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
    padding: '0.75rem 0.85rem',
    marginBottom: '1.1rem',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
  },
  infoFila: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    minWidth: 0,
  },
  infoTexto: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  horasRow: {
    display: 'flex',
    gap: '0.75rem',
  },
  coloresRow: {
    display: 'flex',
    gap: '0.6rem',
    flexWrap: 'wrap' as const,
  },
  colorBtn: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--border-color)',
  },
  coberturaHint: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.76rem',
    color: 'var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.07)',
    borderRadius: '8px',
    padding: '0.4rem 0.6rem',
    marginTop: '0.4rem',
  },
  citaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.65rem',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    marginBottom: '0.4rem',
  },
  citaHora: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
  },
  citaCliente: {
    fontSize: '0.74rem',
    color: 'var(--text-muted)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
};
