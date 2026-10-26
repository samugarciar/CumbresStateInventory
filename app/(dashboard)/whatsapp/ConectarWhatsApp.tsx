'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Lock, MessageCircle, PlugZap } from 'lucide-react';
import {
  CONFIG_REGISTRO_ID,
  META_APP_ID,
  VERSION_SDK,
  esEmbudoConectable,
  leerEventoRegistro,
  requiereConfirmacionCorte,
  type EventoRegistro,
} from '@/lib/whatsapp/registro-integrado';

export interface EmbudoVista {
  codigo: string;
  etiqueta: string;
  bot_atiende: boolean;
}

export interface LineaVista {
  embudo: string;
  nombre: string | null;
  telefono_e164: string | null;
  modo: string | null;
  conectada_at: string | null;
  token_invalido_at: string | null;
  historial_solicitado_at: string | null;
  historial_progreso: number | null;
  historial_completado_at: string | null;
  historial_error_codigo: number | null;
  historial_error: string | null;
}

/**
 * Cómo va el historial del celular de una línea conectada. Meta lo manda
 * por lotes después de pedirlo; 2593109 es que el negocio apagó compartir
 * el historial en la app, no un fallo nuestro.
 */
function textoHistorial(l: LineaVista): string | null {
  if (!l.conectada_at || l.modo !== 'coexistencia') return null;
  if (l.historial_completado_at) return 'Historial del celular: completo.';
  if (l.historial_error_codigo === 2593109) {
    return 'Historial del celular: el negocio no lo compartió (está apagado en la app).';
  }
  if (l.historial_error_codigo !== null || l.historial_error) {
    return `Historial del celular: Meta respondió un error${l.historial_error_codigo ? ` (${l.historial_error_codigo})` : ''}.`;
  }
  if (l.historial_solicitado_at) {
    return `Historial del celular: llegando, ${l.historial_progreso ?? 0} %.`;
  }
  return 'Historial del celular: no se pidió.';
}

/** Lo justo del SDK de Facebook que se usa aquí. */
interface SdkFacebook {
  init(opciones: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(
    alTerminar: (respuesta: { authResponse?: { code?: string } | null; status?: string }) => void,
    opciones: Record<string, unknown>
  ): void;
}

declare global {
  interface Window {
    FB?: SdkFacebook;
  }
}

type Resultado =
  | { tipo: 'ok'; texto: string }
  | { tipo: 'cancelado'; texto: string }
  | { tipo: 'error'; texto: string; detalle?: string | null };

type ModoConexion = 'coexistencia' | 'cloud_api';

const fecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

/** Cómo está conectada la línea, en palabras del equipo. */
function insigniaModo(modo: string | null): { texto: string; titulo: string } | null {
  if (modo === 'cloud_api') {
    return { texto: 'Solo plataforma (API)', titulo: 'El número vive en la Cloud API de Meta: se atiende desde la plataforma y el CRM, no desde la app del celular.' };
  }
  if (modo === 'coexistencia') {
    return { texto: 'App del celular + plataforma', titulo: 'El número sigue en la app de WhatsApp Business del celular y los mensajes llegan también a la plataforma.' };
  }
  return null;
}

/** Espera hasta `ms` a que la ventana mande su evento de fin. */
function esperarEvento(ref: React.RefObject<EventoRegistro | null>, ms: number) {
  return new Promise<EventoRegistro | null>((resolver) => {
    const inicio = Date.now();
    const mirar = () => {
      if (ref.current || Date.now() - inicio >= ms) return resolver(ref.current);
      setTimeout(mirar, 100);
    };
    mirar();
  });
}

async function llamarServidor(cuerpo: Record<string, unknown>) {
  const r = await fetch('/api/whatsapp/registro-integrado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return r.json().catch(() => ({ ok: false, error: `El servidor respondió ${r.status}` }));
}

export default function ConectarWhatsApp({
  embudos,
  lineas,
  embudoPedido,
  esRevisor = false,
}: {
  embudos: EmbudoVista[];
  lineas: LineaVista[];
  embudoPedido: string | null;
  /** La cuenta del revisor de Meta no ve las notas internas de la operación. */
  esRevisor?: boolean;
}) {
  const router = useRouter();
  const [sdkListo, setSdkListo] = useState(false);
  const [sdkFallo, setSdkFallo] = useState(false);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [confirmandoCorte, setConfirmandoCorte] = useState<string | null>(null);
  // Embudo que espera confirmar un número nuevo solo en la Cloud API.
  const [confirmandoSoloApi, setConfirmandoSoloApi] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, Resultado | undefined>>({});
  const iniciado = useRef(false);
  // El último evento de la ventana de Meta. Llega por `postMessage`, aparte
  // de la respuesta de FB.login y sin orden garantizado entre los dos.
  const evento = useRef<EventoRegistro | null>(null);

  useEffect(() => {
    const escuchar = (e: MessageEvent) => {
      const leido = leerEventoRegistro(e.origin, e.data);
      if (leido) evento.current = leido;
    };
    window.addEventListener('message', escuchar);
    return () => window.removeEventListener('message', escuchar);
  }, []);

  function iniciarSdk() {
    if (iniciado.current || !window.FB) return;
    window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: VERSION_SDK });
    iniciado.current = true;
    setSdkListo(true);
  }

