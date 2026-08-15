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
export const ZONAS_OBJETIVO = ['bello', 'robledo'];
export const TIPO_OBJETIVO = 'apartamento';
// La prioridad arriendo > venta vive en el prompt del calificador (prompt.ts),
// que es donde se aplica de verdad: tenerla además como constante aquí era
// duplicar el criterio en dos sitios que podían desincronizarse.

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
