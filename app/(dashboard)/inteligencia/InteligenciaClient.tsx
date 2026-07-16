'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Send, Loader2, Database, Cloud, Sparkles } from 'lucide-react';

interface Turno {
  rol: 'usuario' | 'asesor';
  texto: string;
}

const SUGERENCIAS = [
  'Genera el brief del día',
  '¿Cómo van las citas esta semana vs. la anterior?',
  '¿Cuánta cartera vencida tenemos y quiénes son los mayores deudores?',
  '¿Qué inventario disponible tenemos por tipo y precio promedio?',
  '¿Hay discrepancias entre la app y el ERP?',
];

// Render mínimo de markdown (negritas, títulos y listas) sin dependencias.
function renderTexto(texto: string): React.ReactNode {
  const conNegritas = (linea: string, key: number) => {
    const partes = linea.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={key}>
        {partes.map((p, i) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p
        )}
      </React.Fragment>
    );
  };

  return texto.split('\n').map((linea, i) => {
    if (/^#{1,4}\s/.test(linea)) {
      return (
        <div key={i} style={{ fontWeight: 700, marginTop: '0.75rem', marginBottom: '0.25rem' }}>
          {conNegritas(linea.replace(/^#{1,4}\s/, ''), i)}
        </div>
      );
    }
    if (/^\s*[-*]\s/.test(linea)) {
      return (
        <div key={i} style={{ paddingLeft: '1rem', display: 'flex', gap: '0.5rem' }}>
          <span>•</span>
          <span>{conNegritas(linea.replace(/^\s*[-*]\s/, ''), i)}</span>
        </div>
      );
    }
    if (/^\s*\d+\.\s/.test(linea)) {
      return (
        <div key={i} style={{ paddingLeft: '1rem' }}>
          {conNegritas(linea, i)}
        </div>
      );
    }
    return <div key={i}>{linea ? conNegritas(linea, i) : <br />}</div>;
  });
}

export default function InteligenciaClient({ nombreUsuario }: { nombreUsuario: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [entrada, setEntrada] = useState('');
  const [cargando, setCargando] = useState(false);
  const [actividad, setActividad] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turnos, actividad]);

  const enviar = async (textoManual?: string) => {
    const texto = (textoManual ?? entrada).trim();
    if (!texto || cargando) return;

    const historial: Turno[] = [...turnos, { rol: 'usuario', texto }];
    setTurnos([...historial, { rol: 'asesor', texto: '' }]);
    setEntrada('');
    setCargando(true);
    setActividad(null);

    const actualizarAsesor = (fn: (previo: string) => string) => {
      setTurnos((prev) => {
        const copia = [...prev];
        const ultimo = copia[copia.length - 1];
        copia[copia.length - 1] = { ...ultimo, texto: fn(ultimo.texto) };
        return copia;
      });
    };

    try {
      const res = await fetch('/api/inteligencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: historial }),
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
          let evento: { tipo: string; texto?: string; nombre?: string; detalle?: string; mensaje?: string };
          try {
            evento = JSON.parse(linea);
          } catch {
            continue;
          }
          if (evento.tipo === 'texto' && evento.texto) {
            setActividad(null);
            actualizarAsesor((previo) => previo + evento.texto);
          } else if (evento.tipo === 'herramienta') {
            setActividad(
              evento.nombre === 'consultar_base_datos'
                ? 'Consultando la base de datos de la app…'
                : `Consultando el ERP (${evento.detalle})…`
            );
          } else if (evento.tipo === 'error') {
            actualizarAsesor((previo) => previo + (previo ? '\n\n' : '') + `⚠️ ${evento.mensaje}`);
          }
        }
      }
    } catch (error) {
      actualizarAsesor(
        (previo) =>
          previo + (previo ? '\n\n' : '') + `⚠️ ${error instanceof Error ? error.message : 'Error de conexión.'}`
      );
    } finally {
      setCargando(false);
      setActividad(null);
    }
  };

  const vacio = turnos.length === 0;

  return (
    <div style={styles.contenedor}>
      <div style={styles.encabezado}>
        <div style={styles.iconoTitulo}>
          <BrainCircuit size={26} color="var(--primary)" />
        </div>
        <div>
          <h1 style={styles.titulo}>Cumbre · Asesor BI</h1>
          <p style={styles.subtitulo}>
            Inteligencia comercial en vivo: citas, agenda, inventario, cartera y contratos.
          </p>
        </div>
      </div>

      <div style={styles.zonaChat}>
        {vacio ? (
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
                {t.rol === 'asesor' && !t.texto && cargando && i === turnos.length - 1 ? (
                  <span style={styles.actividad}>
                    <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                    {actividad ? (
                      <>
                        {actividad.includes('ERP') ? <Cloud size={14} /> : <Database size={14} />}
                        {actividad}
                      </>
                    ) : (
                      'Analizando…'
                    )}
                  </span>
                ) : (
                  <div style={styles.textoMensaje}>{renderTexto(t.texto)}</div>
                )}
              </div>
            ))}
            {cargando && actividad && turnos[turnos.length - 1]?.texto ? (
              <div style={{ ...styles.burbuja, ...styles.burbujaAsesor }}>
                <span style={styles.actividad}>
                  {actividad.includes('ERP') ? <Cloud size={14} /> : <Database size={14} />}
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
          disabled={cargando}
        />
        <button
          style={{ ...styles.botonEnviar, opacity: cargando || !entrada.trim() ? 0.5 : 1 }}
          onClick={() => enviar()}
          disabled={cargando || !entrada.trim()}
          title="Enviar"
        >
          {cargando ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} />}
        </button>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
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
