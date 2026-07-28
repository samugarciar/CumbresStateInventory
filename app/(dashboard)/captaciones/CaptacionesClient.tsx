'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Handshake, Plus, Loader2, Check, X, MessageCircle, Phone, MapPin, Link2,
  UserCheck, AlertTriangle, Clock, ExternalLink, Send, Ban,
} from 'lucide-react';
import {
  agregarProspecto, aprobarContacto, rechazarProspecto,
  cambiarEstadoProspecto, registrarSeguimiento, guardarTelefono, marcarNoContactar,
  type EstadoProspecto,
} from '@/app/actions/captaciones';

export interface Prospecto {
  id: string;
  fuente: string;
  url: string | null;
  titulo: string | null;
  tipo_inmueble: string | null;
  tipo_transaccion: string | null;
  ciudad: string | null;
  barrio: string | null;
  precio: number | null;
  area_m2: number | null;
  habitaciones: number | null;
  banos: number | null;
  es_dueno_directo: boolean | null;
  confianza_particular: number | null;
  score: number | null;
  motivos: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_perfil: string | null;
  canal: string | null;
  mensaje_borrador: string | null;
  estado: string;
  proximo_seguimiento: string | null;
  n_seguimientos: number;
  fecha_contacto: string | null;
  created_at: string;
}

interface Props {
  porAprobar: Prospecto[];
  enSeguimiento: Prospecto[];
  captados: number;
  descartados: number;
  hoy: string;
  /** Mensaje si la consulta falló: sin esto, un error se ve igual que "no hay prospectos". */
  errorCarga?: string | null;
}

/**
 * Link de WhatsApp con el mensaje ya escrito: el agente NO envía nada, el
 * humano abre el chat, revisa y presiona enviar. Colombia es +57 y los
 * celulares tienen 10 dígitos empezando por 3.
 */
