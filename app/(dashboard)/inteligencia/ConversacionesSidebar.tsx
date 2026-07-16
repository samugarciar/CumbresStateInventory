'use client';

import React from 'react';
import { MessageSquarePlus, MessageSquare, Trash2 } from 'lucide-react';

export interface ConversacionResumen {
  id: string;
  titulo: string;
  updated_at: string;
}

interface ConversacionesSidebarProps {
  conversaciones: ConversacionResumen[];
  activaId: string | null;
  onSeleccionar: (id: string) => void;
  onNueva: () => void;
  onEliminar: (id: string) => void;
  deshabilitado?: boolean;
}

function etiquetaFecha(iso: string): string {
  const fecha = new Date(iso);
  const hoy = new Date();
  const mismodDia = fecha.toDateString() === hoy.toDateString();
  if (mismodDia) return fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

export default function ConversacionesSidebar({
  conversaciones,
  activaId,
  onSeleccionar,
  onNueva,
  onEliminar,
  deshabilitado,
}: ConversacionesSidebarProps) {
  return (
    <div style={styles.contenedor}>
      <button style={styles.botonNueva} onClick={onNueva} disabled={deshabilitado}>
        <MessageSquarePlus size={16} />
        Nueva conversación
      </button>

      <div style={styles.lista}>
        {conversaciones.length === 0 ? (
          <p style={styles.vacio}>Aún no hay conversaciones.</p>
        ) : (
          conversaciones.map((c) => (
            <div
              key={c.id}
              style={{
                ...styles.item,
                ...(c.id === activaId ? styles.itemActivo : {}),
              }}
              onClick={() => !deshabilitado && onSeleccionar(c.id)}
            >
              <MessageSquare size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={styles.itemTitulo} title={c.titulo}>
                {c.titulo}
              </span>
              <span style={styles.itemFecha}>{etiquetaFecha(c.updated_at)}</span>
              <button
                style={styles.itemBorrar}
                title="Eliminar conversación"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('¿Eliminar esta conversación? No se pueden deshacer.')) onEliminar(c.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    gap: '0.6rem',
  },
  botonNueva: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    padding: '0.55rem 0.75rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: '0.82rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  lista: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  vacio: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    textAlign: 'center',
    marginTop: '1rem',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.6rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
    cursor: 'pointer',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
  },
  itemActivo: {
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    color: 'var(--primary)',
    fontWeight: 600,
  },
  itemTitulo: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  itemFecha: {
    fontSize: '0.68rem',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  itemBorrar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.2rem',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    opacity: 0.6,
  },
};
