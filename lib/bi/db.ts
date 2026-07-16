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
    _sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  }
  return _sql;
}

export interface ResultadoConsulta {
  filas: Record<string, unknown>[];
  totalFilas: number;
  truncado: boolean;
}

export async function consultaBI(consulta: string): Promise<ResultadoConsulta> {
  const limpia = consulta.trim().replace(/;+\s*$/, '');
  // Solo lectura por rol; esto es una segunda guarda de forma.
  if (!/^(select|with)\b/i.test(limpia)) {
    throw new Error('Solo se permiten consultas SELECT (o WITH ... SELECT).');
  }
  if (limpia.includes(';')) {
    throw new Error('Solo se permite una sentencia por consulta.');
  }

  const sql = getClient();
  const filas = (await sql.unsafe(limpia)) as unknown as Record<string, unknown>[];

  const truncado = filas.length > MAX_FILAS;
  const recortadas = filas.slice(0, MAX_FILAS).map((fila) => {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fila)) {
      salida[k] =
        typeof v === 'string' && v.length > MAX_CELDA ? v.slice(0, MAX_CELDA) + '…' : v;
    }
    return salida;
  });

  return { filas: recortadas, totalFilas: filas.length, truncado };
}
