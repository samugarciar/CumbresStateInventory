'use client';

import { useState, useTransition } from 'react';
import { X, Check, FileText, Loader2 } from 'lucide-react';
import { proponerAsociacionContrato } from '@/app/actions/inventarios';
import { useRouter } from 'next/navigation';

interface ModalAsociarContratoProps {
  inventarioId: string;
  onClose: () => void;
}

export default function ModalAsociarContrato({ inventarioId, onClose }: ModalAsociarContratoProps) {
  const [contratoId, setContratoId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!contratoId.trim()) {
      setError('Por favor, ingresa un número de contrato válido.');
      return;
    }

    startTransition(async () => {
      const res = await proponerAsociacionContrato(inventarioId, contratoId.trim());
      if (res.success) {
        onClose();
        router.refresh();
      } else {
        setError(res.error || 'Ocurrió un error al proponer el contrato.');
      }
    });
  };

  return (
    <div style={styles.overlay}>
      <div className="glass-card animate-fade-in" style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <FileText size={20} color="var(--primary)" />
            Asociar Contrato
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} style={styles.body}>
          <p style={styles.description}>
            Ingresa el número de contrato de Arrendasoft para este inventario. 
            Esta solicitud será enviada al usuario administrador para su aprobación.
          </p>
          
          <div className="form-group">
            <label className="form-label" htmlFor="contratoId">ID del Contrato en Arrendasoft</label>
            <input
              id="contratoId"
              type="text"
              className="form-input"
              placeholder="Ej. 2026130"
              value={contratoId}
              onChange={(e) => setContratoId(e.target.value)}
              disabled={isPending}
              autoFocus
            />
          </div>

          {error && (
            <div style={styles.errorText}>{error}</div>
          )}

          <div style={styles.footer}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isPending || !contratoId.trim()}
            >
              {isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Enviando...
                </>
              ) : (
                <>
                  <Check size={16} /> Enviar Solicitud
                </>
              )}
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    width: '90%',
    maxWidth: '400px',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '0.75rem',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: 'var(--text-primary)',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  description: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: 0,
  },
  errorText: {
    color: 'var(--danger)',
    fontSize: '0.85rem',
    fontWeight: '500',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '0.5rem',
  }
};
