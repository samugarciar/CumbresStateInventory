/**
 * Dónde es la visita, como se le dice al cliente: el nombre de la unidad y
 * la dirección SIN el apartamento.
 *
 * Pedido de Samuel (9 nov 2026). La agenda se programa por unidad y ahí no
 * se ve el número de apto, pero la confirmación salía con la dirección del
 * inmueble, que en el ERP trae el apto («AV 31 #67 -221 APTO 1509»). En una
 * cita a la unidad ese inmueble es solo el ancla de la franja (el apto más
 * barato al agendar), así que una visita «a Mi Mundo» podía confirmarse
 * para un apto que ya se había arrendado. Al cliente se le dice a qué unidad
 * va; los apartamentos disponibles se los muestra el asesor en la visita.
 *
 * Lo usan la confirmación de /citas, el aviso de las solicitudes de
 * apertura y lo que el bot dice al registrar la cita.
 */

const LETRA = 'A-Za-zÁÉÍÓÚÑáéíóúñ';

// Lo que identifica un apto dentro de la unidad, con su número. Las formas
// salen de las direcciones reales del ERP: «APTO 1509», «APTO. 301»,
// «AP 2208», «INTR. 301», «INTERIOR 202», «CASA 171», «PISO 26», «T1»,
// «T 2», «TORRE 3», «BL 64», «PQ M220», «PARQ03002», y pegados al número de
// la calle («#67-221APTO 707») o mal escritos («APTOP 1104»). Las alternativas largas
// van primero («APTO» antes que «AP»). Un nombre sin número, como «TORRE
// ALDABÓN» o «SEGUNDO PISO», se queda. La letra antes del número solo se
// acepta en el parqueadero: con «T» se comería una transversal («TV32»).
const PARTE_DEL_APTO = new RegExp(
  `(?<![${LETRA}])` +
    '(?:' +
    '(?:APARTAMENTO|APTOP|APTO|APT|AP|INTERIOR|INTR|INT|CASA|PISO|TORRE|T|BLOQUE|BL)' +
    '\\.?\\s*(?:N[Oº°]\\.?\\s*)?\\d+[A-Z]?(?:\\s*Y\\s*\\d+)?' +
    '|(?:PARQUEADERO|PARQ|PQ)\\.?\\s*[A-Z]?\\d+' +
    ')' +
    `(?![${LETRA}0-9])`,
  'gi'
);

// «APTO» suelto al final, sin número (pasa: «CL 6 #39 -53 APTO»).
const APTO_SIN_NUMERO = new RegExp(`(?<![${LETRA}])(?:APTO|APT|AP)\\.?\\s*$`, 'i');

// El apto entre paréntesis: «CRA 71A #52-70 (402)», «(205 )», «(2102 T1)».
const NUMERO_ENTRE_PARENTESIS = /\(\s*\d+[^)]*\)/g;

/** La dirección del inmueble sin apto, torre, piso ni parqueadero. */
export function direccionSinApto(direccion: string | null | undefined): string {
  return (direccion ?? '')
    .replace(NUMERO_ENTRE_PARENTESIS, ' ')
    .replace(PARTE_DEL_APTO, ' ')
    // Segunda pasada: en «APTO T4 226» la torre separa el apto de su número.
    .replace(PARTE_DEL_APTO, ' ')
    .replace(APTO_SIN_NUMERO, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,.;])(?:\s*[,.;])+/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '');
}

export interface LugarDeVisita {
  /** La unidad («Mi Mundo»); sin unidad, el título del inmueble. */
  nombre: string;
  /** La dirección sin apto; vacía si no queda nada. */
  direccion: string;
}

export interface DatosDelLugar {
  unidad?: string | null;
  titulo?: string | null;
  direccion?: string | null;
}

export function lugarDeVisita(inmueble: DatosDelLugar): LugarDeVisita {
  return {
    nombre: inmueble.unidad?.trim() || inmueble.titulo?.trim() || '',
    direccion: direccionSinApto(inmueble.direccion),
  };
}
