// Configuración del agente de captaciones (criterio de negocio + modelos).
//
// Modelos OpenAI, igual que el agente comercial (ver lib/agente-comercial/costos.ts,
// que es la ÚNICA tabla de precios: se reutiliza para calcular el costo).
// Calificar es clasificación barata → mini por defecto. Redactar es el mensaje
// que verá un propietario real → modelo completo.
export const MODELO_CALIFICAR = process.env.CAPTACIONES_MODELO_CALIFICAR || 'gpt-4.1-mini';
export const MODELO_REDACTAR = process.env.CAPTACIONES_MODELO_REDACTAR || 'gpt-4.1';

// Criterio de captación v1: apartamentos en venta en Bello y Robledo (Medellín).
export const ZONAS_OBJETIVO = ['bello', 'robledo'];
export const TIPO_OBJETIVO = 'apartamento';
export const TRANSACCION_OBJETIVO = 'venta';

// Prioridad del canal de contacto según lo que exponga cada anuncio.
export const CANAL_PRIORIDAD = ['whatsapp', 'telefono', 'messenger'] as const;

// Días hasta el primer seguimiento tras contactar.
export const DIAS_PRIMER_SEGUIMIENTO = 3;

// Base de tratamiento de datos (Habeas Data, Ley 1581/2012) que se guarda en
// cada prospecto para trazabilidad.
export const BASE_TRATAMIENTO = 'Datos de contacto publicados por el titular en un anuncio público de venta; finalidad: oferta de servicios de intermediación inmobiliaria.';
