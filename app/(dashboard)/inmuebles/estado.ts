// Colores y texto del estado de un inmueble. Los comparten la tarjeta del
// catálogo (InmuebleCard) y «Inmuebles recientes» del inicio, para que un
// mismo estado se vea igual en las dos. Módulo plano: sirve en servidor y cliente.
export function estadoChip(estado: string | null | undefined): { txt: string; bg: string; color: string } {
  if (estado === 'disponible') return { txt: 'Disponible', bg: '#dcfce7', color: '#166534' };
  if (estado === 'arrendado') return { txt: 'Arrendado', bg: '#e2e8f0', color: '#334155' };
  if (estado === 'empalme') return { txt: 'En empalme', bg: '#e0e7ff', color: '#4338ca' };
  if (estado === 'inactivo') return { txt: 'Inactivo', bg: '#f1f5f9', color: '#475569' };
  return { txt: estado || '—', bg: '#e2e8f0', color: '#334155' };
}
