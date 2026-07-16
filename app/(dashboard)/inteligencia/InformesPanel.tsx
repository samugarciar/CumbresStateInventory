'use client';

import React, { useState } from 'react';
import { FileText, ArrowLeft, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { obtenerInforme, eliminarInforme } from '@/app/actions/inteligencia';
import { renderMarkdown } from './renderMarkdown';

export interface InformeResumen {
  id: string;
  tipo: 'brief_diario' | 'informe' | 'otro';
  titulo: string;
  resumen: string | null;
  created_at: string;
  conversacion_id: string | null;
  usuarios: { nombre_completo: string } | null;
}

interface InformeDetalle extends InformeResumen {
  contenido_markdown: string;
}

const ETIQUETA_TIPO: Record<InformeResumen['tipo'], string> = {
  brief_diario: 'Brief diario',
  informe: 'Informe',
  otro: 'Documento',
};

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface InformesPanelProps {
  informes: InformeResumen[];
  onEliminado: (id: string) => void;
  onVerConversacion: (conversacionId: string) => void;
}

export default function InformesPanel({ informes, onEliminado, onVerConversacion }: InformesPanelProps) {
  const [abierto, setAbierto] = useState<InformeDetalle | null>(null);
  const [cargandoId, setCargandoId] = useState<string | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const abrir = async (id: string) => {
    setCargandoId(id);
    const res = await obtenerInforme(id);
    setCargandoId(null);
    if (!res.success || !res.data) {
      alert(res.error || 'No se pudo abrir el informe.');
      return;
    }
    // Supabase infiere el join `usuarios(...)` de forma laxa (a veces como
    // array) al no usar tipos generados del esquema; la forma real en
    // runtime es un objeto (o null), igual que en el resto de la app.
    setAbierto(res.data as unknown as InformeDetalle);
  };

  const borrar = async (id: string) => {
    if (!confirm('¿Eliminar este informe guardado? No se puede deshacer.')) return;
    setBorrandoId(id);
    const res = await eliminarInforme(id);
    setBorrandoId(null);
    if (!res.success) {
      alert(res.error || 'No se pudo eliminar.');
      return;
    }
    if (abierto?.id === id) setAbierto(null);
    onEliminado(id);
  };

  if (abierto) {
    return (
      <div style={styles.contenedor}>
        <div style={styles.detalleHeader}>
          <button style={styles.volverBtn} onClick={() => setAbierto(null)}>
            <ArrowLeft size={15} />
            Todos los informes
          </button>
        </div>
        <div style={styles.detalleCuerpo}>
          <span style={styles.badge}>{ETIQUETA_TIPO[abierto.tipo]}</span>
          <h2 style={styles.detalleTitulo}>{abierto.titulo}</h2>
          <p style={styles.detalleMeta}>
            {fechaLarga(abierto.created_at)}
            {abierto.usuarios?.nombre_completo ? ` · ${abierto.usuarios.nombre_completo}` : ''}
          </p>
          <div style={styles.detalleMarkdown}>{renderMarkdown(abierto.contenido_markdown)}</div>
          <div style={styles.detalleAcciones}>
            {abierto.conversacion_id && (
              <button style={styles.accionBtn} onClick={() => onVerConversacion(abierto.conversacion_id!)}>
                <MessageSquare size={14} />
                Ver conversación de origen
              </button>
            )}
            <button style={{ ...styles.accionBtn, color: '#ef4444' }} onClick={() => borrar(abierto.id)}>
              {borrandoId === abierto.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Eliminar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.contenedor}>
      {informes.length === 0 ? (
        <div style={styles.vacio}>
          <FileText size={30} color="var(--text-muted)" style={{ opacity: 0.6 }} />
          <p style={styles.vacioTexto}>
            Todavía no hay informes guardados. Pídele a Cumbre un brief o un informe y quedará aquí para
            consultarlo después.
          </p>
        </div>
      ) : (
        <div style={styles.grid}>
          {informes.map((inf) => (
            <div key={inf.id} style={styles.card} onClick={() => abrir(inf.id)}>
              <div style={styles.cardHeader}>
                <span style={styles.badge}>{ETIQUETA_TIPO[inf.tipo]}</span>
                {cargandoId === inf.id && <Loader2 size={13} className="animate-spin" />}
              </div>
              <h3 style={styles.cardTitulo}>{inf.titulo}</h3>
              {inf.resumen && <p style={styles.cardResumen}>{inf.resumen}</p>}
              <div style={styles.cardPie}>
                <span>{fechaLarga(inf.created_at)}</span>
                <button
                  style={styles.cardBorrar}
                  title="Eliminar"
                  onClick={(e) => {
                    e.stopPropagation();
                    borrar(inf.id);
                  }}
                >
                  {borrandoId === inf.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: {
    height: '100%',
    overflowY: 'auto',
  },
  vacio: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    textAlign: 'center',
    padding: '2rem',
  },
  vacioTexto: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    maxWidth: '360px',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '0.85rem',
  },
  card: {
    padding: '0.9rem 1rem',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    transition: 'border-color var(--transition-fast)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitulo: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  cardResumen: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    margin: 0,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardPie: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '0.35rem',
    fontSize: '0.68rem',
    color: 'var(--text-muted)',
  },
  cardBorrar: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.15rem',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  badge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: 'var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '999px',
    padding: '0.1rem 0.55rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    width: 'fit-content',
  },
  detalleHeader: {
    marginBottom: '0.75rem',
  },
  volverBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.7rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  detalleCuerpo: {
    maxWidth: '720px',
  },
  detalleTitulo: {
    fontSize: '1.25rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    margin: '0.5rem 0 0.15rem',
  },
  detalleMeta: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    margin: 0,
  },
  detalleMarkdown: {
    marginTop: '1.25rem',
    fontSize: '0.9rem',
    lineHeight: 1.6,
    color: 'var(--text-primary)',
  },
  detalleAcciones: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1.5rem',
    paddingTop: '1rem',
    borderTop: '1px solid var(--border-color)',
  },
  accionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.45rem 0.85rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
