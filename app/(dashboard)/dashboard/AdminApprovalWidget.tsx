'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, XCircle, FileText, Loader2 } from 'lucide-react';
import { resolverAsociacionContrato } from '@/app/actions/inventarios';
import { useRouter } from 'next/navigation';

interface Solicitud {
  tareaId: string;
  inventarioId: string;
  tituloInventario: string;
  contratoIdPropuesto: string;
  creadoPorNombre: string;
  fecha: string;
}

interface AdminApprovalWidgetProps {
  solicitudes: Solicitud[];
}

export default function AdminApprovalWidget({ solicitudes }: AdminApprovalWidgetProps) {
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const router = useRouter();

  if (solicitudes.length === 0) return null;

  const handleAction = (solicitud: Solicitud, aprobar: boolean) => {
    setProcessingId(solicitud.tareaId);
    startTransition(async () => {
      const res = await resolverAsociacionContrato(
        solicitud.tareaId, 
        solicitud.inventarioId, 
        solicitud.contratoIdPropuesto, 
        aprobar
      );
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error || 'Ocurrió un error al procesar la solicitud.');
      }
      setProcessingId(null);
    });
  };

  return (
    <div className="glass-card animate-fade-in" style={styles.card}>
      <h3 style={styles.title}>
        <FileText size={18} color="var(--primary)" />
        Solicitudes de Asociación de Contratos
      </h3>
      <p style={styles.subtitle}>
        Los asesores han propuesto los siguientes IDs de contrato para los inventarios. Por favor, revísalos y aprueba o rechaza cada uno.
      </p>

      <div style={styles.list}>
        {solicitudes.map((s) => (
          <div key={s.tareaId} style={styles.item}>
            <div style={styles.itemInfo}>
              <h4 style={styles.itemTitle}>{s.tituloInventario}</h4>
              <div style={styles.itemMeta}>
                <span>Propone ID: <strong>{s.contratoIdPropuesto}</strong></span>
                <span>•</span>
                <span>Por: {s.creadoPorNombre}</span>
                <span>•</span>
                <span>{new Date(s.fecha).toLocaleDateString('es-CO')}</span>
              </div>
            </div>
            
            <div style={styles.actions}>
              <button 
                className="btn" 
                style={{ ...styles.actionBtn, ...styles.btnDeny }}
                onClick={() => handleAction(s, false)}
                disabled={isPending && processingId === s.tareaId}
              >
                {isPending && processingId === s.tareaId ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                Rechazar
              </button>
              <button 
                className="btn" 
                style={{ ...styles.actionBtn, ...styles.btnApprove }}
                onClick={() => handleAction(s, true)}
                disabled={isPending && processingId === s.tareaId}
              >
                {isPending && processingId === s.tareaId ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Aprobar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(254, 243, 199, 0.05)',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginTop: '0.5rem',
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  itemInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  itemTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: 0,
  },
  itemMeta: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
  },
  actionBtn: {
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  btnApprove: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    color: 'var(--success)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
  },
  btnDeny: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  }
};
