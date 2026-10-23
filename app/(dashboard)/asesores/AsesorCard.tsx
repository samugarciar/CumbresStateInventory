'use client';

import { useState, useTransition } from 'react';
import { actualizarAsesor, desactivarAsesor, reactivarAsesor } from '@/app/actions/admin';
import TelefonoAsesorEditor from './TelefonoAsesorEditor';
import { Briefcase, Calendar, Mail, Pencil, UserX, UserCheck, Loader2, Building2 } from 'lucide-react';

interface AsesorCardProps {
  asesor: {
    id: string;
    nombre_completo: string;
    email: string;
    telefono: string | null;
    created_at: string;
    activo: boolean;
    desactivado_at: string | null;
  };
  /** Inmuebles cuyo asesor efectivo es este (coalesce(asesor_id_override, asesor_id)). */
  inmuebles: number;
  /** Asesores activos que pueden recibir sus inmuebles al desactivarlo. */
  otrosActivos: { id: string; nombre_completo: string }[];
}

type Modo = 'ver' | 'editar' | 'desactivar';

export default function AsesorCard({ asesor, inmuebles, otrosActivos }: AsesorCardProps) {
  const [modo, setModo] = useState<Modo>('ver');
  const [nombre, setNombre] = useState(asesor.nombre_completo);
  const [email, setEmail] = useState(asesor.email);
  const [reasignarA, setReasignarA] = useState(otrosActivos[0]?.id || '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const abrir = (m: Modo) => {
    setError(null);
    setNombre(asesor.nombre_completo);
    setEmail(asesor.email);
    setModo(m);
  };

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      const r = await actualizarAsesor(asesor.id, nombre, email);
      if (r.success) setModo('ver');
      else setError(r.error || 'No se pudo guardar.');
    });
  };

  const desactivar = () => {
    setError(null);
    startTransition(async () => {
      // Si sale bien, la página se revalida y la tarjeta pasa a "Inactivos".
      const r = await desactivarAsesor(asesor.id, reasignarA || null);
      if (!r.success) setError(r.error || 'No se pudo desactivar.');
    });
  };

  const reactivar = () => {
    setError(null);
    startTransition(async () => {
      const r = await reactivarAsesor(asesor.id);
      if (!r.success) setError(r.error || 'No se pudo reactivar.');
    });
  };

  return (
    <div
      className="glass-card animate-fade-in"
      style={{ ...styles.card, ...(asesor.activo ? {} : styles.cardInactiva) }}
    >
      <div style={styles.row}>
        <div style={styles.avatar}>
          <Briefcase size={18} color={asesor.activo ? 'var(--primary)' : 'var(--text-muted)'} />
        </div>
        <div style={styles.info}>
          <h3 style={styles.name}>{asesor.nombre_completo}</h3>
          <div style={styles.metaRow}>
            <span style={styles.metaItem}>
              <Mail size={12} />
              {asesor.email}
            </span>
            {asesor.activo ? (
              <span style={styles.metaItem}>
                <Calendar size={12} />
                Registrado el {new Date(asesor.created_at).toLocaleDateString('es-CO')}
              </span>
            ) : (
              asesor.desactivado_at && (
                <span style={styles.metaItem}>
                  <Calendar size={12} />
                  Desactivado el {new Date(asesor.desactivado_at).toLocaleDateString('es-CO')}
                </span>
              )
            )}
            <span style={styles.metaItem} title="Inmuebles donde es el asesor efectivo">
              <Building2 size={12} />
              {inmuebles} inmueble(s)
            </span>
            {asesor.activo && <TelefonoAsesorEditor asesorId={asesor.id} telefono={asesor.telefono} />}
          </div>
        </div>

        {asesor.activo ? (
          modo === 'ver' && (
            <div style={styles.acciones}>
              <button type="button" onClick={() => abrir('editar')} style={styles.iconBtn} title="Editar nombre y correo">
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => abrir('desactivar')} style={styles.iconBtn} title="Desactivar (ya no trabaja con nosotros)">
                <UserX size={14} color="var(--danger)" />
              </button>
            </div>
          )
        ) : (
          <button type="button" onClick={reactivar} disabled={isPending} className="btn btn-secondary" style={styles.smallBtn}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
            Reactivar
          </button>
        )}
      </div>

      {modo === 'editar' && (
        <div style={styles.panel}>
          <div style={styles.campos}>
            <input
              className="form-input"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Nombre completo"
              disabled={isPending}
              aria-label="Nombre completo"
            />
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Correo"
              disabled={isPending}
              aria-label="Correo"
            />
          </div>
          <p style={styles.nota}>
            El correo es también su usuario para iniciar sesión. El nombre debe coincidir con el de Nuby para que la
            sincronización le asigne sus inmuebles.
          </p>
          <div style={styles.botones}>
            <button type="button" onClick={() => setModo('ver')} disabled={isPending} className="btn btn-secondary" style={styles.smallBtn}>
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={isPending} className="btn btn-primary" style={styles.smallBtn}>
              {isPending && <Loader2 size={14} className="animate-spin" />}
              Guardar
            </button>
          </div>
        </div>
      )}

      {modo === 'desactivar' && (
        <div style={styles.panel}>
          <p style={styles.texto}>
            <strong>{asesor.nombre_completo}</strong> no podrá volver a iniciar sesión y dejará de aparecer en la agenda,
            las citas y los selectores. Su historial (citas, tareas e inventarios) se conserva.
          </p>
          {inmuebles > 0 && (
            <label style={styles.texto}>
              Pasar sus {inmuebles} inmueble(s) a:{' '}
              <select
                className="form-select"
                value={reasignarA}
                onChange={e => setReasignarA(e.target.value)}
                disabled={isPending}
                style={styles.select}
              >
                {otrosActivos.map(a => (
                  <option key={a.id} value={a.id}>{a.nombre_completo}</option>
                ))}
                <option value="">No pasarlos por ahora</option>
              </select>
            </label>
          )}
          <div style={styles.botones}>
            <button type="button" onClick={() => setModo('ver')} disabled={isPending} className="btn btn-secondary" style={styles.smallBtn}>
              Cancelar
            </button>
            <button type="button" onClick={desactivar} disabled={isPending} className="btn btn-danger" style={styles.smallBtn}>
              {isPending && <Loader2 size={14} className="animate-spin" />}
              Desactivar
            </button>
          </div>
        </div>
      )}

      {error && <div className="badge badge-danger" style={styles.alert}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.85rem',
    padding: '1.25rem',
  },
  cardInactiva: {
    opacity: 0.7,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  avatar: {
    width: '40px',
    height: '40px',
    flexShrink: 0,
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: '1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  metaRow: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  acciones: {
    display: 'flex',
    gap: '0.35rem',
  },
  iconBtn: {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    width: '32px',
    height: '32px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    padding: 0,
  },
  smallBtn: {
    padding: '0.45rem 0.9rem',
    fontSize: '0.8rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    paddingTop: '0.85rem',
    borderTop: '1px solid var(--border-color)',
  },
  campos: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.5rem',
  },
  nota: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  },
  texto: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
  },
  select: {
    marginTop: '0.35rem',
    width: '100%',
  },
  botones: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
  },
  alert: {
    padding: '0.6rem 0.85rem',
    fontSize: '0.8rem',
    borderRadius: 'var(--border-radius-sm)',
    display: 'block',
  },
};
