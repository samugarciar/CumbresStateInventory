'use client';

import { useState, useTransition } from 'react';
import { actualizarEstadoInmueble } from '@/app/actions/inmuebles';
import { Loader2 } from 'lucide-react';

interface StateSelectorProps {
  inmuebleId: string;
  currentEstado: string;
}

export default function StateSelector({ inmuebleId, currentEstado }: StateSelectorProps) {
  const [estado, setEstado] = useState(currentEstado);
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nuevoEstado = e.target.value;
    setEstado(nuevoEstado);

    startTransition(async () => {
      const result = await actualizarEstadoInmueble(inmuebleId, nuevoEstado);
      if (!result.success) {
        alert(result.error || 'Error al cambiar de estado.');
        setEstado(currentEstado); // Revertir en caso de error
      }
    });
  };

  return (
    <div style={styles.container}>
      <select
        value={estado}
        onChange={handleChange}
        disabled={isPending}
        className={`form-select`}
        style={{
          ...styles.select,
          color: 
            estado === 'disponible' ? 'var(--success)' :
            estado === 'reservado' ? 'var(--warning)' :
            estado === 'vendido' ? 'var(--danger)' : '#a78bfa',
          borderColor:
            estado === 'disponible' ? 'rgba(0, 171, 216, 0.2)' :
            estado === 'reservado' ? 'rgba(245, 158, 11, 0.2)' :
            estado === 'vendido' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(167, 139, 250, 0.2)',
          backgroundColor: '#ffffff',
        }}
      >
        <option value="disponible" style={{ color: 'var(--success)' }}>Disponible</option>
        <option value="reservado" style={{ color: 'var(--warning)' }}>Reservado</option>
        <option value="vendido" style={{ color: 'var(--danger)' }}>Vendido</option>
        <option value="arrendado" style={{ color: '#a78bfa' }}>Arrendado</option>
      </select>
      {isPending && <Loader2 size={12} className="animate-spin" style={styles.spinner} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  select: {
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    fontWeight: '700',
    borderRadius: '6px',
    cursor: 'pointer',
    outline: 'none',
    border: '1px solid',
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    color: 'var(--primary)',
  },
};
