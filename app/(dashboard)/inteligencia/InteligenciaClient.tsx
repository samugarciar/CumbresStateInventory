'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  BrainCircuit,
  Send,
  Loader2,
  Database,
  Cloud,
  Sparkles,
  BarChart3,
  FileText,
  Menu,
  MessagesSquare,
  LayoutList,
} from 'lucide-react';
import type { Turno } from '@/lib/bi/parte';
import { textoDeTurno } from '@/lib/bi/parte';
import GraficoBI from './GraficoBI';
import InformeBI from './InformeBI';
import { renderMarkdown } from './renderMarkdown';
import ConversacionesSidebar, { type ConversacionResumen } from './ConversacionesSidebar';
import InformesPanel, { type InformeResumen } from './InformesPanel';
import { cargarConversacion, eliminarConversacion } from '@/app/actions/inteligencia';

const SUGERENCIAS = [
  'Genera el brief del día',
  '¿Cómo van las citas esta semana vs. la anterior?',
  'Grafícame la cartera vencida y los mayores deudores',
  '¿Qué inventario disponible tenemos por tipo y precio promedio?',
  '¿Hay discrepancias entre la app y el ERP?',
];

// Mismo criterio que el servidor (route.ts → tituloDesde) para que el título
// provisional en la barra lateral no cambie al recargar.
function tituloDesde(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return 'Nueva conversación';
  return limpio.length > 60 ? limpio.slice(0, 60).trimEnd() + '…' : limpio;
}

interface InteligenciaClientProps {
  nombreUsuario: string;
  conversacionesIniciales: ConversacionResumen[];
  informesIniciales: InformeResumen[];
}