function linkWhatsApp(telefono: string, mensaje: string): string {
  const d = telefono.replace(/\D/g, '');
  const numero = d.length === 10 && d.startsWith('3') ? `57${d}` : d;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

function precioCorto(v: number | null): string {
  if (v == null) return 'sin precio';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })}M`;
  return `$${v.toLocaleString('es-CO')}`;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  contactado: 'Contactado',
  en_conversacion: 'En conversación',
  cita: 'Cita',
  captado: 'Captado',
  descartado: 'Descartado',
};

export default function CaptacionesClient({ porAprobar, enSeguimiento, captados, descartados, hoy, errorCarga }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [texto, setTexto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [mensajes, setMensajes] = useState<Record<string, string>>({});
  const [procesando, setProcesando] = useState<string | null>(null);
  const [telefonos, setTelefonos] = useState<Record<string, string>>({});

  const mensajeDe = (p: Prospecto) => mensajes[p.id] ?? p.mensaje_borrador ?? '';

  const agregar = async () => {
    if (!url.trim() && !texto.trim()) {
      setAviso({ tipo: 'error', texto: 'Pega la URL del anuncio o el texto de la publicación.' });
      return;
    }
    setAgregando(true);
    setAviso(null);
    const r = await agregarProspecto({ url, texto, contacto_telefono: telefono });
    setAgregando(false);
    if (!r.success) {
      setAviso({ tipo: 'error', texto: r.error });
      return;
    }
    setAviso({ tipo: 'ok', texto: r.message });
    setUrl(''); setTexto(''); setTelefono('');
    router.refresh();
  };

  const aprobar = async (p: Prospecto) => {
    const mensaje = mensajeDe(p).trim();
    if (!mensaje) { alert('El mensaje no puede quedar vacío.'); return; }
    setProcesando(p.id);
    const r = await aprobarContacto({ prospecto_id: p.id, mensaje_final: mensaje });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  const anadirTelefono = async (p: Prospecto) => {
    const tel = (telefonos[p.id] ?? '').trim();
    if (!tel) return;
    setProcesando(p.id);
    const r = await guardarTelefono({ prospecto_id: p.id, telefono: tel });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  const rechazar = async (p: Prospecto) => {
    if (!confirm('¿Descartar este prospecto? No se contactará.')) return;
    setProcesando(p.id);
    const r = await rechazarProspecto({ prospecto_id: p.id });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  const noContactar = async (p: Prospecto) => {
    if (!confirm('¿El propietario pidió no ser contactado?\n\nQuedará excluido para siempre: no volverá a entrar a la bandeja aunque publique otro inmueble.')) return;
    setProcesando(p.id);
    const r = await marcarNoContactar({ prospecto_id: p.id });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  const mover = async (p: Prospecto, estado: EstadoProspecto) => {
    setProcesando(p.id);
    const r = await cambiarEstadoProspecto({ prospecto_id: p.id, estado });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  const seguimiento = async (p: Prospecto) => {
    setProcesando(p.id);
    const r = await registrarSeguimiento({ prospecto_id: p.id });
    setProcesando(null);
    if (!r.success) { alert(r.error); return; }
    router.refresh();
  };

  return (
    <div>
      <div className="responsive-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={styles.titulo}>
            <Handshake size={28} color="var(--primary)" />
            Captaciones
          </h1>
          <p style={styles.subtitulo}>
            Anuncios de dueños directos: el agente los califica y redacta el primer mensaje. Tú apruebas y envías.
          </p>
        </div>
      </div>

      {errorCarga && (
        <div className="glass-card" style={styles.errorBanner}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            <strong>No se pudieron cargar los prospectos.</strong> La bandeja puede verse vacía aunque haya
            prospectos guardados. Detalle: <code>{errorCarga}</code>
          </span>
        </div>
      )}

      {/* ============ Agregar anuncio ============ */}
      <div className="glass-card" style={styles.card}>
        <div style={styles.cardHeader}>
          <Plus size={18} color="var(--primary)" />
          <span style={styles.cardTitulo}>Agregar anuncio</span>
          <span style={styles.cardHint}>
            Pega la URL (Mercado Libre, Facebook Marketplace, portales) y/o el texto de la publicación
          </span>
        </div>
        <div style={styles.formGrid}>
          <input
            className="form-input"
            style={styles.input}
            placeholder="https://... (URL del anuncio)"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={agregando}
          />
          <input
            className="form-input"
            style={{ ...styles.input, maxWidth: '200px' }}
            placeholder="Teléfono (opcional)"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            disabled={agregando}
          />
        </div>
        <textarea
          className="form-input"
          style={styles.textarea}
          rows={3}
          placeholder="Texto del anuncio (pégalo si la URL no trae los datos, p. ej. de Facebook)"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          disabled={agregando}
        />
        <div style={styles.formPie}>
          <button className="btn btn-primary" style={styles.btn} onClick={agregar} disabled={agregando}>
            {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {agregando ? 'Calificando…' : 'Calificar y agregar'}
          </button>
          {aviso && (
            <span style={{ ...styles.aviso, color: aviso.tipo === 'ok' ? '#16a34a' : '#ef4444' }}>
              {aviso.tipo === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {aviso.texto}
            </span>
          )}
        </div>
      </div>

      {/* ============ Resumen ============ */}
      <div style={styles.statsFila}>
        <div style={styles.statChip}><strong>{porAprobar.length}</strong> por aprobar</div>
        <div style={styles.statChip}><strong>{enSeguimiento.length}</strong> en seguimiento</div>
        <div style={styles.statChip}><strong>{captados}</strong> captados</div>
        <div style={styles.statChipMudo}><strong>{descartados}</strong> descartados</div>
      </div>

      {/* ============ Por aprobar ============ */}
      <h2 style={styles.seccionTitulo}>Por aprobar</h2>
      {porAprobar.length === 0 ? (
        <div className="glass-card" style={styles.vacio}>
          No hay prospectos esperando aprobación. Agrega un anuncio arriba para empezar.
        </div>
      ) : (
        porAprobar.map(p => {
          const mensaje = mensajeDe(p);
          const ocupado = procesando === p.id;
          return (
            <div key={p.id} className="glass-card" style={styles.prospecto}>
              <div style={styles.pHeader}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.pTitulo}>{p.titulo || '(anuncio sin título)'}</div>
                  <div style={styles.pMeta}>
                    <span><MapPin size={12} /> {[p.barrio, p.ciudad].filter(Boolean).join(', ') || 'sin ubicación'}</span>
                    <span>{precioCorto(p.precio)}</span>
                    {p.area_m2 != null && <span>{p.area_m2} m²</span>}
                    {p.habitaciones != null && <span>{p.habitaciones} hab</span>}
                    <span style={styles.fuenteBadge}>{p.fuente}</span>
                  </div>
                </div>
                <div style={styles.pBadges}>
                  {/* Los que no llegan al umbral ya no entran a la bandeja, así
                      que aquí prácticamente todo es dueño directo; se muestra el
                      porcentaje para poder priorizar dentro de la cola. */}
                  {p.es_dueno_directo === true && (
                    <span style={styles.badgeDueno}>
                      <UserCheck size={11} />
                      {p.confianza_particular != null
                        ? ` ${Math.round(p.confianza_particular * 100)}% dueño directo`
                        : ' Dueño directo'}
                    </span>
                  )}
                  {p.es_dueno_directo === false && (
                    <span style={styles.badgeAgencia}>
                      <AlertTriangle size={11} /> Posible agencia
                      {p.confianza_particular != null && ` (${Math.round(p.confianza_particular * 100)}%)`}
                    </span>
                  )}
                  {p.score != null && (
                    <span style={styles.badgeScore}>{Math.round(p.score * 100)}%</span>
                  )}
                </div>
              </div>

              {p.motivos && <div style={styles.motivos}>{p.motivos}</div>}

              <div style={styles.contactoFila}>
                {p.contacto_telefono && <span><Phone size={12} /> {p.contacto_telefono}</span>}
                {p.contacto_nombre && <span>{p.contacto_nombre}</span>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                    <Link2 size={12} /> ver anuncio <ExternalLink size={10} />
                  </a>
                )}
              </div>

              {/* En Mercado Libre el número está detrás de un reCAPTCHA: no se
                  puede extraer automáticamente. Se abre el anuncio, se revela
                  con un clic y se pega aquí. */}
              {!p.contacto_telefono && (
                <div style={styles.telefonoFila}>
                  <span style={styles.telefonoHint}>
                    <AlertTriangle size={12} /> Sin teléfono. Ábrelo en el anuncio (“Ver teléfono”) y pégalo aquí:
                  </span>
                  <input
                    className="form-input"
                    style={styles.telefonoInput}
                    placeholder="300 000 0000"
                    value={telefonos[p.id] ?? ''}
                    onChange={(e) => setTelefonos({ ...telefonos, [p.id]: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') anadirTelefono(p); }}
                    disabled={ocupado}
                  />
                  <button className="btn btn-secondary" style={styles.btn} onClick={() => anadirTelefono(p)} disabled={ocupado}>
                    <Phone size={13} /> Guardar
                  </button>
                </div>
              )}

              <textarea
                className="form-input"
                style={styles.mensajeArea}
                rows={4}
                value={mensaje}
                onChange={e => setMensajes({ ...mensajes, [p.id]: e.target.value })}
                disabled={ocupado}
              />

              <div style={styles.acciones}>
                {p.contacto_telefono ? (
                  <a
                    className="btn btn-primary"
                    style={styles.btn}
                    href={linkWhatsApp(p.contacto_telefono, mensaje)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={14} /> Abrir WhatsApp
                  </a>
                ) : p.contacto_perfil ? (
                  <a className="btn btn-primary" style={styles.btn} href={p.contacto_perfil} target="_blank" rel="noopener noreferrer">
                    <Send size={14} /> Abrir perfil
                  </a>
                ) : null}
                <button className="btn btn-secondary" style={styles.btn} onClick={() => aprobar(p)} disabled={ocupado}>
                  {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Marcar contactado
                </button>
                <button className="btn btn-danger" style={styles.btn} onClick={() => rechazar(p)} disabled={ocupado}>
                  <X size={14} /> Descartar
                </button>
                {/* Habeas Data: distinto de descartar. Excluye al propietario
                    para siempre, aunque vuelva a publicar. */}
                <button
                  className="btn btn-secondary"
                  style={styles.btn}
                  onClick={() => noContactar(p)}
                  disabled={ocupado}
                  title="El propietario pidió no ser contactado (queda excluido para siempre)"
                >
                  <Ban size={14} /> No contactar
                </button>
              </div>
              <div style={styles.nota}>
                El mensaje se abre en WhatsApp con el texto listo — revísalo y envíalo tú. Nada se envía automáticamente.
              </div>
            </div>
          );
        })
      )}

      {/* ============ En seguimiento ============ */}
      {enSeguimiento.length > 0 && (
        <>
          <h2 style={styles.seccionTitulo}>En seguimiento</h2>
          {enSeguimiento.map(p => {
            const vencido = p.proximo_seguimiento != null && p.proximo_seguimiento <= hoy;
            const ocupado = procesando === p.id;
            return (
              <div key={p.id} className="glass-card" style={styles.seguimiento}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.sTitulo}>{p.titulo || '(sin título)'}</div>
                  <div style={styles.pMeta}>
                    <span>{[p.barrio, p.ciudad].filter(Boolean).join(', ') || 'sin ubicación'}</span>
                    {p.contacto_telefono && <span><Phone size={12} /> {p.contacto_telefono}</span>}
                    <span style={styles.estadoBadge}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</span>
                    {p.proximo_seguimiento && (
                      <span style={vencido ? styles.seguimientoVencido : styles.seguimientoOk}>
                        <Clock size={11} /> {vencido ? 'seguimiento vencido' : `seguir el ${p.proximo_seguimiento}`}
                      </span>
                    )}
                    {p.n_seguimientos > 0 && <span>{p.n_seguimientos} seguimiento{p.n_seguimientos > 1 ? 's' : ''}</span>}
                  </div>
                </div>
                <div style={styles.sAcciones}>
                  {p.contacto_telefono && p.mensaje_borrador && (
                    <a
                      className="btn btn-secondary"
                      style={styles.btnMini}
                      href={linkWhatsApp(p.contacto_telefono, p.mensaje_borrador)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir la conversación en WhatsApp"
                    >
                      <MessageCircle size={13} />
                    </a>
                  )}
                  <button className="btn btn-secondary" style={styles.btnMini} onClick={() => seguimiento(p)} disabled={ocupado} title="Registrar seguimiento y reprogramar">
                    {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
                  </button>
                  <select
                    className="form-input"
                    style={styles.selectEstado}
                    value={p.estado}
                    onChange={e => mover(p, e.target.value as EstadoProspecto)}
                    disabled={ocupado}
                  >
                    <option value="contactado">Contactado</option>
                    <option value="en_conversacion">En conversación</option>
                    <option value="cita">Cita</option>
                    <option value="captado">Captado</option>
                    <option value="descartado">Descartado</option>
                  </select>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  titulo: {
    fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-primary)',
    display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0, letterSpacing: '-0.02em',
  },
  subtitulo: { fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '0.25rem' },
  card: { padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', marginBottom: '1.25rem' },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  cardTitulo: { fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' },
  cardHint: { fontSize: '0.75rem', color: 'var(--text-muted)' },
  formGrid: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  input: { flex: 1, minWidth: '220px', fontSize: '0.85rem', padding: '0.45rem 0.65rem' },
  textarea: { width: '100%', fontSize: '0.85rem', padding: '0.5rem 0.65rem', resize: 'vertical', fontFamily: 'inherit' },
  formPie: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  btn: { padding: '0.45rem 0.9rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' },
  btnMini: { padding: '0.35rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center' },
  aviso: { fontSize: '0.78rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' },
  statsFila: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' },
  statChip: {
    fontSize: '0.78rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)', borderRadius: '999px', padding: '0.3rem 0.75rem',
  },
  statChipMudo: {
    fontSize: '0.78rem', color: 'var(--text-muted)', backgroundColor: 'transparent',
    border: '1px dashed var(--border-color)', borderRadius: '999px', padding: '0.3rem 0.75rem',
  },
  seccionTitulo: { fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '1.5rem 0 0.75rem' },
  vacio: { padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' },
  errorBanner: {
    display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.85rem 1rem', marginBottom: '1rem',
    fontSize: '0.82rem', color: '#b91c1c', border: '1px solid rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(239, 68, 68, 0.07)', lineHeight: 1.5,
  },
  prospecto: { padding: '1rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.85rem' },
  pHeader: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' },
  pTitulo: { fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' },
  pMeta: {
    display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem',
    color: 'var(--text-muted)', alignItems: 'center', marginTop: '0.2rem',
  },
  pBadges: { display: 'flex', gap: '0.35rem', flexShrink: 0, alignItems: 'center' },
  badgeDueno: {
    fontSize: '0.66rem', fontWeight: 700, color: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.1)',
    borderRadius: '999px', padding: '0.15rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
  },
  badgeAgencia: {
    fontSize: '0.66rem', fontWeight: 700, color: '#b45309', backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: '999px', padding: '0.15rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
  },
  badgeScore: {
    fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)', backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '999px', padding: '0.15rem 0.5rem',
  },
  fuenteBadge: {
    fontSize: '0.64rem', fontWeight: 600, color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.05rem 0.4rem', textTransform: 'capitalize',
  },
  motivos: { fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' },
  contactoFila: {
    display: 'flex', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.76rem',
    color: 'var(--text-muted)', alignItems: 'center',
  },
  link: { color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
  sinContacto: { color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 },
  telefonoFila: {
    display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap',
    padding: '0.5rem 0.65rem', borderRadius: '8px', backgroundColor: 'rgba(245, 158, 11, 0.08)',
    border: '1px dashed rgba(245, 158, 11, 0.4)',
  },
  telefonoHint: { fontSize: '0.74rem', color: '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' },
  telefonoInput: { width: '150px', fontSize: '0.82rem', padding: '0.35rem 0.55rem' },
  mensajeArea: { width: '100%', fontSize: '0.83rem', padding: '0.55rem 0.7rem', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 },
  acciones: { display: 'flex', gap: '0.45rem', flexWrap: 'wrap' },
  nota: { fontSize: '0.7rem', color: 'var(--text-muted)' },
  seguimiento: { padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' },
  sTitulo: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' },
  sAcciones: { display: 'flex', gap: '0.35rem', alignItems: 'center', flexShrink: 0 },
  selectEstado: { fontSize: '0.75rem', padding: '0.3rem 0.5rem', minWidth: '130px' },
  estadoBadge: {
    fontSize: '0.64rem', fontWeight: 700, color: 'var(--primary)', backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '8px', padding: '0.05rem 0.45rem',
  },
  seguimientoVencido: { color: '#ef4444', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' },
  seguimientoOk: { display: 'inline-flex', alignItems: 'center', gap: '0.2rem' },
};
