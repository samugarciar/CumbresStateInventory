// Configuración del agente de captaciones (criterio de negocio + modelos).
//
// Modelos OpenAI, igual que el agente comercial (ver lib/agente-comercial/costos.ts,
// que es la ÚNICA tabla de precios: se reutiliza para calcular el costo).
// Calificar es clasificación barata → mini por defecto. Redactar es el mensaje
// que verá un propietario real → modelo completo.
export const MODELO_CALIFICAR = process.env.CAPTACIONES_MODELO_CALIFICAR || 'gpt-4.1-mini';
export const MODELO_REDACTAR = process.env.CAPTACIONES_MODELO_REDACTAR || 'gpt-4.1';

// Criterio de captación: apartamentos en Bello y Robledo (Medellín).
//
// El negocio principal de la inmobiliaria es el ARRIENDO (administrar
// inmuebles arrendados), así que ese es el objetivo prioritario de captación.
// Las ventas se aceptan pero valen menos: entran a la bandeja con score más
// bajo, no se descartan.
//
// La prioridad arriendo > venta vive en el prompt del calificador (prompt.ts),
// que es donde se aplica de verdad: tenerla además como constante aquí era
// duplicar el criterio en dos sitios que podían desincronizarse.
export const TIPO_OBJETIVO = 'apartamento';

// Definición COMPLETA de la zona, tal como se le pasa al calificador.
//
// POR QUÉ CON ESTE DETALLE: el prompt decía "(bello, robledo, área de Medellín)"
// y el modelo lo leía como tres opciones válidas, así que entraban apartamentos
// de Belén, Laureles y hasta El Poblado con score 0.85. Lo que falla no es el
// nombre de la zona sino la frontera: hay que decir explícitamente que estar en
// Medellín NO basta, y nombrar los barrios de cada zona para que reconozca un
// anuncio que solo dice "Niquía" o "Pajarito".
//
// Para cambiar el criterio de captación se edita AQUÍ y en ningún otro sitio.
export const ZONAS_DETALLE = [
  {
    nombre: 'municipio de Bello',
    barrios: ['Niquía', 'Cabañas', 'Amazonía', 'Madera', 'Trapiche', 'Ciudad de los Puertos',
      'Búcaros', 'París', 'Zamora', 'Santa Ana', 'Pérez', 'La Cumbre', 'Villa Linda', 'Machado'],
  },
  {
    nombre: 'comuna de Robledo, en Medellín',
    barrios: ['Pajarito', 'La Aurora', 'Villa Flora', 'Aures', 'El Diamante', 'López de Mesa',
      'Bosques de San Pablo', 'Cucaracho', 'Palenque', 'Córdoba'],
  },
];

// Lo que MÁS se coló: sectores del propio Medellín y municipios vecinos. Van
// nombrados uno a uno porque "fuera de zona" en abstracto no le bastaba al
// modelo cuando la ciudad era Medellín.
export const ZONAS_EXCLUIDAS = ['Belén', 'El Poblado', 'Laureles', 'Estadio', 'Manrique',
  'Buenos Aires', 'La América', 'Castilla', 'Envigado', 'Itagüí', 'Sabaneta', 'La Estrella',
  'Copacabana', 'Girardota', 'Bogotá', 'Rionegro', 'Marinilla', 'Soacha'];

// Umbral de entrada a la bandeja: solo pasan los anuncios con al menos esta
// probabilidad de ser de DUEÑO DIRECTO. Los que no llegan se guardan como
// descartados (para trazabilidad y para no reprocesarlos), pero no se les
// redacta mensaje ni aparecen en la cola de aprobación.
//
// POR QUÉ 0.35 Y NO 0.5: cuando un anuncio llega sin descripción —el caso
// típico del modo lista de Facebook— el modelo no tiene con qué juzgar y se
// queda alrededor de 0.4 por prudencia. Con el umbral en 0.5 se perdía
// prácticamente todo lo capturado desde una lista (34 de 52 en una revisión
// real), no por ser agencias sino por falta de evidencia. En 0.35 pasan los
// "no sé" y se filtra lo que sí muestra señales de agencia (0.3 o menos).
export const UMBRAL_DUENO_DIRECTO = 0.35;

// Días hasta el primer seguimiento tras contactar.
export const DIAS_PRIMER_SEGUIMIENTO = 3;

// Base de tratamiento de datos (Habeas Data, Ley 1581/2012) que se guarda en
// cada prospecto para trazabilidad.
export const BASE_TRATAMIENTO = 'Datos de contacto publicados por el titular en un anuncio público de venta; finalidad: oferta de servicios de intermediación inmobiliaria.';
