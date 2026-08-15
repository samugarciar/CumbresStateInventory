'use client';

import { useState } from 'react';
import { sincronizarInmuebles, SyncResult } from '@/app/actions/sync-nuby';
import { 
  RefreshCw, 
  ArrowLeft, 
  Settings, 
  CheckCircle2, 
  AlertTriangle, 
  Info,
  ChevronDown,
  ChevronUp,
  Database,
  Briefcase
} from 'lucide-react';
import Link from 'next/link';

interface SyncClientProps {
  defaultInstancia: string;
}

export default function SyncClient({ defaultInstancia }: SyncClientProps) {
  const [instancia, setInstancia] = useState(defaultInstancia || 'invosadia.arrendasoft.co');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await sincronizarInmuebles({
        instancia: instancia.trim() || undefined,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
      });
      setResult(res);
      if (res.success) {
        setShowDetails(true);
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: err.message || 'Ocurrió un error inesperado al conectar con el servidor.',
        processed: 0,
        imported: 0,
        updated: 0,
        failed: 0,
        details: [err.toString()]
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Botón Volver */}
      <div style={styles.backRow}>
        <Link href="/inmuebles" style={styles.backLink}>
          <ArrowLeft size={16} />
          Volver al catálogo de inmuebles
        </Link>
      </div>

      <div style={styles.layout}>
        {/* Panel Principal */}
        <div style={styles.mainPanel}>
          <div className="glass-container" style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={styles.iconContainer}>
                <RefreshCw size={24} color="var(--primary)" className={loading ? 'animate-spin' : ''} />
              </div>
              <div>
                <h2 style={styles.cardTitle}>Sincronización Arrendasoft ERP</h2>
                <p style={styles.cardSubtitle}>
                  Importa o actualiza el catálogo de inmuebles en tiempo real de forma segura.
                </p>
              </div>
            </div>

            <div style={styles.infoBox}>
              <Info size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <p style={styles.infoText}>
                Esta sincronización descargará las propiedades del ERP en estado
                <strong> Disponible (Desocupada)</strong> o <strong>Arrendado</strong>, y
                <strong> dará de baja</strong> las que el ERP haya marcado como inactivas (sin borrarlas).
                Los borradores y estados desconocidos se ignoran. Los asesores locales serán enlazados de
                manera automática mediante comparación inteligente de sus nombres.
              </p>
            </div>

            <form onSubmit={handleSync} style={styles.form}>
              <div style={styles.btnRow}>
                <button 
                  type="submit" 
                  disabled={loading} 
                  className={`btn ${loading ? 'btn-secondary' : 'btn-primary'}`} 
                  style={{ ...styles.syncBtn, flex: 1 }}
                >
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  {loading ? 'Sincronizando inmuebles...' : 'Iniciar Sincronización'}
                </button>

                <button 
                  type="button" 
                  onClick={() => setShowConfig(!showConfig)}
                  style={styles.configToggleBtn}
                  title="Configurar credenciales"
                >
                  <Settings size={18} color="var(--text-secondary)" />
                </button>
              </div>

              {/* Parámetros de Configuración */}
              {showConfig && (
                <div className="animate-fade-in" style={styles.configSection}>
                  <h3 style={styles.sectionTitle}>Ajustes de Conexión</h3>
                  
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Instancia del ERP (Base URL)</label>
                    <input 
                      type="text" 
                      className="form-control"
                      value={instancia}
                      onChange={(e) => setInstancia(e.target.value)}
                      placeholder="ej. invosadia.arrendasoft.co"
                      style={styles.input}
                    />
                    <small style={styles.helpText}>URL asignada por Nuby para tu inmobiliaria.</small>
                  </div>

                  <div style={styles.rowFields}>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label}>OAuth2 Client ID (Opcional)</label>
                      <input 
                        type="text" 
                        className="form-control"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="Dejar vacío para usar .env.local"
                        style={styles.input}
                      />
                    </div>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label}>OAuth2 Client Secret (Opcional)</label>
                      <input 
                        type="password" 
                        className="form-control"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="Dejar vacío para usar .env.local"
                        style={styles.input}
                      />
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Resultados de la Sincronización */}
          {result && (
            <div className="glass-card animate-fade-in" style={styles.resultCard}>
              <div style={styles.resultHeader}>
                {result.success ? (
                  <CheckCircle2 size={32} color="#10b981" />
                ) : (
                  <AlertTriangle size={32} color="#f59e0b" />
                )}
                <div style={{ flex: 1 }}>
                  <h3 style={styles.resultTitle}>
                    {result.success ? 'Sincronización Finalizada' : 'Fallo en la Sincronización'}
                  </h3>
                  <p style={styles.resultDesc}>{result.message}</p>
                </div>
              </div>

              {/* Estadísticas en cuadrícula */}
              {result.success && (
                <div style={styles.statsGrid}>
                  <div style={styles.statBox}>
                    <span style={styles.statNum}>{result.processed}</span>
                    <span style={styles.statLabel}>Analizados en API</span>
                  </div>
                  <div style={{ ...styles.statBox, borderColor: '#10b981' }}>
                    <span style={{ ...styles.statNum, color: '#10b981' }}>+{result.imported}</span>
                    <span style={styles.statLabel}>Importados (Nuevos)</span>
                  </div>
                  <div style={{ ...styles.statBox, borderColor: 'var(--primary)' }}>
                    <span style={{ ...styles.statNum, color: 'var(--primary)' }}>{result.updated}</span>
                    <span style={styles.statLabel}>Actualizados</span>
                  </div>
                  <div style={{ ...styles.statBox, borderColor: '#f59e0b' }}>
                    <span style={{ ...styles.statNum, color: '#f59e0b' }}>{result.deactivated ?? 0}</span>
                    <span style={styles.statLabel}>Desactivados</span>
                  </div>
                  <div style={{ ...styles.statBox, borderColor: '#ef4444' }}>
                    <span style={{ ...styles.statNum, color: '#ef4444' }}>{result.failed}</span>
                    <span style={styles.statLabel}>Omitidos/Fallidos</span>
                  </div>
                </div>
              )}

              {/* Registro de Detalles */}
              {result.details && result.details.length > 0 && (
                <div style={styles.detailsSection}>
                  <button 
                    onClick={() => setShowDetails(!showDetails)}
                    style={styles.detailsToggle}
                  >
                    <span>Registro Detallado del Servidor</span>
                    {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {showDetails && (
                    <div style={styles.terminal}>
                      {result.details.map((line, i) => (
                        <div key={i} style={styles.terminalLine}>
                          <span style={styles.terminalTime}>[{new Date().toLocaleTimeString('es-CO')}]</span>
                          <span style={styles.terminalText}>{line}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel Lateral: Estado del Sistema */}
        <aside style={styles.aside}>
          <div className="glass-container" style={styles.statusCard}>
            <h3 style={styles.asideTitle}>Estado de Conexión</h3>
            
            <div style={styles.statusRow}>
              <div style={styles.statusIndicatorActive} />
              <div>
                <span style={styles.statusText}>ERP Arrendasoft (Nuby)</span>
                <small style={styles.statusSub}>API Activa V2.0</small>
              </div>
            </div>

            <div style={styles.divider} />

            <div style={styles.infoMeta}>
              <div style={styles.metaLabelRow}>
                <Database size={14} color="var(--primary)" />
                <span style={styles.metaTitle}>Instancia Vinculada</span>
              </div>
              <span style={styles.metaVal}>{instancia}</span>
            </div>

            <div style={styles.infoMeta}>
              <div style={styles.metaLabelRow}>
                <Briefcase size={14} color="var(--primary)" />
                <span style={styles.metaTitle}>Seguridad de Enlace</span>
              </div>
              <span style={styles.metaVal}>OAuth2 Bearer Token (JWT)</span>
            </div>

            <div style={styles.divider} />

            <div style={styles.helpTextContainer}>
              <h4 style={styles.helpHeading}>¿Cómo funciona el enlazador?</h4>
              <p style={styles.helpParagraph}>
                Cada propiedad del ERP contiene un código único. Este código se guarda de forma local en nuestra base de datos.
                Si realizas cambios en Arrendasoft (precios, descripciones o asignaciones) y ejecutas la sincronización,
                el sistema modificará automáticamente tus inmuebles locales sin alterar tus inventarios y listas de chequeo activas.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  backRow: {
    display: 'flex',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.87rem',
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    fontWeight: '500',
    transition: 'color 0.2s',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '1.3fr 0.7fr',
    gap: '2.5rem',
    alignItems: 'start',
  },
  mainPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  card: {
    padding: '2.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  iconContainer: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: '1.35rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  cardSubtitle: {
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
    margin: 0,
    marginTop: '0.25rem',
  },
  infoBox: {
    display: 'flex',
    gap: '0.75rem',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
    border: '1px solid rgba(0, 171, 216, 0.1)',
    borderRadius: '10px',
    padding: '1rem',
  },
  infoText: {
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    lineHeight: '1.5',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  btnRow: {
    display: 'flex',
    gap: '0.75rem',
  },
  syncBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.85rem 1.5rem',
    fontSize: '0.95rem',
    fontWeight: '700',
    borderRadius: '10px',
  },
  configToggleBtn: {
    width: '45px',
    height: '45px',
    borderRadius: '10px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  configSection: {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
    marginBottom: '0.25rem',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  rowFields: {
    display: 'flex',
    gap: '1rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
  },
  input: {
    padding: '0.6rem 0.85rem',
    fontSize: '0.87rem',
  },
  helpText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  resultCard: {
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  resultHeader: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'flex-start',
  },
  resultTitle: {
    fontSize: '1.15rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  resultDesc: {
    fontSize: '0.87rem',
    color: 'var(--text-secondary)',
    margin: 0,
    marginTop: '0.35rem',
    lineHeight: '1.45',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '1rem',
  },
  statBox: {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  statNum: {
    fontSize: '1.65rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '0.25rem',
    fontWeight: '600',
  },
  detailsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '1.25rem',
  },
  detailsToggle: {
    background: 'none',
    border: 'none',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
  },
  terminal: {
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '1rem',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    maxHeight: '200px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  terminalLine: {
    display: 'flex',
    gap: '0.5rem',
    lineHeight: '1.4',
  },
  terminalTime: {
    color: '#64748b',
    flexShrink: 0,
  },
  terminalText: {
    color: '#cbd5e1',
    wordBreak: 'break-all',
  },
  aside: {
    position: 'sticky',
    top: '2.5rem',
  },
  statusCard: {
    padding: '1.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  asideTitle: {
    fontSize: '1rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  statusIndicatorActive: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
  },
  statusText: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  statusSub: {
    display: 'block',
    fontSize: '0.72rem',
    color: '#10b981',
    fontWeight: '600',
  },
  divider: {
    height: '1px',
    backgroundColor: 'var(--border-color)',
  },
  infoMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  metaLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  metaTitle: {
    fontSize: '0.75rem',
    fontWeight: '700',
    color: 'var(--text-muted)',
  },
  metaVal: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    wordBreak: 'break-all',
  },
  helpTextContainer: {
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '8px',
    padding: '1rem',
    border: '1px solid var(--border-color)',
  },
  helpHeading: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
    marginBottom: '0.35rem',
  },
  helpParagraph: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.45',
    margin: 0,
  },
};