  function anotar(embudo: string, resultado: Resultado) {
    setResultados((previos) => ({ ...previos, [embudo]: resultado }));
  }

  async function terminar(
    embudo: string,
    code: string | undefined,
    confirmacionCorte = false,
    modo: ModoConexion = 'coexistencia'
  ) {
    try {
      if (code) {
        // El código vence a los 30 segundos. Se le da un segundo al evento
        // para que traiga el waba_id; si no llega, el servidor lo saca de
        // los permisos del token.
        const fin = await esperarEvento(evento, 1000);
        const r = await llamarServidor({
          accion: 'conectar',
          embudo,
          modo,
          confirmacion_corte: confirmacionCorte,
          code,
          waba_id: fin?.tipo === 'fin' ? fin.wabaId : undefined,
          phone_number_id: fin?.tipo === 'fin' ? fin.phoneNumberId : undefined,
        });
        if (r?.ok) {
          const l = r.linea ?? {};
          const historial = r.historial?.pedido
            ? ' El historial del celular ya se pidió a Meta y va llegando.'
            : r.historial
              ? ` El historial no se pudo pedir: ${r.historial.error}.`
              : '';
          anotar(embudo, {
            tipo: 'ok',
            texto: `Conectada: ${l.telefono ?? 'número sin leer'}${l.nombre ? ` · ${l.nombre}` : ''}.${historial}`,
          });
          router.refresh();
        } else {
          anotar(embudo, { tipo: 'error', texto: r?.error ?? 'No se pudo conectar.', detalle: r?.detalle });
        }
        return;
      }

      // Sin código: la persona cerró la ventana, o Meta falló por dentro.
      // Sin apuro aquí, así que se espera un poco más al evento.
      const ultimo = await esperarEvento(evento, 1500);
      const esError = ultimo?.tipo === 'error';
      await llamarServidor({
        accion: esError ? 'error' : 'cancelar',
        embudo,
        codigo: esError ? ultimo.codigo : undefined,
        datos:
          ultimo && ultimo.tipo !== 'fin'
            ? ultimo.datos
            : { motivo: 'La ventana se cerró sin que Meta mandara un evento' },
      });
      anotar(
        embudo,
        esError
          ? {
              tipo: 'error',
              texto: 'Meta devolvió un error dentro de la ventana. Quedó anotado.',
              detalle: typeof ultimo.datos.error_message === 'string' ? ultimo.datos.error_message : null,
            }
          : { tipo: 'cancelado', texto: 'Se cerró la ventana sin conectar. Quedó anotado.' }
      );
    } catch {
      anotar(embudo, { tipo: 'error', texto: 'Se perdió la conexión con la plataforma. Vuelve a intentarlo.' });
    } finally {
      setEnCurso(null);
    }
  }

  function iniciarConexion(embudo: string) {
    if (requiereConfirmacionCorte(embudo)) {
      setConfirmandoCorte(embudo);
      return;
    }
    conectar(embudo, false);
  }

