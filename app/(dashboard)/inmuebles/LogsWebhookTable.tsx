'use client';

import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  HelpCircle, 
  Calendar, 
  Image, 
  User, 
  FileText,
  AlertCircle
} from 'lucide-react';

interface WebhookLog {
  id: string;
  titulo_captacion: string;
  asesor_nombre: string;
  precio: number;
  estado: 'enviando' | 'exito' | 'fallido';
  error_detalles: string | null;
  files_count: number;
  files_size_bytes: number;
  created_at: string;
  payload: Record<string, any>;
}

interface LogsWebhookTableProps {
  logs: WebhookLog[];
}

export default function LogsWebhookTable({ logs }: LogsWebhookTableProps) {
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null);

  // Formatear pesos
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  return (
    <div style={styles.tableContainer}>
      <header style={styles.tableHeader}>
        <h3 style={styles.tableTitle}>Historial de Disparos Webhook (Traceability logs)</h3>
        <p style={styles.tableSub}>
          Auditoría de envíos, volumen de carga, errores de comunicación e integración con el flujo n8n.
        </p>
      </header>

      {selectedError && (
        <div style={styles.errorBanner} className="animate-fade-in">
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <AlertCircle size={18} color="rgb(239, 68, 68)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <h4 style={styles.errorTitle}>Detalles de la Falla del Webhook</h4>
              <p style={styles.errorText}>{selectedError}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={() => setSelectedError(null)} 
            style={styles.closeErrorBtn}
          >
            Entendido
          </button>
        </div>
      )}

      {logs.length === 0 ? (
        <div style={styles.emptyLogs} className="glass-card">
          <AlertCircle size={36} color="var(--text-muted)" />
          <p style={{ marginTop: '0.75rem', fontWeight: 600, margin: 0 }}>No hay envíos registrados.</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem', marginBottom: 0 }}>
            Los envíos realizados mediante el botón "Captar Propiedad" aparecerán aquí con sus métricas.
          </p>
        </div>
      ) : (
        <>
          {/* VISTA DE ESCRITORIO (Tradicional) */}
          <div style={styles.responsiveTableWrapper} className="desktop-only">
            <table style={styles.table}>
              <thead>
                <tr style={styles.thRow}>
                  <th style={{ ...styles.th, width: '22%' }}>Título Captación</th>
                  <th style={{ ...styles.th, width: '15%' }}>Asesor</th>
                  <th style={{ ...styles.th, width: '13%' }}>Precio (COP)</th>
                  <th style={{ ...styles.th, width: '10%' }}>Fotos</th>
                  <th style={{ ...styles.th, width: '12%' }}>Peso Total</th>
                  <th style={{ ...styles.th, width: '13%' }}>Estado</th>
                  <th style={{ ...styles.th, width: '15%', textAlign: 'right' }}>Fecha Envió</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const dateStr = new Date(log.created_at).toLocaleString('es-CO', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  return (
                    <tr key={log.id} style={styles.tr}>
                      <td style={styles.td} title={log.titulo_captacion}>
                        <span style={styles.captacionTitle}>{log.titulo_captacion}</span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.rowFlex}>
                          <User size={12} color="var(--text-secondary)" />
                          <span>{log.asesor_nombre}</span>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.priceVal}>
                          ${Number(log.precio).toLocaleString('es-CO')}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.rowFlex}>
                          <Image size={12} color="var(--primary)" />
                          <strong>{log.files_count}</strong>
                        </div>
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        {formatBytes(log.files_size_bytes)}
                      </td>
                      <td style={styles.td}>
                        {log.estado === 'enviando' && (
                          <span className="badge badge-warning" style={styles.statusBadge}>
                            <Loader2 size={10} className="spin-anim" style={{ marginRight: 3 }} />
                            Enviando
                          </span>
                        )}
                        {log.estado === 'exito' && (
                          <span className="badge badge-success" style={styles.statusBadge}>
                            <CheckCircle2 size={10} style={{ marginRight: 3 }} />
                            Éxito
                          </span>
                        )}
                        {log.estado === 'fallido' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span 
                              onClick={() => setSelectedError(log.error_detalles || 'Error de timeout o conexión desconocido.')}
                              className="badge badge-danger" 
                              style={{ ...styles.statusBadge, cursor: 'pointer' }}
                              title="Haz clic para ver el error"
                            >
                              <XCircle size={10} style={{ marginRight: 3 }} />
                              Falló
                            </span>
                            <button 
                              type="button"
                              onClick={() => setSelectedError(log.error_detalles || 'Error desconocido.')}
                              style={styles.helpBtn}
                              title="Ver detalles de la falla"
                            >
                              <HelpCircle size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Calendar size={12} color="var(--text-muted)" />
                          <span>{dateStr}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* VISTA MÓVIL (Lista de Tarjetas Responsivas) */}
          <div style={styles.mobileListContainer} className="mobile-only">
            {logs.map((log) => {
              const dateStr = new Date(log.created_at).toLocaleString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div key={log.id} style={styles.mobileCard}>
                  {/* Fila Título & Precio */}
                  <div style={styles.mobileCardHeader}>
                    <h4 style={styles.mobileCardTitle}>{log.titulo_captacion}</h4>
                    <span style={styles.priceVal}>
                      ${Number(log.precio).toLocaleString('es-CO')}
                    </span>
                  </div>

                  {/* Fila Meta (Asesor y Fecha) */}
                  <div style={styles.mobileCardMeta}>
                    <div style={styles.mobileMetaItem}>
                      <User size={12} color="var(--text-secondary)" />
                      <span>{log.asesor_nombre}</span>
                    </div>
                    <div style={styles.mobileMetaItem}>
                      <Calendar size={12} color="var(--text-muted)" />
                      <span>{dateStr}</span>
                    </div>
                  </div>

                  {/* Dos columnas de información (Fotos y Peso) */}
                  <div style={styles.mobileCardStats}>
                    <div style={styles.mobileStatCol}>
                      <div style={styles.rowFlex}>
                        <Image size={12} color="var(--primary)" />
                        <span style={{ fontSize: '0.8rem' }}>Fotos: <strong>{log.files_count}</strong></span>
                      </div>
                    </div>
                    <div style={styles.mobileStatCol}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        Peso: {formatBytes(log.files_size_bytes)}
                      </span>
                    </div>
                  </div>

                  {/* Fila de acciones y estado */}
                  <div style={styles.mobileCardActions}>
                    <div>
                      {log.estado === 'enviando' && (
                        <span className="badge badge-warning" style={styles.statusBadge}>
                          <Loader2 size={10} className="spin-anim" style={{ marginRight: 3 }} />
                          Enviando
                        </span>
                      )}
                      {log.estado === 'exito' && (
                        <span className="badge badge-success" style={styles.statusBadge}>
                          <CheckCircle2 size={10} style={{ marginRight: 3 }} />
                          Éxito
                        </span>
                      )}
                      {log.estado === 'fallido' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span 
                            onClick={() => setSelectedError(log.error_detalles || 'Error de timeout o conexión desconocido.')}
                            className="badge badge-danger" 
                            style={{ ...styles.statusBadge, cursor: 'pointer' }}
                            title="Haz clic para ver el error"
                          >
                            <XCircle size={10} style={{ marginRight: 3 }} />
                            Falló
                          </span>
                          <button 
                            type="button"
                            onClick={() => setSelectedError(log.error_detalles || 'Error desconocido.')}
                            style={styles.helpBtn}
                            title="Ver detalles de la falla"
                          >
                            <HelpCircle size={12} />
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedPayloadId(prev => (prev === log.id ? null : log.id))}
                      style={styles.payloadToggleBtn}
                    >
                      <FileText size={12} style={{ marginRight: 4 }} />
                      {expandedPayloadId === log.id ? 'Ocultar JSON' : 'Ver JSON'}
                    </button>
                  </div>

                  {/* Detalles del Payload JSON (desplegable) */}
                  {expandedPayloadId === log.id && (
                    <div style={styles.mobilePayloadContainer} className="animate-fade-in">
                      <pre style={styles.mobilePayloadPre}>
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tableContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  tableHeader: {
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '1rem',
  },
  tableTitle: {
    fontSize: '1.3rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  tableSub: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    margin: 0,
    marginTop: '0.25rem',
  },
  responsiveTableWrapper: {
    width: '100%',
    overflowX: 'auto',
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
    backgroundColor: '#ffffff',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
  },
  thRow: {
    backgroundColor: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
  },
  th: {
    padding: '0.9rem 1.25rem',
    fontSize: '0.78rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
    transition: 'background-color var(--transition-fast)',
  },
  td: {
    padding: '0.9rem 1.25rem',
    fontSize: '0.82rem',
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  captacionTitle: {
    fontWeight: '600',
    color: 'var(--text-primary)',
    display: 'block',
    maxWidth: '220px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowFlex: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  priceVal: {
    fontFamily: 'monospace',
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.2rem 0.5rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    borderRadius: '4px',
  },
  helpBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLogs: {
    padding: '4rem 2rem',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  errorBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '1.25rem',
    borderRadius: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  errorTitle: {
    fontSize: '0.88rem',
    fontWeight: '700',
    color: 'rgb(239, 68, 68)',
    margin: 0,
  },
  errorText: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    margin: 0,
    marginTop: '0.35rem',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    lineHeight: '1.4',
  },
  closeErrorBtn: {
    padding: '0.35rem 0.75rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '700',
    color: 'rgb(239, 68, 68)',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    flexShrink: 0,
  },
  mobileCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1.25rem',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
    marginBottom: '1rem',
  },
  mobileCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '0.5rem',
  },
  mobileCardTitle: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
    lineHeight: '1.3',
  },
  mobileCardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    borderBottom: '1px dashed var(--border-color)',
    paddingBottom: '0.5rem',
  },
  mobileMetaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  mobileCardStats: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.5rem',
    backgroundColor: 'var(--bg-secondary)',
    padding: '0.5rem 0.75rem',
    borderRadius: '6px',
  },
  mobileStatCol: {
    display: 'flex',
    alignItems: 'center',
  },
  mobileCardActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '0.25rem',
  },
  payloadToggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    color: 'var(--primary)',
    fontSize: '0.75rem',
    fontWeight: '700',
    cursor: 'pointer',
    padding: '0.35rem 0.6rem',
    borderRadius: '6px',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
    transition: 'all var(--transition-fast)',
  },
  mobilePayloadContainer: {
    marginTop: '0.5rem',
    padding: '0.75rem',
    borderRadius: '8px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  mobilePayloadPre: {
    margin: 0,
    fontSize: '0.7rem',
    fontFamily: 'monospace',
    color: '#38bdf8',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  mobileListContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  }
};
