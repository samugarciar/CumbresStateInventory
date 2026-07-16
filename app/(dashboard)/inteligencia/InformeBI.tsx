'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import type { InformeSpec } from '@/lib/bi/parte';
import { renderMarkdown } from './renderMarkdown';

const ETIQUETA_TIPO: Record<InformeSpec['tipo'], string> = {
  brief_diario: 'Brief diario',
  informe: 'Informe',
  otro: 'Documento',
};

// Tarjeta de un informe dentro del chat. Mismo tratamiento visual que
// GraficoBI: título propio, cuerpo con ancho acotado, nota de contexto.
export default function InformeBI({ spec }: { spec: InformeSpec }) {
  if (!spec.contenido_markdown) return null;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <FileText size={15} color="var(--primary)" />
        <span style={styles.badge}>{ETIQUETA_TIPO[spec.tipo] ?? 'Informe'}</span>
        <span style={styles.titulo}>{spec.titulo}</span>
      </div>
      <div style={styles.cuerpo}>{renderMarkdown(spec.contenido_markdown)}</div>
      <div style={styles.pie}>Guardado en Informes — puedes verlo después aunque borres esta conversación.</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    width: 'min(600px, 100%)',
    margin: '0.35rem 0',
    padding: '0.9rem 1rem',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    marginBottom: '0.5rem',
    flexWrap: 'wrap',
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
  },
  titulo: {
    fontSize: '0.88rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  cuerpo: {
    fontSize: '0.85rem',
    lineHeight: 1.55,
    color: 'var(--text-primary)',
  },
  pie: {
    marginTop: '0.6rem',
    paddingTop: '0.5rem',
    borderTop: '1px dashed var(--border-color)',
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
  },
};
