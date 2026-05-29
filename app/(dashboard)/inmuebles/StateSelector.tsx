'use client';

import { useState, useTransition } from 'react';
import { actualizarEstadoInmueble } from '@/app/actions/inmuebles';
import { Loader2, Lock, AlertTriangle } from 'lucide-react';

interface StateSelectorProps {
  inmuebleId: string;
  currentEstado: string;
}

export default function StateSelector({ inmuebleId, currentEstado }: StateSelectorProps) {
  const [estado, setEstado] = useState(currentEstado);
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [targetEstado, setTargetEstado] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nuevoEstado = e.target.value;

    if (nuevoEstado === 'inactivo') {
      // Mostrar modal de confirmación antes de proceder
      setTargetEstado(nuevoEstado);
      setShowConfirm(true);
    } else {
      // Proceder directamente
      ejecutarCambio(nuevoEstado);
    }
  };

  const ejecutarCambio = (nuevoEstado: string) => {
    setEstado(nuevoEstado);
    startTransition(async () => {
      const result = await actualizarEstadoInmueble(inmuebleId, nuevoEstado);
      if (!result.success) {
        alert(result.error || 'Error al cambiar de estado.');
        setEstado(currentEstado); // Revertir en caso de error
      }
    });
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    ejecutarCambio(targetEstado);
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setTargetEstado('');
    setEstado(currentEstado); // Restaurar estado
  };

  // Si el estado es arrendado, aplicar bloqueo estricto (padlock icon)
  if (estado === 'arrendado') {
    return (
      <div 
        style={styles.arrendadoBadge} 
        title="Inmueble arrendado legalmente. Estado bloqueado. Solo modificable desde Arrendasoft ERP."
      >
        <Lock size={12} color="#475569" style={{ marginRight: '0.25rem' }} />
        <span>Arrendado</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <select
        value={estado}
        onChange={handleChange}
        disabled={isPending}
        className="form-select"
        style={{
          ...styles.select,
          color: estado === 'disponible' ? '#10b981' : '#64748b',
          borderColor: estado === 'disponible' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(100, 116, 139, 0.2)',
          backgroundColor: '#ffffff',
        }}
      >
        <option value="disponible" style={{ color: '#10b981', fontWeight: 'bold' }}>Disponible</option>
        <option value="inactivo" style={{ color: '#64748b' }}>Marcar Inactivo</option>
      </select>

      {isPending && <Loader2 size={12} className="animate-spin" style={styles.spinner} />}

      {/* Modal de Confirmación Premium */}
      {showConfirm && (
        <div style={styles.modalOverlay} onClick={handleCancel}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()} className="glass-container animate-fade-in">
            <div style={styles.modalHeader}>
              <AlertTriangle size={24} color="#f59e0b" />
              <h4 style={styles.modalTitle}>Confirmar Desactivación</h4>
            </div>
            
            <p style={styles.modalText}>
              ¿Estás seguro de que deseas marcar este inmueble como <strong>Inactivo</strong>?<br /><br />
              Esta acción se sincronizará con <strong>Arrendasoft ERP</strong> y **ocultará la propiedad de forma inmediata** de los catálogos y búsquedas activas.
            </p>

            <div style={styles.modalButtons}>
              <button 
                onClick={handleCancel} 
                className="btn btn-secondary" 
                style={styles.cancelBtn}
              >
                Cancelar
              </button>
              <button 
                onClick={handleConfirm} 
                className="btn btn-danger" 
                style={styles.confirmBtn}
              >
                Sí, Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
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
  arrendadoBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem',
    fontWeight: '700',
    backgroundColor: '#f1f5f9',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    color: '#475569',
    cursor: 'not-allowed',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(8px)',
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
  },
  modal: {
    maxWidth: '420px',
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    padding: '1.5rem',
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    boxShadow: 'var(--shadow-lg)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  modalTitle: {
    fontSize: '1.05rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  modalText: {
    fontSize: '0.87rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    margin: 0,
  },
  modalButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '0.5rem',
  },
  cancelBtn: {
    fontSize: '0.8rem',
    padding: '0.45rem 1rem',
  },
  confirmBtn: {
    fontSize: '0.8rem',
    padding: '0.45rem 1rem',
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
    color: '#ffffff',
  },
};