  function conectar(embudo: string, confirmacionCorte = false, modo: ModoConexion = 'coexistencia') {
    if (!window.FB || enCurso) return;
    evento.current = null;
    setEnCurso(embudo);
    setResultados((previos) => ({ ...previos, [embudo]: undefined }));
    // FB.login no admite una función async: se llama a una aparte.
    window.FB.login(
      (respuesta) => {
        void terminar(embudo, respuesta?.authResponse?.code ?? undefined, confirmacionCorte, modo);
      },
      {
        config_id: CONFIG_REGISTRO_ID,
        response_type: 'code',
        override_default_response_type: true,
        // Coexistencia: el número sigue en la app del celular. Solo API: el
        // registro de siempre, con un número que deja la app.
        extras:
          modo === 'coexistencia'
            ? { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }
            : { setup: {}, sessionInfoVersion: '3' },
      }
    );
  }

  // El número que la comercial tiene hoy, para decirlo antes de reemplazarlo.
  const telefonoComercial = lineas.find((l) => requiereConfirmacionCorte(l.embudo))?.telefono_e164 ?? null;
  // El aviso técnico del webhook solo importa si queda algo por conectar.
  const haySinConectar = embudos.some((e) => !lineas.find((l) => l.embudo === e.codigo)?.conectada_at);