export default function InteligenciaClient({
  nombreUsuario,
  conversacionesIniciales,
  informesIniciales,
}: InteligenciaClientProps) {
  const [vista, setVista] = useState<'chat' | 'informes'>('chat');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [conversaciones, setConversaciones] = useState<ConversacionResumen[]>(conversacionesIniciales);
  const [informes, setInformes] = useState<InformeResumen[]>(informesIniciales);
  const [entrada, setEntrada] = useState('');
  const [cargando, setCargando] = useState(false);
  const [cargandoConversacion, setCargandoConversacion] = useState(false);
  const [actividad, setActividad] = useState<string | null>(null);
  const [sidebarMovilAbierto, setSidebarMovilAbierto] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turnos, actividad]);

  const nuevaConversacion = () => {
    setTurnos([]);
    setConversacionId(null);
    setSidebarMovilAbierto(false);
    setVista('chat');
  };

  const seleccionarConversacion = async (id: string) => {
    setCargandoConversacion(true);
    setSidebarMovilAbierto(false);
    setVista('chat');
    const res = await cargarConversacion(id);
    setCargandoConversacion(false);
    if (!res.success || !res.data) {
      alert(res.error || 'No se pudo cargar la conversación.');
      return;
    }
    setTurnos(res.data.turnos);
    setConversacionId(res.data.id);
  };

  const borrarConversacion = async (id: string) => {
    const res = await eliminarConversacion(id);
    if (!res.success) {
      alert(res.error || 'No se pudo eliminar.');
      return;
    }
    setConversaciones((prev) => prev.filter((c) => c.id !== id));
    if (id === conversacionId) nuevaConversacion();
  };

  const enviar = async (textoManual?: string) => {
    const texto = (textoManual ?? entrada).trim();
    if (!texto || cargando) return;

    const historial: Turno[] = [...turnos, { rol: 'usuario', partes: [{ tipo: 'texto', texto }] }];
    setTurnos([...historial, { rol: 'asesor', partes: [] }]);
    setEntrada('');
    setCargando(true);
    setActividad(null);

    // Variable local (no el estado de React) para no depender de un re-render
    // dentro del mismo bucle de streaming — el evento 'conversacion' llega
    // antes que cualquier 'informe', así que siempre está resuelta a tiempo.
    let conversacionIdActual = conversacionId;

    const actualizarAsesor = (fn: (partes: Turno['partes']) => Turno['partes']) => {
      setTurnos((prev) => {
        const copia = [...prev];
        const ultimo = copia[copia.length - 1];
        copia[copia.length - 1] = { ...ultimo, partes: fn(ultimo.partes) };
        return copia;
      });
    };

    const agregarTexto = (fragmento: string) =>
      actualizarAsesor((partes) => {
        const ultima = partes[partes.length - 1];
        if (ultima && ultima.tipo === 'texto') {
          return [...partes.slice(0, -1), { tipo: 'texto', texto: ultima.texto + fragmento }];
        }
        return [...partes, { tipo: 'texto', texto: fragmento }];
      });

    try {
      const res = await fetch('/api/inteligencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: historial.map((t) => ({ rol: t.rol, texto: textoDeTurno(t) })),
          conversacion_id: conversacionIdActual,
        }),
      });

      if (!res.ok || !res.body) {
        const detalle = await res.json().catch(() => null);
        throw new Error(detalle?.error || `Error ${res.status}`);
      }

      const lector = res.body.getReader();
      const decodificador = new TextDecoder();
      let pendiente = '';

      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        pendiente += decodificador.decode(value, { stream: true });

        const lineas = pendiente.split('\n');
        pendiente = lineas.pop() ?? '';

        for (const linea of lineas) {
          if (!linea.trim()) continue;
          let evento: {
            tipo: string;
            id?: string;
            texto?: string;
            nombre?: string;
            detalle?: string;
            mensaje?: string;
            grafico?: any;
            informe?: any;
          };
          try {
            evento = JSON.parse(linea);
          } catch {
            continue;
          }

          if (evento.tipo === 'conversacion' && evento.id) {
            const esNueva = !conversacionIdActual;
            conversacionIdActual = evento.id;
            setConversacionId(evento.id);
            const idEvento = evento.id;
            setConversaciones((prev) => {
              if (esNueva) {
                return [{ id: idEvento, titulo: tituloDesde(texto), updated_at: new Date().toISOString() }, ...prev];
              }
              const idx = prev.findIndex((c) => c.id === idEvento);
              if (idx <= 0) return prev;
              const copia = [...prev];
              const [item] = copia.splice(idx, 1);
              return [{ ...item, updated_at: new Date().toISOString() }, ...copia];
            });
          } else if (evento.tipo === 'texto' && evento.texto) {
            setActividad(null);
            agregarTexto(evento.texto);
          } else if (evento.tipo === 'grafico' && evento.grafico) {
            setActividad(null);
            const grafico = evento.grafico;
            actualizarAsesor((partes) => [...partes, { tipo: 'grafico', grafico }]);
          } else if (evento.tipo === 'informe' && evento.informe) {
            setActividad(null);
            const informe = evento.informe;
            actualizarAsesor((partes) => [...partes, { tipo: 'informe', informe }]);
            setInformes((prev) => [
              {
                id: informe.id,
                tipo: informe.tipo,
                titulo: informe.titulo,
                resumen: informe.resumen ?? null,
                created_at: informe.created_at,
                conversacion_id: conversacionIdActual,
                usuarios: { nombre_completo: nombreUsuario },
              },
              ...prev,
            ]);
          } else if (evento.tipo === 'herramienta') {
            setActividad(
              evento.nombre === 'consultar_base_datos'
                ? 'Consultando la base de datos de la app…'
                : evento.nombre === 'mostrar_grafico'
                  ? 'Generando gráfico…'
                  : evento.nombre === 'generar_informe'
                    ? 'Redactando informe…'
                    : `Consultando el ERP (${evento.detalle})…`
            );
          } else if (evento.tipo === 'error') {
            agregarTexto(`\n\n⚠️ ${evento.mensaje}`);
          }
        }
      }
    } catch (error) {
      agregarTexto(`\n\n⚠️ ${error instanceof Error ? error.message : 'Error de conexión.'}`);
    } finally {
      setCargando(false);
      setActividad(null);
    }
  };

  const vacio = turnos.length === 0;

  return (
    <div style={styles.contenedor}>
      <div style={styles.encabezado}>
        <button
          className="inteligencia-sidebar-toggle"
          style={styles.menuBtn}
          onClick={() => setSidebarMovilAbierto(true)}
          aria-label="Ver historial de conversaciones"
        >
          <Menu size={20} />
        </button>
        <div style={styles.iconoTitulo}>
          <BrainCircuit size={26} color="var(--primary)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={styles.titulo}>Arriendabot · Asesor BI</h1>
          <p style={styles.subtitulo}>
            Inteligencia comercial en vivo: citas, agenda, inventario, cartera y contratos.
          </p>
        </div>
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tabBtn, ...(vista === 'chat' ? styles.tabBtnActivo : {}) }}
            onClick={() => setVista('chat')}
          >
            <MessagesSquare size={14} />
            Chat
          </button>
          <button
            style={{ ...styles.tabBtn, ...(vista === 'informes' ? styles.tabBtnActivo : {}) }}
            onClick={() => setVista('informes')}
          >
            <LayoutList size={14} />
            Informes
            {informes.length > 0 && <span style={styles.tabContador}>{informes.length}</span>}
          </button>
        </div>
      </div>

      <div
        className={`sidebar-overlay ${sidebarMovilAbierto ? 'active' : ''}`}
        onClick={() => setSidebarMovilAbierto(false)}
      />

      <div className="inteligencia-layout">
        <div className={`inteligencia-sidebar ${sidebarMovilAbierto ? 'open' : ''}`}>
          <ConversacionesSidebar
            conversaciones={conversaciones}
            activaId={conversacionId}
            onSeleccionar={seleccionarConversacion}
            onNueva={nuevaConversacion}
            onEliminar={borrarConversacion}
            deshabilitado={cargando || cargandoConversacion}
          />
        </div>

        <div className="inteligencia-main">
          {vista === 'informes' ? (
            <InformesPanel
              informes={informes}
              onEliminado={(id) => setInformes((prev) => prev.filter((i) => i.id !== id))}
              onVerConversacion={seleccionarConversacion}
            />
          ) : (
            <>
              <div style={styles.zonaChat}>
                {cargandoConversacion ? (
                  <div style={styles.estadoVacio}>
                    <Loader2 size={24} className="animate-spin" color="var(--primary)" />
                  </div>
                ) : vacio ? (
                  <div style={styles.estadoVacio}>
                    <Sparkles size={32} color="var(--primary)" style={{ opacity: 0.6 }} />
                    <p style={styles.saludo}>
                      Hola {nombreUsuario.split(' ')[0]}, pregúntame cómo va el negocio.
                    </p>
                    <div style={styles.sugerencias}>
                      {SUGERENCIAS.map((s) => (
                        <button key={s} style={styles.chip} onClick={() => enviar(s)} disabled={cargando}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={styles.mensajes}>
                    {turnos.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          ...styles.burbuja,
                          ...(t.rol === 'usuario' ? styles.burbujaUsuario : styles.burbujaAsesor),
                        }}
                      >
                        {t.rol === 'asesor' && t.partes.length === 0 && cargando && i === turnos.length - 1 ? (
                          <span style={styles.actividad}>
                            <Loader2 size={14} className="animate-spin" />
                            {actividad ? (
                              <>
                                {actividad.includes('gráfico') ? (
                                  <BarChart3 size={14} />
                                ) : actividad.includes('informe') ? (
                                  <FileText size={14} />
                                ) : actividad.includes('ERP') ? (
                                  <Cloud size={14} />
                                ) : (
                                  <Database size={14} />
                                )}
                                {actividad}
                              </>
                            ) : (
                              'Analizando…'
                            )}
                          </span>
                        ) : (
                          t.partes.map((p, j) =>
                            p.tipo === 'texto' ? (
                              <div key={j} style={styles.textoMensaje}>
                                {renderMarkdown(p.texto)}
                              </div>
                            ) : p.tipo === 'grafico' ? (
                              <GraficoBI key={j} spec={p.grafico} />
                            ) : (
                              <InformeBI key={j} spec={p.informe} />
                            )
                          )
                        )}
                      </div>
                    ))}
                    {cargando && actividad && (turnos[turnos.length - 1]?.partes.length ?? 0) > 0 ? (
                      <div style={{ ...styles.burbuja, ...styles.burbujaAsesor }}>
                        <span style={styles.actividad}>
                          {actividad.includes('gráfico') ? (
                            <BarChart3 size={14} />
                          ) : actividad.includes('informe') ? (
                            <FileText size={14} />
                          ) : actividad.includes('ERP') ? (
                            <Cloud size={14} />
                          ) : (
                            <Database size={14} />
                          )}
                          {actividad}
                        </span>
                      </div>
                    ) : null}
                    <div ref={finRef} />
                  </div>
                )}
              </div>

              <div style={styles.zonaEntrada}>
                <input
                  style={styles.entrada}
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  placeholder="Pregunta sobre citas, inventario, cartera, contratos…"
                  disabled={cargando || cargandoConversacion}
                />
                <button
                  style={{ ...styles.botonEnviar, opacity: cargando || !entrada.trim() ? 0.5 : 1 }}
                  onClick={() => enviar()}
                  disabled={cargando || !entrada.trim()}
                  title="Enviar"
                >
                  {cargando ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  contenedor: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100dvh - 5rem)',
    gap: '1rem',
  },
  encabezado: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.9rem',
  },
  menuBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  iconoTitulo: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  titulo: {
    fontSize: '1.4rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    margin: 0,
  },
  subtitulo: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabs: {
    display: 'flex',
    gap: '0.35rem',
    flexShrink: 0,
    backgroundColor: 'var(--bg-secondary)',
    padding: '0.25rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
  },
  tabBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabBtnActivo: {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--primary)',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  },
  tabContador: {
    fontSize: '0.65rem',
    fontWeight: 700,
    backgroundColor: 'rgba(0, 171, 216, 0.12)',
    color: 'var(--primary)',
    borderRadius: '999px',
    padding: '0.05rem 0.4rem',
  },
  zonaChat: {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius, 12px)',
    padding: '1.25rem',
  },
  estadoVacio: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    textAlign: 'center',
  },
  saludo: {
    fontSize: '1rem',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  sugerencias: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '0.5rem',
    maxWidth: '640px',
  },
  chip: {
    padding: '0.5rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-main)',
    color: 'var(--text-secondary)',
    fontSize: '0.82rem',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  mensajes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  burbuja: {
    maxWidth: '85%',
    padding: '0.75rem 1rem',
    borderRadius: '12px',
    fontSize: '0.9rem',
    lineHeight: 1.55,
  },
  burbujaUsuario: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    color: 'var(--text-primary)',
  },
  burbujaAsesor: {
    alignSelf: 'flex-start',
    backgroundColor: 'var(--bg-main)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  },
  textoMensaje: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  actividad: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
  },
  zonaEntrada: {
    display: 'flex',
    gap: '0.5rem',
  },
  entrada: {
    flex: 1,
    padding: '0.8rem 1rem',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
    outline: 'none',
  },
  botonEnviar: {
    width: '46px',
    borderRadius: 'var(--border-radius-sm, 8px)',
    border: 'none',
    backgroundColor: 'var(--primary)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
};
