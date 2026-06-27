'use client';

import React, { useState } from 'react';
import { X, Loader2, CalendarPlus, User as UserIcon, Phone, CheckCircle2, Circle, CalendarX } from 'lucide-react';
import { agendarCitaManual } from '@/app/actions/agenda';

interface Franja {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  inmuebles: { titulo: string; direccion: string; unidad?: string | null } | null;
  usuarios: { nombre_completo: string } | null;
}

interface ModalNuevaCitaProps {
  isOpen: boolean;
  onClose: () => void;
  franjas: Franja[];
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(fechaStr: string): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

// Ubicación a mostrar: la unidad si existe; si no, la dirección
function ubicacion(inm: Franja['inmuebles']): string {
  if (!inm) return 'Sin ubicación';
  return (inm.unidad || '').trim() || inm.direccion || 'Sin ubicación';
}

export default function ModalNuevaCita({ isOpen, onClose, franjas }: ModalNuevaCitaProps) {
  const [franjaId, setFranjaId] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setFranjaId('');
    setNombre('');
    setTelefono('');
    setNotas('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!franjaId) {
      setError('Elige una franja disponible.');
      return;
    }
    if (!nombre.trim() || !telefono.trim()) {
      setError('El nombre y el teléfono del cliente son obligatorios.');
      return;
    }

    setLoading(true);
    const result = await agendarCitaManual({
      franja_id: franjaId,
      cliente_nombre: nombre,
      cliente_telefono: telefono,
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
          {/* Franja disponible */}
          <div className="form-group">
            <label className="form-label">Elige una franja disponible</label>

            {franjas.length === 0 ? (
              <div style={styles.sinFranjas}>
                <CalendarX size={28} color="var(--text-muted)" style={{ marginBottom: '0.4rem' }} />
                <div>No hay franjas disponibles.</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Créalas primero en la Agenda.
                </div>
              </div>
            ) : (
              <div style={styles.franjaList}>
                {franjas.map(f => {
                  const sel = f.id === franjaId;
                  const asesor = f.usuarios?.nombre_completo || 'Sin asesor';
                  return (
                    <button
                      type="button"
                      key={f.id}
                      onClick={() => setFranjaId(f.id)}
                      style={{ ...styles.franjaItem, ...(sel ? styles.franjaItemSel : {}) }}
                    >
                      {sel
                        ? <CheckCircle2 size={18} color="var(--primary)" style={{ flexShrink: 0 }} />
                        : <Circle size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
                      <span style={styles.franjaInfo}>
                        <span style={styles.franjaUbic}>
                          {ubicacion(f.inmuebles)}
                          {f.inmuebles?.titulo && (
                            <span style={styles.franjaTitulo}> · {f.inmuebles.titulo}</span>
                          )}
                        </span>
                        <span style={styles.franjaMeta}>
                          <UserIcon size={12} style={{ verticalAlign: '-1px', marginRight: 2 }} />
                          {asesor.split(' ')[0]} · {fechaCorta(f.fecha)} · {f.hora_inicio.substring(0, 5)}–{f.hora_fin.substring(0, 5)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
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
              placeholder="Ej: el cliente llega 10 min tarde"
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || franjas.length === 0}>
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
  franjaList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
    maxHeight: '230px',
    overflowY: 'auto' as const,
    paddingRight: '0.15rem',
  },
  franjaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    width: '100%',
    textAlign: 'left' as const,
    padding: '0.6rem 0.7rem',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  franjaItemSel: {
    border: '1.5px solid var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.06)',
  },
  franjaInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    flex: 1,
  },
  franjaUbic: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  franjaTitulo: {
    fontWeight: '400',
    color: 'var(--text-muted)',
  },
  franjaMeta: {
    fontSize: '0.76rem',
    color: 'var(--text-secondary)',
    marginTop: '1px',
  },
  sinFranjas: {
    textAlign: 'center' as const,
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    fontWeight: '600',
    padding: '1.5rem 1rem',
    border: '1px dashed var(--border-color)',
    borderRadius: '10px',
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
