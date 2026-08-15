'use client';

import React, { useState } from 'react';

// Galería para el cliente final, que la abre desde WhatsApp en el celular.
// Las fotos del ERP pesan 40-70 KB cada una y hay ~18 por inmueble: se cargan
// en diferido (`loading="lazy"`) para no quemarle los datos a quien entra con
// red móvil. Las que fallen se ocultan solas en vez de mostrar el ícono roto
// — ya vimos URLs del ERP devolviendo 404.

export default function GaleriaCliente({ fotos, titulo }: { fotos: string[]; titulo: string }) {
  const [rotas, setRotas] = useState<Set<number>>(new Set());
  const [abierta, setAbierta] = useState<number | null>(null);

  const visibles = fotos.map((url, i) => ({ url, i })).filter(({ i }) => !rotas.has(i));

  if (visibles.length === 0) {
    return (
      <section style={s.vacio}>
        <p style={{ margin: 0, color: '#64748b' }}>
          Las fotos de este inmueble aún no están cargadas. Escríbenos y un asesor te las envía.
        </p>
      </section>
    );
  }

  return (
    <>
      <section style={s.wrap}>
        <h2 style={s.h2}>
          Fotos <span style={s.conteo}>({visibles.length})</span>
        </h2>
        <div style={s.grid}>
          {visibles.map(({ url, i }) => (
            <button key={i} onClick={() => setAbierta(i)} style={s.celda} aria-label={`Ver foto ${i + 1} de ${titulo}`}>
              <img
                src={url}
                alt={`${titulo} — foto ${i + 1}`}
                loading="lazy"
                style={s.img}
                onError={() => setRotas((prev) => new Set(prev).add(i))}
              />
            </button>
          ))}
        </div>
      </section>

      {abierta !== null && (
        <div style={s.visor} onClick={() => setAbierta(null)} role="dialog" aria-modal="true">
          <button style={s.cerrar} onClick={() => setAbierta(null)} aria-label="Cerrar">
            ×
          </button>
          <img src={fotos[abierta]} alt={`${titulo} — foto ampliada`} style={s.imgGrande} />
        </div>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { padding: '20px', background: '#fff' },
  h2: { fontSize: '1rem', fontWeight: 700, margin: '0 0 12px' },
  conteo: { color: '#94a3b8', fontWeight: 500 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 },
  celda: { padding: 0, border: 'none', background: '#e2e8f0', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', aspectRatio: '4 / 3' },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  vacio: { padding: '24px 20px', background: '#fff', textAlign: 'center' },
  visor: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 12 },
  cerrar: { position: 'absolute', top: 12, right: 16, background: 'transparent', border: 'none', color: '#fff', fontSize: 40, lineHeight: 1, cursor: 'pointer' },
  imgGrande: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
};
