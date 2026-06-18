'use client';

import { useState, useTransition } from 'react';
import { reasignarAsesor } from '@/app/actions/inmuebles';
import { Loader2, UserCheck } from 'lucide-react';

interface AsesorSelectorProps {
  inmuebleId: string;
  asesorOverrideId: string | null;
  defaultAsesorName: string;
  asesores: { id: string; nombre_completo: string }[];
}

export default function AsesorSelector({
  inmuebleId,
  asesorOverrideId,
  defaultAsesorName,
  asesores,
}: AsesorSelectorProps) {
  const [selectedVal, setSelectedVal] = useState(asesorOverrideId || 'default');
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const targetAsesorId = val === 'default' ? null : val;

    setSelectedVal(val);
    startTransition(async () => {
      const result = await reasignarAsesor(inmuebleId, targetAsesorId);
      if (!result.success) {
        alert(result.error || 'Error al reasignar asesor.');
        setSelectedVal(asesorOverrideId || 'default'); // Revertir
      }
    });
  };

  return (
    <div style={styles.container}>
      <UserCheck size={14} color={selectedVal !== 'default' ? '#10b981' : '#64748b'} style={{ marginRight: '0.2rem' }} />
      <select
        value={selectedVal}
        onChange={handleChange}
        disabled={isPending}
        className="form-select"
        style={{
          ...styles.select,
          color: selectedVal !== 'default' ? '#10b981' : '#475569',
          borderColor: selectedVal !== 'default' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(100, 116, 139, 0.2)',
          backgroundColor: '#ffffff',
        }}
      >
        <option value="default" style={{ color: '#475569' }}>
          Por defecto ERP ({defaultAsesorName})
        </option>
        {asesores.map((asesor) => (
          <option key={asesor.id} value={asesor.id} style={{ color: 'var(--text-primary)' }}>
            Asignar a: {asesor.nombre_completo}
          </option>
        ))}
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
    fontWeight: '600',
    borderRadius: '6px',
    cursor: 'pointer',
    outline: 'none',
    border: '1px solid',
    maxWidth: '220px',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    color: 'var(--primary)',
  },
};
