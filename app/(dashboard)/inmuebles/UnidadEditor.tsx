'use client';

import { useState, useTransition } from 'react';
import { actualizarUnidad } from '@/app/actions/inmuebles';
import { Loader2, MapPin, Check, X } from 'lucide-react';

interface UnidadEditorProps {
  inmuebleId: string;
  unidad: string | null;
  /** Unidades ya usadas en la inmobiliaria, para sugerir en el autocompletado */
  unidadesExistentes?: string[];
}

/**
 * Editor inline de la unidad del inmueble (solo admin).
 * La unidad agrupa inmuebles del mismo lugar: las franjas de la agenda
 * de un inmueble aplican a todos los que comparten su unidad.
 * Ofrece autocompletado con las unidades ya existentes para evitar
 * duplicados por tipeo (ej. "Torres de Cumbres" vs "Torre Cumbres").
 */
export default function UnidadEditor({ inmuebleId, unidad, unidadesExistentes = [] }: UnidadEditorProps) {
  const [editing, setEditing] = useState(false);
  const [valor, setValor] = useState(unidad || '');
  const [isPending, startTransition] = useTransition();
  // id único de datalist por inmueble (varios editores conviven en la misma página)
  const datalistId = `unidades-${inmuebleId}`;

  const guardar = () => {
    startTransition(async () => {
      const result = await actualizarUnidad(inmuebleId, valor);
      if (!result.success) {
        alert(result.error || 'Error al actualizar la unidad.');
        setValor(unidad || '');
      }
      setEditing(false);
    });
  };

  const cancelar = () => {
    setValor(unidad || '');
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={styles.display}
        title="La unidad agrupa inmuebles del mismo lugar para la agenda de visitas"
      >
        <MapPin size={13} color={unidad ? 'var(--primary)' : '#64748b'} />
        <span style={{ color: unidad ? 'var(--primary)' : '#64748b' }}>
          {unidad || 'Sin unidad'}
        </span>
      </button>
    );
  }

  return (
    <div style={styles.container}>
      <input
        type="text"
        className="form-input"
        value={valor}
        onChange={e => setValor(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); guardar(); }
          if (e.key === 'Escape') cancelar();
        }}
        placeholder="Ej: Torres de Cumbres"
        autoFocus
        disabled={isPending}
        style={styles.input}
        list={unidadesExistentes.length > 0 ? datalistId : undefined}
        autoComplete="off"
      />
      {unidadesExistentes.length > 0 && (
        <datalist id={datalistId}>
          {unidadesExistentes.map(u => <option key={u} value={u} />)}
        </datalist>
      )}
      <button type="button" onClick={guardar} disabled={isPending} style={styles.iconBtn} title="Guardar">
        {isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} color="#10b981" />}
      </button>
      <button type="button" onClick={cancelar} disabled={isPending} style={styles.iconBtn} title="Cancelar">
        <X size={14} color="#ef4444" />
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  display: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    padding: '0.25rem 0.5rem',
    borderRadius: '6px',
    border: '1px dashed rgba(100, 116, 139, 0.35)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  input: {
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    borderRadius: '6px',
    width: '160px',
  },
  iconBtn: {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
};
