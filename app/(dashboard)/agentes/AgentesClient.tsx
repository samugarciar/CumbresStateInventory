'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  BrainCircuit,
  MessageCircle,
  Loader2,
  DollarSign,
  Zap,
  CalendarCheck,
  CalendarPlus,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { toggleAgente, guardarLimiteMensual, type AgenteId } from '@/app/actions/agentes';

interface AgentesClientProps {
  config: {
    arriendabot_bi: { activo: boolean; limite_mensual_usd: number | null };
    comercial_whatsapp: { activo: boolean };
  };
  bi: {
    modelo: string;
    gastoMesUsd: number;
    gastoHoyUsd: number;
    peticionesMes: number;
    peticionesHoy: number;
    tokensEntradaMes: number;
    tokensSalidaMes: number;
    tokensCacheMes: number;
  };
  n8n: {
    citas7: number;
    citas30: number;
    solicitudes30: number;
    solicitudesPendientes: number;
  };
}

function usd(v: number): string {
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function Interruptor({
  activo,
  cambiando,
  onToggle,
}: {
  activo: boolean;
  cambiando: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={cambiando}
      title={activo ? 'Apagar agente' : 'Prender agente'}
      style={{
        ...styles.switchTrack,
        backgroundColor: activo ? '#22c55e' : 'var(--border-color)',
        opacity: cambiando ? 0.6 : 1,
      }}
    >
      <span
        style={{
          ...styles.switchKnob,
          transform: activo ? 'translateX(20px)' : 'translateX(0)',
        }}
      >
        {cambiando && <Loader2 size={12} className="animate-spin" color="var(--text-muted)" />}
      </span>
    </button>
  );
}

export default function AgentesClient({ config, bi, n8n }: AgentesClientProps) {
  const router = useRouter();
  const [cambiando, setCambiando] = useState<AgenteId | null>(null);
  const [limiteInput, setLimiteInput] = useState(
    config.arriendabot_bi.limite_mensual_usd !== null ? String(config.arriendabot_bi.limite_mensual_usd) : ''
  );
  const [guardandoLimite, setGuardandoLimite] = useState(false);

  const toggle = async (agente: AgenteId, activoActual: boolean) => {
    const apagando = activoActual;
    if (
      apagando &&
      !confirm(
        agente === 'comercial_whatsapp'
          ? '¿Apagar el agente comercial de WhatsApp? Dejará de consultar disponibilidad, agendar, cancelar y registrar solicitudes hasta que lo prendas de nuevo.'
          : '¿Apagar el asesor BI? El chat de Arriendabot no responderá hasta que lo prendas de nuevo.'
      )
    ) {
      return;
    }
    setCambiando(agente);
    const res = await toggleAgente(agente, !activoActual);
    setCambiando(null);
    if (!res.success) {
      alert(res.error || 'No se pudo cambiar el estado.');
      return;
    }
    router.refresh();
  };

  const guardarLimite = async () => {
    const texto = limiteInput.trim();
    const valor = texto === '' ? null : Number(texto);
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      alert('Ingresa un monto en USD mayor a 0, o deja vacío para quitar el límite.');
      return;
    }
    setGuardandoLimite(true);
    const res = await guardarLimiteMensual(valor);
    setGuardandoLimite(false);
    if (!res.success) {
      alert(res.error || 'No se pudo guardar el límite.');
      return;
    }
    router.refresh();
  };

  const limite = config.arriendabot_bi.limite_mensual_usd;
  const porcentajeLimite = limite ? Math.min(100, (bi.gastoMesUsd / limite) * 100) : null;

  return (
    <div style={styles.contenedor}>
      <div className="responsive-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={styles.titulo}>
            <Bot size={28} color="var(--primary)" />
            Agentes
          </h1>
          <p style={styles.subtitulo}>
            Presupuesto, actividad y encendido/apagado de los agentes de la inmobiliaria.
          </p>
        </div>
      </div>

      <div style={styles.grid}>
        {/* ==================== Arriendabot · Asesor BI ==================== */}
        <div className="glass-card" style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardIcono}>
              <BrainCircuit size={22} color="var(--primary)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={styles.cardTitulo}>Arriendabot · Asesor BI</h2>
              <p style={styles.cardDetalle}>
                Chat de inteligencia comercial en la app · modelo <code style={styles.codigo}>{bi.modelo}</code>
              </p>
            </div>
            <Interruptor
              activo={config.arriendabot_bi.activo}
              cambiando={cambiando === 'arriendabot_bi'}
              onToggle={() => toggle('arriendabot_bi', config.arriendabot_bi.activo)}
            />
          </div>

          {!config.arriendabot_bi.activo && (
            <div style={styles.avisoPausado}>
              <AlertTriangle size={14} />
              Pausado: el chat de Arriendabot no responde hasta que lo prendas.
            </div>
          )}

          <div style={styles.statsGrid}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>
                <DollarSign size={12} style={{ verticalAlign: '-2px' }} /> Gasto este mes
              </span>
              <span style={styles.statValorGrande}>{usd(bi.gastoMesUsd)}</span>
              <span style={styles.statSub}>USD (API de Anthropic)</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Gasto hoy</span>
              <span style={styles.statValor}>{usd(bi.gastoHoyUsd)}</span>
              <span style={styles.statSub}>{bi.peticionesHoy} consulta{bi.peticionesHoy !== 1 ? 's' : ''}</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Consultas del mes</span>
              <span style={styles.statValor}>{bi.peticionesMes}</span>
              <span style={styles.statSub}>al chat del asesor</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>
                <Zap size={12} style={{ verticalAlign: '-2px' }} /> Tokens del mes
              </span>
              <span style={styles.statValor}>
                {(bi.tokensEntradaMes + bi.tokensSalidaMes + bi.tokensCacheMes).toLocaleString('es-CO')}
              </span>
              <span style={styles.statSub}>
                {bi.tokensEntradaMes.toLocaleString('es-CO')} entrada · {bi.tokensSalidaMes.toLocaleString('es-CO')} salida ·{' '}
                {bi.tokensCacheMes.toLocaleString('es-CO')} cache
              </span>
            </div>
          </div>

          {/* Límite mensual */}
          <div style={styles.limiteSeccion}>
            <span style={styles.limiteLabel}>Límite de gasto mensual (USD)</span>
            {limite !== null && porcentajeLimite !== null && (
              <div style={styles.barraWrap}>
                <div style={styles.barraFondo}>
                  <div
                    style={{
                      ...styles.barraRelleno,
                      width: `${porcentajeLimite}%`,
                      backgroundColor:
                        porcentajeLimite >= 100 ? '#ef4444' : porcentajeLimite >= 80 ? '#f59e0b' : '#22c55e',
                    }}
                  />
                </div>
                <span style={styles.barraTexto}>
                  {usd(bi.gastoMesUsd)} de {usd(limite)} ({Math.round(porcentajeLimite)}%)
                  {porcentajeLimite >= 100 && ' — límite alcanzado: el chat responde como pausado'}
                </span>
              </div>
            )}
            <div style={styles.limiteFila}>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Sin límite"
                className="form-input"
                style={styles.limiteInput}
                value={limiteInput}
                onChange={(e) => setLimiteInput(e.target.value)}
                disabled={guardandoLimite}
              />
              <button
                className="btn btn-secondary"
                style={styles.limiteBtn}
                onClick={guardarLimite}
                disabled={guardandoLimite}
              >
                {guardandoLimite ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
              </button>
            </div>
            <span style={styles.limiteNota}>
              Al alcanzarlo, el chat deja de responder hasta el mes siguiente (o hasta subir/quitar el límite). Vacío =
              sin límite.
            </span>
          </div>
        </div>

        {/* ==================== Agente comercial · WhatsApp ==================== */}
        <div className="glass-card" style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardIcono}>
              <MessageCircle size={22} color="#22c55e" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={styles.cardTitulo}>Agente comercial · WhatsApp</h2>
              <p style={styles.cardDetalle}>Atiende clientes, consulta disponibilidad y agenda visitas (n8n)</p>
            </div>
            <Interruptor
              activo={config.comercial_whatsapp.activo}
              cambiando={cambiando === 'comercial_whatsapp'}
              onToggle={() => toggle('comercial_whatsapp', config.comercial_whatsapp.activo)}
            />
          </div>

          {!config.comercial_whatsapp.activo && (
            <div style={styles.avisoPausado}>
              <AlertTriangle size={14} />
              Pausado: no puede consultar disponibilidad, agendar, cancelar ni registrar solicitudes. Los clientes
              reciben un mensaje de que un asesor humano continuará.
            </div>
          )}

          <div style={styles.statsGrid}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>
                <CalendarCheck size={12} style={{ verticalAlign: '-2px' }} /> Citas agendadas (7 días)
              </span>
              <span style={styles.statValorGrande}>{n8n.citas7}</span>
              <span style={styles.statSub}>por el agente</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Citas (30 días)</span>
              <span style={styles.statValor}>{n8n.citas30}</span>
              <span style={styles.statSub}>por el agente</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>
                <CalendarPlus size={12} style={{ verticalAlign: '-2px' }} /> Solicitudes (30 días)
              </span>
              <span style={styles.statValor}>{n8n.solicitudes30}</span>
              <span style={styles.statSub}>de apertura de agenda</span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Solicitudes pendientes</span>
              <span style={styles.statValor}>{n8n.solicitudesPendientes}</span>
              <span style={styles.statSub}>por decidir en Citas</span>
            </div>
          </div>

          <div style={styles.notaExterna}>
            <Info size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              El presupuesto LLM de este agente se gestiona fuera de la app (workflow de n8n). Aquí se controla su
              acceso a los datos: apagarlo bloquea al instante consultar disponibilidad, agendar, cancelar y registrar
              solicitudes — sin tocar n8n.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: {
    maxWidth: '100%',
  },
  titulo: {
    fontSize: '1.65rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  subtitulo: {
    fontSize: '0.88rem',
    color: 'var(--text-muted)',
    marginTop: '0.25rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: '1.25rem',
    alignItems: 'start',
  },
  card: {
    padding: '1.25rem 1.4rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
  },
  cardIcono: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardTitulo: {
    fontSize: '1.05rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    margin: 0,
  },
  cardDetalle: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  codigo: {
    fontFamily: 'monospace',
    fontSize: '0.72rem',
    backgroundColor: 'var(--bg-secondary)',
    padding: '0.05rem 0.35rem',
    borderRadius: '4px',
  },
  switchTrack: {
    position: 'relative',
    width: '46px',
    height: '26px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    padding: '3px',
    transition: 'background-color 0.2s ease',
  },
  switchKnob: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.3)',
    transition: 'transform 0.2s ease',
  },
  avisoPausado: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.45rem',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    borderRadius: '8px',
    padding: '0.55rem 0.75rem',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.75rem',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    padding: '0.7rem 0.8rem',
    borderRadius: '10px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    minWidth: 0,
  },
  statLabel: {
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  statValorGrande: {
    fontSize: '1.45rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
  },
  statValor: {
    fontSize: '1.15rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
  },
  statSub: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  limiteSeccion: {
    borderTop: '1px dashed var(--border-color)',
    paddingTop: '0.85rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  limiteLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  barraWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  barraFondo: {
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
  },
  barraRelleno: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.3s ease',
  },
  barraTexto: {
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
  },
  limiteFila: {
    display: 'flex',
    gap: '0.5rem',
  },
  limiteInput: {
    flex: 1,
    maxWidth: '160px',
    fontSize: '0.85rem',
    padding: '0.45rem 0.65rem',
  },
  limiteBtn: {
    padding: '0.45rem 0.9rem',
    fontSize: '0.8rem',
  },
  limiteNota: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  notaExterna: {
    display: 'flex',
    gap: '0.45rem',
    fontSize: '0.74rem',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '0.6rem 0.75rem',
    lineHeight: 1.45,
  },
};
