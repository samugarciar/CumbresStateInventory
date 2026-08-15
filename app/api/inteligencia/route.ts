import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { consultaBI } from '@/lib/bi/db';
import { consultaERP, type RecursoERP } from '@/lib/bi/erp';
import { PROMPT_ARRIENDABOT, contextoVariable } from '@/lib/bi/prompt';
import { calcularCostoUSD, MODELO_BI } from '@/lib/bi/costos';
import type { Parte } from '@/lib/bi/parte';

// Bucle agéntico (LangGraph) con varias consultas SQL/ERP + modelo:
// necesita más que el timeout por defecto de Vercel.
export const maxDuration = 300;

const MODELO = MODELO_BI;
// Cada iteración del agente son ~2 pasos del grafo (modelo + herramientas).
const LIMITE_RECURSION = 35;

const esquemaGrafico = z
  .object({
    tipo: z
      .enum(['barras', 'barras_horizontales', 'lineas', 'area', 'pastel'])
      .describe('lineas/area para evolución temporal; barras para comparar categorías; barras_horizontales para top-N o etiquetas largas; pastel SOLO para composición con ≤6 porciones.'),
    titulo: z.string().describe('Título corto que diga qué se ve y el período. Ej: "Citas por semana — últimas 8 semanas".'),
    etiquetas: z.array(z.string()).min(1).max(31).describe('Categorías del eje X (o porciones del pastel). Cortas.'),
    series: z
      .array(z.object({ nombre: z.string(), datos: z.array(z.number()) }))
      .min(1)
      .max(4)
      .describe('1 a 4 series; cada una con tantos datos como etiquetas. En pastel, exactamente 1.'),
    formato: z
      .enum(['numero', 'moneda', 'porcentaje'])
      .optional()
      .describe(
        "Escala de los valores de 'datos'. 'moneda' = pesos colombianos, manda el valor en pesos sin dividir (12500000, no 12.5). 'porcentaje' = manda el número YA en escala 0-100 (42 significa 42 %, NO 0.42 — multiplica por 100 en el SQL). 'numero' para conteos. Si el gráfico es de dinero, 'moneda' es obligatorio."
      ),
    nota: z.string().optional().describe('Nota corta bajo el gráfico (fuente/período/aclaración).'),
  })
  .superRefine((s, ctx) => {
    for (const serie of s.series) {
      if (serie.datos.length !== s.etiquetas.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La serie "${serie.nombre}" trae ${serie.datos.length} datos y hay ${s.etiquetas.length} etiquetas: deben coincidir exactamente.`,
        });
      }
    }
    // El renderer usa solo series[0] en pastel y descartaría el resto en
    // silencio; y un pastel de muchas porciones es ilegible.
    if (s.tipo === 'pastel') {
      if (s.series.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Un gráfico 'pastel' admite exactamente 1 serie (las demás se descartarían). Usa 'barras' para comparar varias series.",
        });
      }
      if (s.etiquetas.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `'pastel' admite máximo 6 porciones y mandaste ${s.etiquetas.length}. Agrupa el resto en "Otros" o usa 'barras_horizontales'.`,
        });
      }
      if (s.series[0]?.datos.some((d) => d < 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Un 'pastel' no puede tener valores negativos (no son partes de un todo). Usa 'barras'.",
        });
      }
    }
    if (s.series.some((serie) => serie.datos.some((d) => !Number.isFinite(d)))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hay valores no numéricos (NaN/Infinity) en los datos: convierte los nulos a 0 o excluye esa categoría.',
      });
    }
  });

const esquemaInforme = z.object({
  tipo: z
    .enum(['brief_diario', 'informe', 'otro'])
    .describe(
      "'brief_diario' para el resumen del día completo; 'informe' para un análisis puntual (ej. cartera, un asesor, una unidad); 'otro' SOLO para un documento de varias secciones que no sea ninguno de los dos (un acta, un checklist pedido por escrito). Si dudas entre 'otro' y responder en texto, responde en texto y no llames esta herramienta."
    ),
  titulo: z.string().describe('Título corto e identificable en una lista. Ej: "Brief del día — 16 jul" o "Cartera vencida — julio".'),
  resumen: z.string().max(240).optional().describe('1-2 líneas para reconocerlo luego en la lista de informes guardados (no repitas el título).'),
  contenido_markdown: z
    .string()
    .describe('Cuerpo completo del informe en markdown simple (##, **negritas**, listas con "-"). Autocontenido: no dependas de texto fuera de este bloque.'),
});

function herramientaBaseDatosPara(inmobiliariaId: string) {
  return tool(
    async ({ consulta }) => {
      try {
        const resultado = await consultaBI(consulta, inmobiliariaId);

        // Cero filas NO es un error, pero tampoco "no hay datos": casi siempre
        // es un filtro mal escrito. Un `[]` pelado se leía como lo segundo y
        // terminaba reportado como incidencia del sync.
        if (resultado.filas.length === 0) {
          return (
            'SIN_FILAS: la consulta se ejecutó correctamente y devolvió 0 filas (si hubiera fallado, habrías ' +
            'recibido un error, no un resultado vacío). Antes de afirmar "no hay datos" o de reportar una ' +
            'incidencia, revisa tus filtros con una consulta de control: inmobiliaria_id, rangos de fecha, y los ' +
            'valores exactos de los enums — van en MINÚSCULA (estado, origen, tipo_transaccion, alcance).'
          );
        }

        const sobre = JSON.stringify({
          total_filas_de_la_consulta: resultado.totalFilas,
          filas_devueltas: resultado.filas.length,
          truncado: resultado.truncado,
          ...(resultado.truncado && {
            nota_truncado: `Se muestran ${resultado.filas.length} de ${resultado.totalFilas} filas. NO cuentes ni sumes sobre estas filas: reescribe la consulta con COUNT/SUM/GROUP BY.`,
          }),
          ...(resultado.hayCeldasRecortadas && {
            aviso_celdas:
              'Algunos textos se cortaron a 500 caracteres y terminan en "…[recortado]": no los cites como texto completo.',
          }),
          filas: resultado.filas,
        });

        // Tope de tamaño: sin esto, un SELECT * de 200 filas con columnas jsonb
        // se acerca al megabyte, y ese megabyte se re-paga en cada iteración.
        return sobre.length > 40_000
          ? sobre.slice(0, 40_000) +
              '…(truncado a 40k caracteres — el JSON queda INCOMPLETO y sintácticamente inválido, NO lo ' +
              'interpretes como datos completos. No uses SELECT *: lista solo las columnas que necesitas, ' +
              'excluye columnas jsonb como aptos_snapshot, o agrega con GROUP BY y vuelve a consultar.)'
          : sobre;
      } catch (e) {
        // Devolver string (no lanzar): ToolNode lo entrega como resultado
        // normal, sin la coletilla "Please fix your mistakes" que LangGraph
        // añade a todo error y que hace ver un timeout o un fallo de infra
        // como "tu SQL está mal".
        const pg = e as { message: string; code?: string; hint?: string; detail?: string; position?: string };
        if (pg.message?.startsWith('FILTRO_TENANT_FALTANTE') || pg.message?.startsWith('Solo se permite')) {
          return `ERROR_CONSULTA: ${pg.message}`;
        }
        if (pg.code === '57014') {
          return 'ERROR_TIEMPO: superaste el statement_timeout de 20 s. NO repitas la misma consulta: acota el rango de fechas, agrega con GROUP BY o reduce los JOIN.';
        }
        if (pg.code === '42501') {
          return `ERROR_PERMISO: ${pg.message}. Solo puedes leer inmobiliarias, usuarios, inmuebles, inventarios, franjas_horarias, franjas_inmuebles, citas, solicitudes_apertura, tareas y webhook_logs. No es una incidencia: usa otra fuente o dilo.`;
        }
        if (pg.code?.startsWith('42')) {
          return (
            `ERROR_SQL ${pg.code}: ${pg.message}` +
            `${pg.hint ? ` | HINT: ${pg.hint}` : ''}${pg.detail ? ` | DETALLE: ${pg.detail}` : ''}` +
            `${pg.position ? ` | posición ${pg.position}` : ''}. Corrige la consulta; si dudas de un nombre de columna, consúltalo en el esquema del prompt.`
          );
        }
        return `ERROR_INFRA: no se pudo ejecutar la consulta (${pg.message}). Esto NO es un fallo de tu SQL: reintenta como máximo una vez y, si persiste, repórtalo al usuario como posible incidencia SIN inventar cifras ni sustituirlas por datos del ERP.`;
      }
    },
    {
      name: 'consultar_base_datos',
      description:
        'Ejecuta una consulta SQL de SOLO LECTURA (SELECT/WITH) sobre la base de datos de la aplicación (PostgreSQL). Úsala para actividad comercial: citas, agenda, solicitudes de apertura, inventario ofertable, captaciones, tareas. ' +
        'OBLIGATORIO: la conexión NO aplica aislamiento por inmobiliaria — TODA tabla base del FROM y de CADA JOIN debe llevar su propio inmobiliaria_id = \'<uuid del contexto>\'; no basta filtrarlo en una sola tabla del JOIN, y una consulta sin ese filtro será rechazada. ' +
        'Devuelve {total_filas_de_la_consulta, filas_devueltas, truncado, filas:[…]} — los datos están en `filas`; un resultado vacío casi nunca significa "no hay datos", suele ser un filtro mal escrito. ' +
        'Máximo 200 filas: agrega en SQL en vez de traer detalle masivo, y nunca uses SELECT *. ' +
        'Tipos: las columnas date y timestamp SIN zona vuelven como texto plano en hora local ("2026-08-14", "2026-08-14 22:05:00"), sin sufijo Z — NO les apliques otra conversión horaria; solo timestamptz (created_at crudo) vuelve en ISO UTC con Z. Para contar usa count(*)::int.',
      schema: z.object({
        consulta: z.string().describe('Una sola sentencia SELECT (o WITH ... SELECT), sin punto y coma final.'),
      }),
    }
  );
}

const LIMITE_RESULTADO_ERP = 60_000;

/**
 * Recorta por REGISTROS COMPLETOS, no por caracteres. Un slice() sobre el JSON
 * ya serializado entrega un documento sintácticamente inválido, cortado en
 * cualquier punto (potencialmente a mitad de una cédula), y borra justo las
 * claves de completitud. Aquí se conservan intactas las claves de contexto
 * (consulta_aplicada, paginacion, resumen, diagnostico) y solo se acorta el
 * array dominante.
 */
function recortarResultadoERP(datos: unknown): string {
  const texto = JSON.stringify(datos);
  if (texto.length <= LIMITE_RESULTADO_ERP) return texto;

  if (datos && typeof datos === 'object' && !Array.isArray(datos)) {
    const obj = datos as Record<string, unknown>;
    const claveArray = ['registros', 'facturas', 'contratos'].find((k) => Array.isArray(obj[k]));
    if (claveArray) {
      const arr = obj[claveArray] as unknown[];
      const resto = { ...obj };
      delete resto[claveArray];
      const presupuesto = LIMITE_RESULTADO_ERP - JSON.stringify(resto).length - 500;
      const recortados: unknown[] = [];
      let usado = 0;
      for (const item of arr) {
        const tam = JSON.stringify(item).length + 1;
        if (usado + tam > presupuesto) break;
        recortados.push(item);
        usado += tam;
      }
      return JSON.stringify({
        ...resto,
        registros_omitidos: arr.length - recortados.length,
        aviso_recorte:
          `Resultado recortado por tamaño: se muestran ${recortados.length} de ${arr.length} registros COMPLETOS ` +
          '(ninguno partido a la mitad). Los agregados que calcules sobre esta muestra NO representan el total. ' +
          'No pagines listados crudos: usa buscar_factura/buscar_contrato/cartera_resumen, o baja por_pagina.',
        [claveArray]: recortados,
      });
    }
  }

  return (
    texto.slice(0, LIMITE_RESULTADO_ERP) +
    '…(truncado: el JSON queda INCOMPLETO, no lo interpretes como datos completos — usa buscar_factura/buscar_contrato/cartera_resumen o un por_pagina menor)'
  );
}

const herramientaERP = tool(
  async ({ recurso, ...params }) => {
    // Guarda de tamaño: cada carácter de un resultado de herramienta se
    // RE-ENVÍA al modelo en todas las iteraciones siguientes del bucle
    // (una respuesta de 150k chars llegó a costar ~256k tokens de input en
    // una sola llamada). Si esto recorta, la consulta estaba mal planteada.
    return recortarResultadoERP(await consultaERP(recurso as RecursoERP, params));
  },
  {
    name: 'consultar_erp',
    description:
      'Consulta de SOLO LECTURA al ERP Nuby/Arrendasoft: la fuente de verdad del portafolio y del dinero (contratos, cánones, facturación, cartera, asesores y contabilidad). ' +
      'Cada recurso acepta solo SU juego de parámetros: pasarle uno ajeno devuelve error en vez de ignorarlo en silencio. ' +
      'Los resultados traen primero las claves de contexto (consulta_aplicada, resumen, diagnostico): léelas antes de citar cifras.',
    schema: z.object({
      recurso: z
        .enum([
          'propiedades',
          'propiedad',
          'contratos',
          'facturas',
          'buscar_factura',
          'cartera_resumen',
          'buscar_contrato',
          'asesores',
          'estados',
          'auxiliar_contable',
        ])
        .describe(
          "Qué consultar. DEUDA DE UNA PERSONA O CONTRATO → 'buscar_factura' (recorre todo el histórico y filtra por ti; devuelve solo lo FACTURADO, así que lee cobertura_facturacion.conclusion_permitida antes de redactar: si dice que no puedes afirmar que está al día, no lo afirmes). " +
            "CARTERA TOTAL de la inmobiliaria (saldo total/vencido, top deudores) → 'cartera_resumen'. " +
            "UBICAR UN CONTRATO por cédula, número o nombre → 'buscar_contrato'. " +
            "'facturas'/'contratos'/'propiedades' son listados crudos paginados, solo para HOJEAR los últimos registros: NO sirven para buscar a alguien ni para totalizar (el ERP no filtra server-side y son miles de registros). " +
            "'propiedad' pide la ficha completa de un inmueble por su código ERP."
        ),
      pagina: z.number().int().min(1).optional().describe('Página del listado (por defecto 1). Solo propiedades/contratos/facturas.'),
      por_pagina: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe(
          'Registros por página, 1-200 (por defecto 50). Solo propiedades/contratos/facturas. Estos listados sirven para HOJEAR, no para buscar ni totalizar: pide 20-50. El orden lo define el ERP: no asumas que la página 1 son los más recientes.'
        ),
      codigo: z.string().optional().describe("Código ERP del inmueble (solo 'propiedad'). Si no lo tienes, búscalo en la app: inmuebles.arrendasoft_id."),
      documento: z
        .string()
        .optional()
        .describe(
          'Cédula/NIT exacto (buscar_factura / buscar_contrato). Es el filtro PREFERIDO: es el único que identifica a una persona sin ambigüedad. Si pasas varios filtros se combinan en AND (deben cumplirse todos).'
        ),
      contrato_numero: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          "Número de contrato tal como lo dice el usuario (el 'consecutivo' que ve el personal, NO el contrato_id interno) — buscar_factura / buscar_contrato. Se combina en AND con los demás filtros."
        ),
      nombre_contiene: z
        .string()
        .optional()
        .describe(
          "Fragmento de nombre, solo como respaldo si no tienes el documento (buscar_factura / buscar_contrato). Se ignoran tildes, mayúsculas y el orden de las palabras, pero TODAS las que pases deben aparecer: usa pocas y distintivas (apellidos), no el nombre completo. Los nombres vienen como '[N] documento - APELLIDOS NOMBRES'. Puede traer homónimos: confirma con documento antes de citar un saldo."
        ),
      fecha_ini: z
        .string()
        .optional()
        .describe('YYYY-MM-DD (solo auxiliar_contable). Pásalo SIEMPRE: sin rango la cifra queda sin período conocido y el volumen puede recortarse.'),
      fecha_fin: z.string().optional().describe('YYYY-MM-DD (solo auxiliar_contable). Pásalo SIEMPRE (ver fecha_ini).'),
      cuenta_ini: z
        .string()
        .regex(/^[1-9]\d{0,7}$/, "cuenta_ini debe ser un prefijo PUC numérico de 1 a 8 dígitos, ej. '1305'.")
        .optional()
        .describe(
          "Prefijo de cuenta PUC (texto, 1 a 8 dígitos), NO un solo dígito por defecto: '1' todo el activo, '13' deudores/cartera, '1305' cuentas por cobrar (los inquilinos están en 13050502), '4' ingresos, '5' gastos. Usa SIEMPRE el prefijo más específico que responda la pregunta: '1' o '4' a secas devuelven miles de terceros y la respuesta se recorta. Solo auxiliar_contable."
        ),
      cuenta_fin: z
        .string()
        .regex(/^[1-9]\d{0,7}$/, "cuenta_fin debe ser un prefijo PUC numérico de 1 a 8 dígitos, ej. '1305'.")
        .optional()
        .describe(
          "Prefijo PUC final, INCLUSIVO: el servidor lo expande con 9s, no le agregues 9s tú. Para una sola familia repite el mismo valor de cuenta_ini ('13' + '13' → todas las 13xx). Solo auxiliar_contable."
        ),
      con_detalles: z
        .boolean()
        .optional()
        .describe('auxiliar_contable: true para incluir los movimientos por tercero (por defecto solo saldos, mucho más liviano).'),
    }),
  }
);

interface TurnoCliente {
  rol: 'usuario' | 'asesor';
  texto: string;
}

/** Extrae el texto de un chunk de streaming (string o bloques de contenido). */
function textoDeChunk(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido;
  if (Array.isArray(contenido)) {
    return contenido
      .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('');
  }
  return '';
}

// Título corto y legible a partir del primer mensaje del usuario (fallback
// simple, sin llamada extra al modelo — igual que cualquier chat).
function tituloDesde(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return 'Nueva conversación';
  return limpio.length > 60 ? limpio.slice(0, 60).trimEnd() + '…' : limpio;
}

// Inicio del mes actual en Bogotá, como instante UTC (00:00 -05 = 05:00Z;
// Colombia no tiene horario de verano). Para acotar el gasto mensual en bi_uso.
function inicioMesBogotaISO(): string {
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return `${ym}-01T05:00:00.000Z`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.profile) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }
  if (user.profile.rol !== 'admin') {
    return Response.json({ error: 'Solo administradores' }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'Falta configurar ANTHROPIC_API_KEY' }, { status: 500 });
  }

  const cuerpo = await request.json().catch(() => null);
  const turnos: TurnoCliente[] = Array.isArray(cuerpo?.mensajes) ? cuerpo.mensajes : [];
  if (turnos.length === 0 || turnos[turnos.length - 1].rol !== 'usuario') {
    return Response.json({ error: 'Petición inválida' }, { status: 400 });
  }
  const conversacionIdSolicitada: string | null =
    typeof cuerpo?.conversacion_id === 'string' ? cuerpo.conversacion_id : null;

  // Cliente ligado a la sesión (cookies) para persistir bajo RLS del propio
  // usuario — no service_role: si el token expiró a mitad del chat, las
  // escrituras fallan igual que cualquier otra lectura de la app.
  const supabase = await createClient();

  // ---- Administración de agentes (/agentes): switch + límite mensual ----
  // Sin fila de config = activo (la pausa es una acción explícita del admin).
  const { data: configBI } = await supabase
    .from('agentes_config')
    .select('activo, limite_mensual_usd')
    .eq('agente', 'arriendabot_bi')
    .maybeSingle();

  if (configBI && !configBI.activo) {
    return Response.json(
      { error: 'El asesor BI está pausado. Puedes reactivarlo en Agentes.' },
      { status: 403 }
    );
  }

  if (configBI?.limite_mensual_usd) {
    const { data: usoMes } = await supabase
      .from('bi_uso')
      .select('costo_usd')
      .gte('created_at', inicioMesBogotaISO());
    const gastado = (usoMes || []).reduce((acc, r) => acc + Number(r.costo_usd || 0), 0);
    const limite = Number(configBI.limite_mensual_usd);
    if (gastado >= limite) {
      return Response.json(
        {
          error: `El asesor BI alcanzó su límite mensual de USD $${limite.toFixed(2)} (gastado: $${gastado.toFixed(2)}). Ajusta o quita el límite en Agentes.`,
        },
        { status: 403 }
      );
    }
  }

  const modelo = new ChatAnthropic({
    model: MODELO,
    maxTokens: 16000,
    thinking: { type: 'adaptive' },
  });

  // Prompt del sistema: bloque estable con cache_control (prompt caching) +
  // bloque variable (inmobiliaria/usuario/fecha) al final.
  const sistema = new SystemMessage({
    content: [
      { type: 'text', text: PROMPT_ARRIENDABOT, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: contextoVariable({
          inmobiliariaId: user.profile.inmobiliaria_id,
          inmobiliariaNombre: user.inmobiliaria?.nombre ?? 'la inmobiliaria',
          usuarioNombre: user.profile.nombre_completo,
        }),
      },
    ],
  });

  const historial = turnos
    .filter((t) => typeof t.texto === 'string' && t.texto.trim())
    // Conversaciones largas: los turnos viejos rara vez cambian la respuesta
    // y se pagan completos en cada petición nueva (el caché expira en 5 min).
    .slice(-30)
    .map((t) => (t.rol === 'usuario' ? new HumanMessage(t.texto) : new AIMessage(t.texto)));

  const codificador = new TextEncoder();

  const stream = new ReadableStream({
    async start(controlador) {
      const emitir = (evento: Record<string, unknown>) =>
        controlador.enqueue(codificador.encode(JSON.stringify(evento) + '\n'));

      // ---- Resolver o crear la conversación (antes de correr el agente,
      // para poder emitir su id de inmediato y para que la tool de informe
      // pueda referenciarla). ----
      let conversacionId = conversacionIdSolicitada;
      if (conversacionId) {
        const { data } = await supabase
          .from('bi_conversaciones')
          .select('id')
          .eq('id', conversacionId)
          .maybeSingle();
        if (!data) conversacionId = null; // no existe o no es del usuario (RLS) → se crea una nueva
      }
      if (!conversacionId) {
        const { data, error } = await supabase
          .from('bi_conversaciones')
          .insert({
            inmobiliaria_id: user.profile!.inmobiliaria_id,
            usuario_id: user.profile!.id,
            titulo: tituloDesde(turnos[0]?.texto ?? ''),
          })
          .select('id')
          .single();
        if (error || !data) {
          console.error('Error creando conversación BI:', error?.message);
          emitir({ tipo: 'error', mensaje: 'No se pudo iniciar la conversación.' });
          controlador.close();
          return;
        }
        conversacionId = data.id;
      }
      emitir({ tipo: 'conversacion', id: conversacionId });

      // Mensaje del usuario que disparó esta petición (el último del array;
      // los anteriores, si los hay, ya se persistieron en llamadas previas).
      const ultimoUsuario = turnos[turnos.length - 1];
      await supabase.from('bi_mensajes').insert({
        conversacion_id: conversacionId,
        rol: 'usuario',
        contenido: [{ tipo: 'texto', texto: ultimoUsuario.texto }] satisfies Parte[],
      });
      await supabase
        .from('bi_conversaciones')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversacionId);

      // Medición de uso (tokens → USD) para /agentes: se acumula lo que
      // reporta cada llamada al modelo dentro del bucle agéntico.
      let usoEntrada = 0;
      let usoSalida = 0;
      let usoCacheLectura = 0;
      let usoCacheEscritura = 0;

      // Partes de la respuesta del asesor, acumuladas para persistir un solo
      // mensaje al final (igual que el cliente arma la burbuja en vivo).
      const partesAsesor: Parte[] = [];
      const agregarParteTexto = (fragmento: string) => {
        const ultima = partesAsesor[partesAsesor.length - 1];
        if (ultima && ultima.tipo === 'texto') ultima.texto += fragmento;
        else partesAsesor.push({ tipo: 'texto', texto: fragmento });
      };

      // Definidas aquí (closure sobre conversacionId/emitir) para poder
      // escribir directo al stream y a la base.
      const herramientaGrafico = tool(
        async (spec) => {
          emitir({ tipo: 'grafico', grafico: spec });
          partesAsesor.push({ tipo: 'grafico', grafico: spec });
          return 'Gráfico mostrado al usuario. Continúa con el insight en texto (no repitas los números del gráfico uno a uno).';
        },
        {
          name: 'mostrar_grafico',
          description:
            'Muestra un gráfico interactivo al usuario dentro del chat. Úsala cuando los datos ganen con visualización: evolución temporal, comparación entre categorías, top-N o composición. Llama a esta herramienta DESPUÉS de obtener los datos con las otras herramientas, nunca con datos inventados.',
          schema: esquemaGrafico,
        }
      );

      const herramientaInforme = tool(
        async (spec) => {
          const { data, error } = await supabase
            .from('bi_artefactos')
            .insert({
              inmobiliaria_id: user.profile!.inmobiliaria_id,
              usuario_id: user.profile!.id,
              conversacion_id: conversacionId,
              tipo: spec.tipo,
              titulo: spec.titulo,
              resumen: spec.resumen ?? null,
              contenido_markdown: spec.contenido_markdown,
            })
            .select('id, created_at')
            .single();

          if (error || !data) {
            console.error('Error guardando informe BI:', error?.message);
            // El informe NO se emitió al stream (eso ocurre más abajo, solo en
            // el camino feliz): en el chat no apareció nada. Decir "sigue
            // mostrándolo" hacía que el modelo se disculpara en una línea y se
            // perdiera el brief entero, ya pagado como tokens de salida.
            return (
              'FALLO: el informe NO se guardó y NO se mostró — en el chat no apareció nada de su contenido. ' +
              'Escribe AHORA el informe completo como texto normal en tu respuesta (todo el contenido_markdown, ' +
              'no un resumen) y cierra con una línea avisando que no quedó guardado en la lista de Informes.'
            );
          }

          const informe = { ...spec, id: data.id, created_at: data.created_at };
          emitir({ tipo: 'informe', informe });
          partesAsesor.push({ tipo: 'informe', informe });
          return 'Informe guardado y mostrado al usuario (ya quedó disponible en su lista de Informes). Continúa solo con un comentario breve si aporta algo nuevo; no repitas el contenido del informe en texto plano.';
        },
        {
          name: 'generar_informe',
          description:
            'Genera y guarda un informe/brief completo que el usuario podrá volver a ver después en la lista de Informes de la app, sin depender de esta conversación. Úsala cuando pidan "el brief", "un informe de…" o un resumen ejecutivo — NO para responder una pregunta puntual con una sola cifra.',
          schema: esquemaInforme,
        }
      );

      const tools = [
        herramientaBaseDatosPara(user.profile!.inmobiliaria_id),
        herramientaERP,
        herramientaGrafico,
        herramientaInforme,
      ];

      // cache_control de nivel superior (API de Anthropic): en cada llamada
      // mueve un breakpoint de caché al final de la conversación, así la
      // SIGUIENTE iteración del bucle agéntico lee todo el historial previo
      // (incluidos los resultados de herramientas, el grueso del costo) a
      // 0.1x en vez de re-pagarlo a precio completo. El bloque estable del
      // sistema conserva su breakpoint propio (arriba).
      const llmConCache = modelo.bindTools(tools, { cache_control: { type: 'ephemeral' } });

      const agente = createReactAgent({
        llm: llmConCache,
        tools,
        prompt: sistema,
      });

      try {
        const eventos = agente.streamEvents(
          { messages: historial },
          { version: 'v2', recursionLimit: LIMITE_RECURSION }
        );

        for await (const evento of eventos) {
          if (evento.event === 'on_chat_model_stream') {
            const texto = textoDeChunk(evento.data?.chunk?.content);
            if (texto) {
              emitir({ tipo: 'texto', texto });
              agregarParteTexto(texto);
            }
          } else if (evento.event === 'on_tool_start') {
            const input = (evento.data?.input ?? {}) as Record<string, unknown>;
            emitir({
              tipo: 'herramienta',
              nombre: evento.name,
              detalle:
                evento.name === 'consultar_base_datos'
                  ? String(input.consulta ?? '')
                  : evento.name === 'mostrar_grafico' || evento.name === 'generar_informe'
                    ? String(input.titulo ?? '')
                    : String(input.recurso ?? ''),
            });
          } else if (evento.event === 'on_chat_model_end') {
            // usage_metadata de LangChain: input_tokens YA incluye los tokens
            // de cache; el desglose viene en input_token_details.
            const um = (evento.data?.output as { usage_metadata?: Record<string, unknown> } | undefined)
              ?.usage_metadata;
            if (um) {
              const det = (um.input_token_details ?? {}) as Record<string, unknown>;
              const cacheLectura = Number(det.cache_read ?? 0) || 0;
              const cacheEscritura = Number(det.cache_creation ?? 0) || 0;
              usoEntrada += Math.max(0, (Number(um.input_tokens ?? 0) || 0) - cacheLectura - cacheEscritura);
              usoSalida += Number(um.output_tokens ?? 0) || 0;
              usoCacheLectura += cacheLectura;
              usoCacheEscritura += cacheEscritura;
            }
          }
        }

        emitir({ tipo: 'fin' });
      } catch (error) {
        console.error('Error en el asesor BI:', error);
        const mensaje = error instanceof Error ? error.message : String(error);
        const mensajeUsuario = mensaje.includes('recursion')
          ? 'La pregunta requirió demasiados pasos; intenta acotarla.'
          : 'Error consultando los datos. Intenta de nuevo.';
        emitir({ tipo: 'error', mensaje: mensajeUsuario });
        agregarParteTexto(`\n\n⚠️ ${mensajeUsuario}`);
      } finally {
        if (partesAsesor.length > 0) {
          await supabase.from('bi_mensajes').insert({
            conversacion_id: conversacionId,
            rol: 'asesor',
            contenido: partesAsesor,
          });
          await supabase
            .from('bi_conversaciones')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversacionId);
        }
        // Registrar el uso de la petición (best-effort: si falla, el chat
        // ya respondió; solo se pierde la fila de medición).
        if (usoEntrada + usoSalida + usoCacheLectura + usoCacheEscritura > 0) {
          const { error: usoError } = await supabase.from('bi_uso').insert({
            inmobiliaria_id: user.profile!.inmobiliaria_id,
            usuario_id: user.profile!.id,
            conversacion_id: conversacionId,
            modelo: MODELO,
            tokens_entrada: usoEntrada,
            tokens_salida: usoSalida,
            tokens_cache_lectura: usoCacheLectura,
            tokens_cache_escritura: usoCacheEscritura,
            costo_usd: calcularCostoUSD(MODELO, {
              entrada: usoEntrada,
              salida: usoSalida,
              cacheLectura: usoCacheLectura,
              cacheEscritura: usoCacheEscritura,
            }),
          });
          if (usoError) console.warn('[BI] No se pudo registrar el uso:', usoError.message);
        }
        controlador.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
