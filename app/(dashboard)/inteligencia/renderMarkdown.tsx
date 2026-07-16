import React from 'react';

// Render mínimo de markdown (negritas, títulos y listas) sin dependencias.
// Compartido entre las burbujas del chat y el visor de informes guardados.
export function renderMarkdown(texto: string): React.ReactNode {
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
