'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListChecks, Loader2, ExternalLink, X, AlertTriangle, Check } from 'lucide-react';
import { encolarAnuncios, omitirDeCola, vaciarCola } from '@/app/actions/captaciones';

interface ItemCola {
  id: string;
  url: string;
  titulo: string | null;
  precio: number | null;
  fuente: string;
  created_at: string;
}

export default function ColaClient({
  pendientes,
  errorCarga,
}: {
  pendientes: ItemCola[];
  errorCarga: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Los anuncios recién llegados se dan de alta UNA vez: sin esta guarda, el
  // doble montaje de React en desarrollo los enviaría dos veces.
  const yaProcesado = useRef(false);

  // El fragmento (#) nunca llega al servidor: el alta se hace aquí.
  useEffect(() => {
    if (yaProcesado.current) return;
    const frag = window.location.hash.slice(1);
    if (!frag) return;
    yaProcesado.current = true;

    let lista: Array<{ url: string; titulo?: string | null; precio?: number | null }>;
    try {
      const datos = JSON.parse(decodeURIComponent(frag));
      lista = Array.isArray(datos) ? datos : datos.anuncios;
      if (!Array.isArray(lista) || !lista.length) throw new Error('vacío');
    } catch {
      setError('No pude leer los anuncios del enlace (puede estar incompleto).');
      return;
    }

    setOcupado(true);
    encolarAnuncios(lista)
      .then((r) => {
        if (!r.success) { setError(r.error); return; }
        setError(null);
        // Se limpia el fragmento para que recargar no reintente el alta.
        history.replaceState(null, '', window.location.pathname);
        const nuevos = r.encolados ?? 0;
        setAviso(
          nuevos === 0
            ? 'Nada nuevo: todos esos anuncios ya estaban en la cola o en el CRM.'
            : `${nuevos} anuncio(s) añadidos a la cola` +
              (r.repetidos ? ` · ${r.repetidos} ya estaban` : '')
        );
        router.refresh();
      })
      // Sin este catch, un rechazo (red, 500, despliegue en curso) perdía en
      // silencio una tanda de hasta 25 enlaces: el fragmento ya se había
      // consumido y no había forma de recuperarlos salvo repetir la búsqueda.
      .catch(() => {
        yaProcesado.current = false; // permite reintentar recargando la página
        setError('No se pudieron guardar los anuncios (falló la conexión). Recarga esta página para reintentar.');
      })
      .finally(() => setOcupado(false));
  }, [router]);

  // Al volver de capturar una publicación, la lista se actualiza sola: lo que
  // se capturó deja de estar pendiente sin que haya que recargar a mano.
  useEffect(() => {
    const alVolver = () => router.refresh();
    window.addEventListener('focus', alVolver);
    return () => window.removeEventListener('focus', alVolver);
  }, [router]);

  const abrir = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const omitir = async (id: string) => {
    setOcupado(true);
    try {
      const r = await omitirDeCola({ cola_id: id });
      if (!r.success) { setError(r.error); return; }
      setError(null);
      router.refresh();
    } catch {
      setError('No se pudo omitir (falló la conexión). Inténtalo de nuevo.');
    } finally {
      // En el finally a propósito: si la promesa rechazaba, `ocupado` se
      // quedaba en true y TODA la página quedaba deshabilitada hasta recargar.
      setOcupado(false);
    }
  };

  const vaciar = async () => {
    if (!confirm(`¿Descartar los ${pendientes.length} anuncios pendientes de la cola?`)) return;
    setOcupado(true);
    try {
      const r = await vaciarCola();
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setAviso('Cola vaciada.');
      router.refresh();
    } catch {
      setError('No se pudo vaciar la cola (falló la conexión). Inténtalo de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  const siguiente = pendientes[0];

  return (
    <div>
      <h1 style={styles.titulo}>
        <ListChecks size={22} /> Cola de revisión
      </h1>
      <p style={styles.sub}>
        Anuncios de Facebook recogidos desde una lista de resultados. Solo tenemos el enlace:
        ábrelos de a uno y pulsa <strong>Captar</strong> en la publicación para que entren
        calificados a la bandeja.
      </p>

      {errorCarga && (
        <div style={styles.error}>
          <AlertTriangle size={16} />
          <span>No se pudo cargar la cola: {errorCarga}</span>
        </div>
      )}
      {error && (
        <div style={styles.error}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      {aviso && (
        <div style={styles.exito}>
          <Check size={16} />
          <span>{aviso}</span>
        </div>
      )}

      {ocupado && (
        <div style={styles.sub}>
          <Loader2 size={14} style={{ display: 'inline', marginRight: 6 }} /> Trabajando…
        </div>
      )}

      {!pendientes.length ? (
        <div className="card" style={styles.vacio}>
          <p style={{ margin: 0, fontWeight: 600 }}>La cola está vacía.</p>
          <p style={styles.nota}>
            Abre una búsqueda en Facebook Marketplace y pulsa el marcador <strong>Captar</strong>:
            los resultados llegarán aquí para revisarlos uno a uno.
          </p>
          <Link href="/captaciones" className="btn btn-primary" style={styles.btn}>
            Ir a la bandeja <ExternalLink size={14} />
          </Link>
        </div>
      ) : (
        <>
          <div style={styles.barra}>
            <button
              className="btn btn-primary"
              style={styles.btn}
              disabled={ocupado}
              onClick={() => abrir(siguiente.url)}
            >
              Abrir siguiente <ExternalLink size={14} />
            </button>
            <span style={styles.contador}>
              {pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}
            </span>
            <button className="btn" style={styles.btnFlojo} disabled={ocupado} onClick={vaciar}>
              Vaciar cola
            </button>
          </div>

          <div className="card" style={styles.lista}>
            {pendientes.map((p, i) => (
              <div key={p.id} style={styles.item}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.itemTitulo}>
                    {i === 0 && <span style={styles.pill}>siguiente</span>}
                    {p.titulo || '(sin título)'}
                  </div>
                  <div style={styles.itemMeta}>
                    {p.precio != null && <span>${Number(p.precio).toLocaleString('es-CO')}</span>}
                    <span>{p.fuente}</span>
                  </div>
                </div>
                <button
                  className="btn"
                  style={styles.btnMini}
                  disabled={ocupado}
                  onClick={() => abrir(p.url)}
                  title="Abrir la publicación en una pestaña nueva"
                >
                  Abrir <ExternalLink size={12} />
                </button>
                <button
                  className="btn"
                  style={styles.btnMini}
                  disabled={ocupado}
                  onClick={() => omitir(p.id)}
                  title="No me interesa: sacarlo de la cola"
                >
                  <X size={12} /> Omitir
                </button>
              </div>
            ))}
          </div>

          <p style={styles.nota}>
            Al capturar una publicación desaparece sola de esta lista. Nada de lo que hay aquí
            ha costado una llamada al modelo: el gasto ocurre cuando capturas.
          </p>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  titulo: { fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0 0 0.5rem' },
  sub: { fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1rem' },
  barra: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' },
  contador: { fontSize: '0.82rem', color: 'var(--text-muted)' },
  lista: { padding: '0.4rem 0.75rem' },
  item: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.25rem', borderBottom: '1px solid var(--border-color)' },
  itemTitulo: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' },
  itemMeta: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' },
  pill: { fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', padding: '0.1rem 0.4rem', borderRadius: 4, backgroundColor: 'rgba(0,171,216,0.15)', color: '#0284a8' },
  vacio: { padding: '1.5rem', textAlign: 'center' },
  btn: { padding: '0.55rem 1.1rem', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' },
  btnFlojo: { padding: '0.45rem 0.9rem', fontSize: '0.8rem', color: 'var(--text-muted)' },
  btnMini: { padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 },
  nota: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' },
  error: { display: 'flex', gap: '0.5rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.07)' },
  exito: { display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.88rem', color: '#166534', border: '1px solid rgba(22,163,74,0.35)', backgroundColor: 'rgba(22,163,74,0.07)' },
};
