import postgres from 'postgres';

// Conexión de SOLO LECTURA a la base de la app con el rol bi_reader
// (ver supabase/migrations/2026-07-15_bi_reader.sql). El rol ya fuerza
// default_transaction_read_only y statement_timeout=20s; aquí solo
// añadimos guardas de forma y de tamaño de salida.

const MAX_FILAS = 200;
const MAX_CELDA = 500; // caracteres por celda antes de truncar

let _sql: ReturnType<typeof postgres> | null = null;

function getClient() {
  const url = process.env.BI_DATABASE_URL;
  if (!url) {
    throw new Error('Falta la variable de entorno BI_DATABASE_URL (rol bi_reader).');
  }
  if (!_sql) {
    // Una sola conexión por instancia serverless; prepare:false para ser
    // compatible también con el transaction pooler de Supabase.
    _sql = postgres(url, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      types: {
        // numeric (OID 1700) llega como string con el parser por defecto de
        // postgres@3 → el modelo compararía "8300000" > "12500000"
        // (lexicográfico). Se convierte a número; si no es finito se deja el
        // texto. OJO: NO se incluye bigint (OID 20) a propósito —
        // inmuebles.arrendasoft_id es BIGINT y Number perdería precisión por
        // encima de 2^53, corrompiendo identificadores en silencio. Para
        // contar, el modelo debe usar count(*)::int.
        numerico: {
          to: 1700,
          from: [1700],
          serialize: String,
          parse: (x: string) => {
            const n = Number(x);
            return Number.isFinite(n) ? n : x;
          },
        },
        // date (1082) y timestamp SIN zona (1114): devolver el texto tal cual
        // manda el servidor. Si se dejan como Date, JSON.stringify les estampa
        // una "Z" mentirosa: `created_at AT TIME ZONE 'America/Bogota'` (lo que
        // el prompt ordena usar) volvería como "...T22:00:00.000Z" y una fecha
        // DATE se desplazaría un día. timestamptz (1184) se deja intacto: ahí
        // el ISO con Z es correcto.
        fechaLocal: { to: 1082, from: [1082, 1114], serialize: String, parse: (x: string) => x },
      },
    });
  }
  return _sql;
}

export interface ResultadoConsulta {
  filas: Record<string, unknown>[];
  totalFilas: number;
  truncado: boolean;
  hayCeldasRecortadas: boolean;
}

export async function consultaBI(consulta: string, inmobiliariaId: string): Promise<ResultadoConsulta> {
  const limpia = consulta.trim().replace(/;+\s*$/, '');
  // Solo lectura por rol; esto es una segunda guarda de forma.
  if (!/^(select|with)\b/i.test(limpia)) {
    throw new Error('Solo se permiten consultas SELECT (o WITH ... SELECT).');
  }
  if (limpia.includes(';')) {
    throw new Error('Solo se permite una sentencia por consulta.');
  }

  // Cable-trampa de aislamiento multi-inquilino. Las policies de bi_reader son
  // abiertas (USING (true)): el aislamiento depende de que el SQL lo filtre.
  // Es una guarda GRUESA a propósito — un JOIN filtrado en una sola tabla la
  // atraviesa — pero convierte el olvido total (el caso frecuente) en un error
  // que el modelo puede corregir, en vez de filas de otras inmobiliarias.
  if (!limpia.includes(inmobiliariaId)) {
    throw new Error(
      `FILTRO_TENANT_FALTANTE: la consulta no menciona inmobiliaria_id = '${inmobiliariaId}'. ` +
        `La conexión NO aplica aislamiento automático: agrega ese filtro a CADA tabla base del FROM y de ` +
        `CADA JOIN (inmuebles, citas, franjas_horarias, franjas_inmuebles, solicitudes_apertura, tareas, ` +
        `webhook_logs, inventarios, usuarios) y reintenta. No es un error del esquema ni una incidencia.`
    );
  }

  const sql = getClient();
  const filas = (await sql.unsafe(limpia)) as unknown as Record<string, unknown>[];

  const truncado = filas.length > MAX_FILAS;
  let hayCeldasRecortadas = false;
  const recortadas = filas.slice(0, MAX_FILAS).map((fila) => {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fila)) {
      // El driver parsea jsonb a objeto, así que un `typeof v === 'string'`
      // no lo captura y columnas como citas.aptos_snapshot pasaban enteras.
      const texto = typeof v === 'string' ? v : v && typeof v === 'object' ? JSON.stringify(v) : null;
      if (texto !== null && texto.length > MAX_CELDA) {
        hayCeldasRecortadas = true;
        salida[k] = texto.slice(0, MAX_CELDA) + '…[recortado]';
      } else {
        salida[k] = v;
      }
    }
    return salida;
  });

  return { filas: recortadas, totalFilas: filas.length, truncado, hayCeldasRecortadas };
}
