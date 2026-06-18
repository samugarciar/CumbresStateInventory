'use client';

import { useState, useTransition } from 'react';
import { actualizarTelefonoAsesor } from '@/app/actions/admin';
import { Loader2, Phone, Check, X } from 'lucide-react';

interface TelefonoAsesorEditorProps {
  asesorId: string;
  telefono: string | null;
}

/**
 * Editor inline del teléfono del asesor (solo admin).
 * El teléfono se incluye en el payload de "Confirmar citas" hacia el flujo n8n.
 */
export default function TelefonoAsesorEditor({ asesorId, telefono }: TelefonoAsesorEditorProps) {
  const [editing, setEditing] = useState(false);
  const [valor, setValor] = useState(telefono || '');
  const [isPending, startTransition] = useTransition();

  const guardar = () => {
    startTransition(async () => {
      const result = await actualizarTelefonoAsesor(asesorId, valor);
      if (!result.success) {
        alert(result.error || 'No se pudo actualizar el teléfono.');
        setValor(telefono || '');
      }
      setEditing(false);
    });
  };

  const cancelar = () => {
    setValor(telefono || '');
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={styles.display}
        title="Editar el teléfono del asesor (se usa al confirmar citas)"
      >
        <Phone size={12} color={telefono ? 'var(--primary)' : '#94a3b8'} />
        <span style={{ color: telefono ? 'var(--text-secondary)' : '#94a3b8' }}>
          {telefono || 'Agregar teléfono'}
        </span>
      </button>
    );
  }

  return (
    <div style={styles.container}>
      <input
        type="tel"
        className="form-input"
        value={valor}
        onChange={e => setValor(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); guardar(); }
          if (e.key === 'Escape') cancelar();
        }}
        placeholder="3001234567"
        autoFocus
        disabled={isPending}
        style={styles.input}
      />
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
    gap: '0.35rem',
    fontSize: '0.8rem',
    fontWeight: '500',
    padding: '0.15rem 0',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  input: {
    padding: '0.25rem 0.5rem',
    fontSize: '0.8rem',
    borderRadius: '6px',
    width: '150px',
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
