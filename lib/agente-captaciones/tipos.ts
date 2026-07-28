// Tipos compartidos del agente de captaciones.
//
// ListingCrudo es el CONTRATO entre las fuentes y el grafo: toda fuente
// (Mercado Libre, Facebook, portales, pegado a mano) produce este shape, y el
// grafo es agnóstico a de dónde vino. Añadir una fuente = producir esto.

export type FuenteCaptacion = 'mercadolibre' | 'facebook' | 'otro';

export interface ListingCrudo {
  fuente: FuenteCaptacion;
  fuente_id: string | null; // id del anuncio en la fuente (dedup)
  url: string | null;
  titulo: string;
  descripcion: string;
  precio: number | null;
  moneda: string | null;
  ciudad: string | null;
  barrio: string | null;
  direccion: string | null;
  area_m2: number | null;
  habitaciones: number | null;
  banos: number | null;
  tipo_inmueble: string | null;
  tipo_transaccion: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_perfil: string | null; // perfil de FB u otro
  atributos: Record<string, string>;
  /**
   * true cuando la PLATAFORMA de origen ya clasificó el anuncio como de dueño
   * directo (p. ej. el filtro oficial "dueño directo" de Mercado Libre). Es
   * evidencia mucho más fuerte que cualquier heurística sobre el texto, y sin
   * pasarla el calificador marca como dudosos anuncios que la fuente ya
   * certificó.
   */
  fuente_marca_dueno_directo: boolean | null;
  crudo: unknown; // payload original, por si se necesita más
}

export function listingVacio(fuente: FuenteCaptacion): ListingCrudo {
  return {
    fuente,
    fuente_id: null,
    url: null,
    titulo: '',
    descripcion: '',
    precio: null,
    moneda: null,
    ciudad: null,
    barrio: null,
    direccion: null,
    area_m2: null,
    habitaciones: null,
    banos: null,
    tipo_inmueble: null,
    tipo_transaccion: null,
    contacto_nombre: null,
    contacto_telefono: null,
    contacto_perfil: null,
    atributos: {},
    fuente_marca_dueno_directo: null,
    crudo: null,
  };
}

export interface Calificacion {
  es_dueno_directo: boolean;
  /**
   * Probabilidad (0-1) de que quien publica sea el DUEÑO DIRECTO.
   *
   * OJO: antes este campo era "confianza en la clasificación", que se presta a
   * un error grave — un "es agencia, 90% de confianza" habría pasado un filtro
   * de `>= 0.5`. Ahora la escala es siempre la misma: 1 = seguro dueño,
   * 0 = seguro agencia.
   */
  probabilidad_dueno_directo: number;
  tipo_inmueble: string | null;
  tipo_transaccion: string | null;
  en_zona_objetivo: boolean;
  score: number; // 0-1
  decision: 'calificado' | 'revisar' | 'descartar';
  motivos: string;
}

export interface UsoRegistrado {
  modelo: string;
  entrada: number;
  salida: number;
  cache: number;
}

export type ResultadoCaptacion = 'creado' | 'duplicado' | 'descartado';

export interface SalidaCaptacion {
  resultado: ResultadoCaptacion;
  prospecto_id: string | null;
  /** Incluye es_dueno_directo, confianza (0-1), score, motivos… */
  calificacion: Calificacion | null;
  mensaje_borrador: string | null;
  canal: string | null;
  motivo: string | null; // por qué se descartó / de quién es duplicado
  uso: UsoRegistrado[];
}
