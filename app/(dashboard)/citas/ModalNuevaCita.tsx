'use client';

import React, { useState } from 'react';
import { X, Loader2, CalendarPlus, Building2, Clock, User as UserIcon, Phone } from 'lucide-react';
import { agendarCitaManual } from '@/app/actions/agenda';

interface Inmueble {
  id: string;
  titulo: string;
  direccion: string;
}

interface ModalNuevaCitaProps {
  isOpen: boolean;
  onClose: () => void;
  inmuebles: Inmueble[];
  defaultFecha?: string;
}

// Opciones de hora cada 30 min de 8:00 a 18:00 (misma grilla que las franjas)
function generarOpcionesHora(): string[] {
  const o: string[] = [];
  for (let h = 8; h <= 17; h++) {
    o.push(`${String(h).padStart(2, '0')}:00`);
    o.push(`${String(h).padStart(2, '0')}:30`);
  }
  o.push('18:00');
  return o;
}
const HORAS = generarOpcionesHora();

export default function ModalNuevaCita({ isOpen, onClose, inmuebles, defaultFecha }: ModalNuevaCitaProps) {
  const [inmuebleId, setInmuebleId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [fecha, setFecha] = useState(defaultFecha || '');
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [horaFin, setHoraFin] = useState('09:30');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const calcularFin = (inicio: string): string => {
    const i = HORAS.indexOf(inicio);
    return i >= 0 && i < HORAS.length - 1 ? HORAS[i + 1] : '18:00';
  };

  const onInicio = (val: string) => {
    setHoraInicio(val);
    if (val >= horaFin) setHoraFin(calcularFin(val));
  };

  const resetForm = () => {
    setInmuebleId('');
    setBusqueda('');
    setNombre('');
    setTelefono('');
    setNotas('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!inmuebleId || !fecha || !horaInicio || !horaFin) {
      setError('Completa inmueble, fecha y horario.');
      return;
    }
    if (!nombre.trim() || !telefono.trim()) {
      setError('El nombre y el teléfono del cliente son obligatorios.');
      return;
    }
    if (horaInicio >= horaFin) {
      setError('La hora de fin debe ser posterior a la de inicio.');
      return;
    }

    setLoading(true);
    const result = await agendarCitaManual({
      inmueble_id: inmuebleId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      cliente_nombre: nombre,
      cliente_telefono: telefono,
      cliente_email: null,
      notas: notas || null,
    });
    setLoading(false);

    if (result.success) {
      resetForm();
      onClose();
    } else {
      setError(result.error || 'No se pudo agendar la cita.');
    }
  };

  const filtrados = busqueda
    ? inmuebles.filter(i =>
        i.titulo.toLowerCase().includes(busqueda.toLowerCase()) ||
        i.direccion.toLowerCase().includes(busqueda.toLowerCase())
      )
    : inmuebles;

  return (
    <div style={styles.overlay} className="animate-fade-in">
      <div style={styles.modal} className="glass-card">
        <div style={styles.header}>
          <h3 style={styles.title}>
            <CalendarPlus size={20} color="var(--primary)" />
            Nueva cita
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

        <form onSubmit={submit} style={styles.form}>
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
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              style={{ marginBottom: '0.35rem' }}
            />
            <select
              className="form-select"
              value={inmuebleId}
              onChange={e => setInmuebleId(e.target.value)}
              required
              size={Math.min(filtrados.length + 1, 5)}
              style={{ minHeight: '2.5rem' }}
            >
              <option value="">Seleccionar inmueble</option>
              {filtrados.map(i => (
                <option key={i.id} value={i.id}>
                  {i.titulo} — {i.direccion}
                </option>
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
          <div style={styles.row}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">
                <Clock size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Hora inicio
              </label>
              <select className="form-select" value={horaInicio} onChange={e => onInicio(e.target.value)} required>
                {HORAS.filter(h => h < '18:00').map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Hora fin</label>
              <select className="form-select" value={horaFin} onChange={e => setHoraFin(e.target.value)} required>
                {HORAS.filter(h => h > horaInicio).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          {/* Cliente */}
          <div style={styles.row}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">
                <UserIcon size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Cliente
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Nombre del cliente"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">
                <Phone size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Teléfono
              </label>
              <input
                type="tel"
                className="form-input"
                placeholder="3001234567"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Notas (opcional) */}
          <div className="form-group">
            <label className="form-label">
              Notas <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Ej: el cliente prefiere la mañana"
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          <div style={styles.hint}>
            <Clock size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              La cita debe caer dentro de una franja del asesor para este inmueble. Si no hay franja que cubra
              el horario, créala primero en Agenda.
            </span>
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              Agendar cita
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
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  row: {
    display: 'flex',
    gap: '0.75rem',
  },
  hint: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.4rem',
    fontSize: '0.76rem',
    color: 'var(--text-muted)',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
    borderRadius: '8px',
    padding: '0.5rem 0.65rem',
    margin: '0.25rem 0 0.5rem',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--border-color)',
  },
};
