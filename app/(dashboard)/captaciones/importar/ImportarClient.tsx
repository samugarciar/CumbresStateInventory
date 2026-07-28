'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { importarAnuncios } from '@/app/actions/captaciones';
import type { AnuncioEntrante } from '@/lib/agente-captaciones/procesar';

interface Resultado {
  creados: number;
  duplicados: number;
  descartados: number;
  fallidos: number;
  recortados?: number;
  detalle: Array<{
    titulo: string;
    resultado: string;
    motivo: string | null;
    es_dueno_directo?: boolean | null;
    confianza?: number | null;
    score?: number | null;
  }>;
}

function pct(v: number | null | undefined): string | null {
  return v == null ? null : `${Math.round(v * 100)}%`;
}

export default function ImportarClient() {
  const [anuncios, setAnuncios] = useState<AnuncioEntrante[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // El fragmento (#) nunca llega al servidor, así que se lee acá.
  useEffect(() => {
    try {
      const frag = window.location.hash.slice(1);
      if (!frag) { setError('No llegaron anuncios. Usa el botón "Captar" desde una página de anuncios.'); return; }
      const datos = JSON.parse(decodeURIComponent(frag));
      const lista: AnuncioEntrante[] = Array.isArray(datos) ? datos : datos.anuncios;
      if (!Array.isArray(lista) || !lista.length) { setError('El enlace no traía anuncios válidos.'); return; }
      setAnuncios(lista);
    } catch {
      setError('No pude leer los anuncios del enlace (puede estar incompleto).');
    }
  }, []);

  const importar = async () => {
    if (!anuncios) return;
    setProcesando(true);
    const r = await importarAnuncios(anuncios);
    setProcesando(false);
    if (!r.success) { setError(r.error); return; }
    setResultado(r as unknown as Resultado);
  };

  return (
    <div style={{ maxWidth: '760px' }}>
      <h1 style={styles.titulo}>
        <Download size={26} color="var(--primary)" />
        Importar anuncios
      </h1>

      {error && (
        <div className="glass-card" style={styles.error}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{error}</span>
        </div>
      )}

      {!resultado && anuncios && (
        <>
          <p style={styles.sub}>
            Se recolectaron <strong>{anuncios.length}</strong> anuncio(s). Revísalos y confirma: el agente los
            calificará, descartará los que no encajen y redactará el mensaje de los que sirvan.
          </p>

          <div className="glass-card" style={styles.lista}>
            {anuncios.map((a, i) => (
              <div key={i} style={styles.item}>
                <div style={styles.itemTitulo}>{a.titulo || '(sin título)'}</div>
                <div style={styles.itemMeta}>
                  {a.precio != null && <span>${Number(a.precio).toLocaleString('es-CO')}</span>}
                  {a.barrio || a.ciudad ? <span>{[a.barrio, a.ciudad].filter(Boolean).join(', ')}</span> : null}
                  {a.habitaciones != null && <span>{a.habitaciones} hab</span>}
                  {a.area_m2 != null && <span>{a.area_m2} m²</span>}
                  {a.descripcion ? <span style={styles.ok}>con descripción</span> : <span style={styles.warn}>sin descripción</span>}
                  {a.fuente_marca_dueno_directo && <span style={styles.ok}>dueño directo (portal)</span>}
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-primary" style={styles.btn} onClick={importar} disabled={procesando}>
            {procesando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {procesando ? 'Calificando…' : `Importar ${anuncios.length} anuncio(s)`}
          </button>
          {procesando && <p style={styles.nota}>Puede tardar; cada anuncio pasa por el modelo dos veces.</p>}
        </>
      )}

      {resultado && (
        <>
          <div className="glass-card" style={styles.exito}>
            <Check size={18} style={{ flexShrink: 0 }} />
            <span>
              <strong>{resultado.creados}</strong> prospecto(s) nuevo(s) · {resultado.duplicados} ya estaban ·{' '}
              {resultado.descartados} descartado(s){resultado.fallidos ? ` · ${resultado.fallidos} con error` : ''}
              {resultado.recortados ? ` · ${resultado.recortados} sin procesar (tope de 25)` : ''}
            </span>
          </div>
          <div className="glass-card" style={styles.lista}>
            {resultado.detalle.map((d, i) => (
              <div key={i} style={styles.item}>
                <div style={styles.itemTitulo}>
                  {d.resultado === 'creado' ? '✅' : d.resultado === 'duplicado' ? '↩️' : '🚫'} {d.titulo}
                </div>
                {/* El veredicto del calificador: por qué decidió lo que decidió */}
                {d.es_dueno_directo != null && (
                  <div style={styles.itemMeta}>
                    <span style={d.es_dueno_directo ? styles.ok : styles.warn}>
                      {d.es_dueno_directo ? 'Dueño directo' : 'Posible agencia'}
                      {pct(d.confianza) ? ` · ${pct(d.confianza)} de confianza` : ''}
                    </span>
                    {pct(d.score) && <span>prospecto {pct(d.score)}</span>}
                  </div>
                )}
                {d.motivo && <div style={styles.itemMeta}>{d.motivo}</div>}
              </div>
            ))}
          </div>
          <Link href="/captaciones" className="btn btn-primary" style={styles.btn}>
            Ir a la bandeja <ExternalLink size={14} />
          </Link>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  titulo: { fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0 0 0.5rem' },
  sub: { fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1rem' },
  lista: { padding: '0.5rem 0.75rem', marginBottom: '1rem' },
  item: { padding: '0.55rem 0.25rem', borderBottom: '1px solid var(--border-color)' },
  itemTitulo: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' },
  itemMeta: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' },
  ok: { color: '#16a34a', fontWeight: 600 },
  warn: { color: '#b45309', fontWeight: 600 },
  btn: { padding: '0.55rem 1.1rem', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' },
  nota: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' },
  error: { display: 'flex', gap: '0.5rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.07)' },
  exito: { display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.88rem', color: '#166534', border: '1px solid rgba(22,163,74,0.35)', backgroundColor: 'rgba(22,163,74,0.07)' },
};