  return (
    <div style={styles.pagina}>
      <Script
        id="facebook-jssdk"
        src="https://connect.facebook.net/es_LA/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onReady={iniciarSdk}
        onError={() => setSdkFallo(true)}
      />

      <header style={styles.cabecera}>
        <h1 style={styles.titulo}>
          <MessageCircle size={24} /> WhatsApp
        </h1>
        <p style={styles.bajada}>Aquí se conectan los números de WhatsApp de cada embudo.</p>
      </header>

      {!esRevisor && haySinConectar && (
        <details style={styles.aviso}>
          <summary style={styles.avisoResumen}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            Antes de conectar un número real
          </summary>
          <div style={{ marginTop: 8 }}>
            El webhook de la app de Meta tiene que estar configurado y suscrito a <code>messages</code>,{' '}
            <code>history</code> y <code>smb_message_echoes</code>. Al conectar, la plataforma pide el historial
            del celular, y Meta solo deja pedirlo una vez y en las primeras 24 horas: si el webhook no está, ese
            historial se pierde.
          </div>
        </details>
      )}

      {sdkFallo && (
        <p style={styles.error}>No cargó la ventana de Meta. Revisa la conexión o un bloqueador de anuncios y recarga.</p>
      )}

      <ul style={styles.lista}>
        {embudos.map((e) => {
          const linea = lineas.find((l) => l.embudo === e.codigo) ?? null;
          const conectable = esEmbudoConectable(e.codigo);
          const resultado = resultados[e.codigo];
          const ocupado = enCurso === e.codigo;
          const conectada = Boolean(linea?.conectada_at);
          const tokenCaido = Boolean(linea?.token_invalido_at);
          const modo = insigniaModo(linea?.modo ?? null);
          // «Reconectar…» abre el flujo de coexistencia: no les corresponde a las líneas solo API.
          const puedeReconectar = linea?.modo !== 'cloud_api';

          return (
            <li
              key={e.codigo}
              style={{ ...styles.tarjeta, ...(embudoPedido === e.codigo ? styles.tarjetaPedida : {}) }}
            >
              <div style={styles.fila}>
                <div style={{ minWidth: 0 }}>
                  <h2 style={styles.embudo}>{e.etiqueta}</h2>
                  <p style={styles.estado}>
                    {tokenCaido ? (
                      <span className="badge badge-danger">Meta rechazó el token: hay que reconectar</span>
                    ) : conectada ? (
                      <>
                        <span className="badge badge-success">Conectada</span>{' '}
                        {modo && (
                          <>
                            <span className="badge" style={styles.insigniaModo} title={modo.titulo}>{modo.texto}</span>{' '}
                          </>
                        )}
                        <span style={{ whiteSpace: 'nowrap' }}>
                          {linea?.telefono_e164 ?? 'sin teléfono'} · desde {fecha.format(new Date(linea!.conectada_at!))}
                        </span>
                      </>
                    ) : linea ? (
                      <span className="badge badge-info">Registrada a mano, sin el registro integrado</span>
                    ) : (
                      <span className="badge badge-warning">Sin conectar</span>
                    )}
                  </p>
                </div>

                {conectable ? (
                  <div style={styles.botones}>
                  {conectada && !tokenCaido ? (
                    // Conectada: reconectar es raro, así que queda como enlace secundario
                    puedeReconectar && (
                      <button
                        type="button"
                        className="wa-reconectar"
                        onClick={() => iniciarConexion(e.codigo)}
                        disabled={!sdkListo || enCurso !== null}
                        style={styles.reconectar}
                      >
                        {ocupado ? <Loader2 size={14} className="animate-spin" /> : null}
                        {ocupado ? 'Esperando a Meta…' : 'Reconectar…'}
                      </button>
                    )
                  ) : (conectada && !puedeReconectar) ? null : (
                    <button
                      className="btn btn-primary"
                      onClick={() => iniciarConexion(e.codigo)}
                      disabled={!sdkListo || enCurso !== null}
                      style={styles.boton}
                    >
                      {ocupado ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
                      {ocupado ? 'Esperando a Meta…' : conectada ? 'Reconectar' : 'Conectar con WhatsApp'}
                    </button>
                  )}
                  {!esRevisor && !conectada && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setConfirmandoSoloApi(e.codigo)}
                      disabled={!sdkListo || enCurso !== null}
                      style={styles.boton}
                      title="Un número nuevo que vive solo en la Cloud API, sin la app del celular"
                    >
                      Número nuevo (solo API)
                    </button>
                  )}
                  </div>
                ) : (
                  <span style={styles.bloqueado} title="Atiende clientes reales: se conecta de última">
                    <Lock size={14} /> Se conecta de última
                  </span>
                )}
              </div>

              {requiereConfirmacionCorte(e.codigo) && (
                <p style={styles.nota}>
                  {conectada
                    ? `Esta línea atiende clientes reales y el bot comercial contesta por ella.${puedeReconectar ? ' Reconectarla exige confirmación explícita.' : ''}`
                    : 'Esta línea atiende clientes reales. Conectarla exige confirmación explícita.'}
                </p>
              )}

              {!conectable && (
                <p style={styles.nota}>
                  Esta línea atiende clientes reales. Se conecta al final, cuando las otras dos lleven días
                  estables.
                </p>
              )}

              {linea && textoHistorial(linea) && <p style={styles.nota}>{textoHistorial(linea)}</p>}

              {resultado && (
                <p
                  style={
                    resultado.tipo === 'ok' ? styles.exito : resultado.tipo === 'error' ? styles.error : styles.nota
                  }
                >
                  {resultado.tipo === 'ok' && <CheckCircle2 size={16} style={{ verticalAlign: '-3px' }} />}{' '}
                  {resultado.texto}
                  {resultado.tipo === 'error' && resultado.detalle ? (
                    <span style={styles.detalle}> Meta dijo: «{resultado.detalle}»</span>
                  ) : null}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {!sdkListo && !sdkFallo && <p style={styles.nota}>Cargando la ventana de Meta…</p>}

      {confirmandoSoloApi && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="modal-solo-api-titulo">
            <div style={styles.modalHeader}>
              <AlertTriangle size={24} style={{ color: '#eab308', flexShrink: 0 }} />
              <h2 id="modal-solo-api-titulo" style={styles.modalTitulo}>
                ¿Conectar un número nuevo solo en la API?
              </h2>
            </div>
            <p style={styles.modalTexto}>
              El número queda registrado en la Cloud API de Meta y <strong>deja de funcionar en la app de
              WhatsApp del celular</strong>: se atiende solo desde la plataforma y el CRM. No trae historial.
              {requiereConfirmacionCorte(confirmandoSoloApi) &&
                ' En la comercial, el bot de la plataforma contesta por este número.'}
            </p>
            <p style={styles.modalTextoSecundario}>
              <strong>Antes de continuar:</strong> si el número tiene una cuenta en la app de WhatsApp o de
              WhatsApp Business, bórrala en el celular (<em>Configuración &gt; Cuenta &gt; Eliminar cuenta</em>).
              En la ventana de Meta elige <em>crear un número nuevo</em> y verifícalo por SMS o llamada.
            </p>
            <div style={styles.modalAcciones}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmandoSoloApi(null)}
                style={styles.modalBoton}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const emb = confirmandoSoloApi;
                  setConfirmandoSoloApi(null);
                  conectar(emb, requiereConfirmacionCorte(emb), 'cloud_api');
                }}
                style={styles.modalBoton}
              >
                Sí, conectar solo API
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoCorte && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="modal-corte-titulo">
            <div style={styles.modalHeader}>
              <AlertTriangle size={24} style={{ color: '#eab308', flexShrink: 0 }} />
              <h2 id="modal-corte-titulo" style={styles.modalTitulo}>
                ¿Conectar la línea comercial por coexistencia?
              </h2>
            </div>
            <p style={styles.modalTexto}>
              La línea comercial
              {telefonoComercial ? ` (hoy ${telefonoComercial})` : ''} atiende clientes reales y el bot
              comercial contesta por ella. Al continuar, el número que conectes en la ventana de Meta
              reemplaza al de la línea, y se pide a Meta el historial del celular.
            </p>
            <p style={styles.modalTextoSecundario}>
              <strong>Asegúrate antes de continuar:</strong> el número nuevo es el que va a atender ventas.
              Quien le escriba al número anterior deja de llegar a la plataforma y al CRM.
            </p>
            <div style={styles.modalAcciones}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmandoCorte(null)}
                style={styles.modalBoton}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const emb = confirmandoCorte;
                  setConfirmandoCorte(null);
                  conectar(emb, true);
                }}
                style={styles.modalBoton}
              >
                Sí, iniciar corte y conectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pagina: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
  cabecera: { display: 'flex', flexDirection: 'column', gap: 6 },
  titulo: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: 0 },
  bajada: { color: 'var(--text-secondary)', fontSize: 14.5, maxWidth: '64ch', margin: 0 },
  aviso: {
    padding: '10px 14px',
    borderRadius: 'var(--border-radius-md)',
    background: 'rgba(234, 179, 8, 0.08)',
    border: '1px solid rgba(234, 179, 8, 0.3)',
    color: 'var(--text-primary)',
    fontSize: 14,
  },
  avisoResumen: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 },
  insigniaModo: {
    background: 'var(--bg-surface-elevated)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-color)',
    padding: '0.15rem 0.6rem',
  },
  reconectar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    color: 'var(--primary)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '6px 4px',
  },
  lista: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  tarjeta: {
    padding: 16,
    borderRadius: 'var(--border-radius-md)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  tarjetaPedida: { borderColor: 'var(--primary)', boxShadow: '0 0 0 3px rgba(0, 171, 216, 0.12)' },
  fila: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  embudo: { fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' },
  estado: { margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' },
  boton: { display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' },
  botones: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  bloqueado: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' },
  nota: { margin: 0, fontSize: 13, color: 'var(--text-secondary)' },
  exito: { margin: 0, fontSize: 13.5, color: 'var(--primary)', fontWeight: 600 },
  error: { margin: 0, fontSize: 13.5, color: 'var(--danger)' },
  detalle: { color: 'var(--text-secondary)' },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modalCard: {
    backgroundColor: 'var(--bg-surface, #ffffff)',
    border: '1px solid var(--border-color, #e5e7eb)',
    borderRadius: 'var(--border-radius-lg, 12px)',
    maxWidth: 540,
    width: '100%',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  modalTitulo: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  modalTexto: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: 'var(--text-primary)',
  },
  modalTextoSecundario: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(234, 179, 8, 0.08)',
    padding: '10px 12px',
    borderRadius: 'var(--border-radius-sm, 6px)',
    border: '1px solid rgba(234, 179, 8, 0.25)',
  },
  modalAcciones: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  modalBoton: {
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: 600,
  },
};
