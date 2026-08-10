// Asesores del formulario de captación mapeados a su id en el ERP Nuby/Arrendasoft.
// El value del <option> es el id (se envía como Asesor_id, para asignar el asesor
// directo en el ERP); el label es el nombre (se envía como Asesor, para hoja/doc/post).
// Los ids se derivaron de las propiedades de Nuby (campo asesor_id).

export type Asesor = { id: number; nombre: string };

export const ASESORES: Asesor[] = [
  { id: 15, nombre: 'Sebastian' }, // JUAN SEBASTIAN MORALES GUERRA
  { id: 16, nombre: 'Gisela' },    // GISELA ORTIZ OQUENDO
  { id: 13, nombre: 'Liz' },       // LIZ DAYANA ROJAS CORTES
  { id: 14, nombre: 'Samuel' },    // SAMUEL GARCIA ROJAS
];

export const ASESOR_IDS_VALIDOS = new Set(ASESORES.map((a) => a.id));
