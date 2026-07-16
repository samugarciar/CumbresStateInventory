import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth-helpers';
import { consultaBI } from '@/lib/bi/db';
import { consultaERP, type RecursoERP } from '@/lib/bi/erp';
import { PROMPT_ARRIENDABOT, contextoVariable } from '@/lib/bi/prompt';

// Bucle agéntico (LangGraph) con varias consultas SQL/ERP + modelo:
// necesita más que el timeout por defecto de Vercel.
export const maxDuration = 300;

const MODELO = process.env.BI_MODEL || 'claude-opus-4-8';
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
    formato: z.enum(['numero', 'moneda', 'porcentaje']).optional().describe('moneda = pesos colombianos.'),
    nota: z.string().optional().describe('Nota corta bajo el gráfico (fuente/período/aclaración).'),
  })
  .refine((s) => s.series.every((x) => x.datos.length === s.etiquetas.length), {
    message: 'Cada serie debe tener exactamente tantos datos como etiquetas.',
  });

const herramientaBaseDatos = tool(
  async ({ consulta }) => {
    const resultado = await consultaBI(consulta);
    const nota = resultado.truncado
      ? `\n(Truncado: se muestran 200 de ${resultado.totalFilas} filas — agrega en SQL.)`
      : '';
    return JSON.stringify(resultado.filas) + nota;
  },
  {
    name: 'consultar_base_datos',
    description:
      'Ejecuta una consulta SQL de SOLO LECTURA (SELECT/WITH) sobre la base de datos de la aplicación (PostgreSQL). Úsala para actividad comercial: citas, agenda, solicitudes de apertura, inventario ofertable, captaciones, tareas. Máximo ~200 filas: agrega en SQL. Filtra siempre por el inmobiliaria_id indicado en el contexto.',
    schema: z.object({
      consulta: z.string().describe('Una sola sentencia SELECT (o WITH ... SELECT).'),
    }),
  }
);

const herramientaERP = tool(
  async ({ recurso, ...params }) => {
    const datos = await consultaERP(recurso as RecursoERP, params);
    const texto = JSON.stringify(datos);
    // Guarda de tamaño: los listados del ERP pueden ser grandes.
    return texto.length > 150_000 ? texto.slice(0, 150_000) + '…(truncado)' : texto;
  },
  {
    name: 'consultar_erp',
    description:
      'Consulta de SOLO LECTURA al ERP Nuby/Arrendasoft. Úsala para la fuente de verdad del portafolio y del dinero: contratos, cánones, facturación, cartera, asesores y contabilidad.',
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
          "Recurso del ERP a consultar. Para la cartera/facturas de UNA persona o contrato usa 'buscar_factura'; para cifras agregadas de cartera (total, vencida, top deudores) usa 'cartera_resumen'; para ubicar un contrato usa 'buscar_contrato'. 'facturas'/'contratos' sin filtro son listados crudos paginados — NO sirven para buscar a alguien puntual."
        ),
      pagina: z.number().int().optional().describe('Página del listado (por defecto 1; solo propiedades/contratos/facturas).'),
      por_pagina: z.number().int().optional().describe('Registros por página (máx 1000; solo propiedades/contratos/facturas).'),
      codigo: z.string().optional().describe("Código ERP de la propiedad (solo para recurso 'propiedad')."),
      documento: z.string().optional().describe('Cédula/NIT a buscar (buscar_factura / buscar_contrato).'),
      contrato_numero: z.union([z.string(), z.number()]).optional().describe("El número de contrato tal como lo dice el usuario (el 'consecutivo', no el ID interno) — buscar_factura / buscar_contrato."),
      nombre_contiene: z.string().optional().describe('Fragmento de nombre a buscar, como respaldo si no hay documento (buscar_factura / buscar_contrato).'),
      fecha_ini: z.string().optional().describe('YYYY-MM-DD (solo auxiliar_contable).'),
      fecha_fin: z.string().optional().describe('YYYY-MM-DD (solo auxiliar_contable).'),
      cuenta_ini: z.string().optional().describe('Clase PUC inicial 1-9 (solo auxiliar_contable).'),
      cuenta_fin: z.string().optional().describe('Clase PUC final 1-9 (solo auxiliar_contable).'),
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
    .map((t) => (t.rol === 'usuario' ? new HumanMessage(t.texto) : new AIMessage(t.texto)));

  const codificador = new TextEncoder();

  const stream = new ReadableStream({
    async start(controlador) {
      const emitir = (evento: Record<string, unknown>) =>
        controlador.enqueue(codificador.encode(JSON.stringify(evento) + '\n'));

      // Definida aquí para poder empujar el gráfico (ya validado por Zod)
      // directamente al stream del cliente.
      const herramientaGrafico = tool(
        async (spec) => {
          emitir({ tipo: 'grafico', grafico: spec });
          return 'Gráfico mostrado al usuario. Continúa con el insight en texto (no repitas los números del gráfico uno a uno).';
        },
        {
          name: 'mostrar_grafico',
          description:
            'Muestra un gráfico interactivo al usuario dentro del chat. Úsala cuando los datos ganen con visualización: evolución temporal, comparación entre categorías, top-N o composición. Llama a esta herramienta DESPUÉS de obtener los datos con las otras herramientas, nunca con datos inventados.',
          schema: esquemaGrafico,
        }
      );

      const agente = createReactAgent({
        llm: modelo,
        tools: [herramientaBaseDatos, herramientaERP, herramientaGrafico],
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
            if (texto) emitir({ tipo: 'texto', texto });
          } else if (evento.event === 'on_tool_start') {
            const input = (evento.data?.input ?? {}) as Record<string, unknown>;
            emitir({
              tipo: 'herramienta',
              nombre: evento.name,
              detalle:
                evento.name === 'consultar_base_datos'
                  ? String(input.consulta ?? '')
                  : evento.name === 'mostrar_grafico'
                    ? String(input.titulo ?? '')
                    : String(input.recurso ?? ''),
            });
          }
        }

        emitir({ tipo: 'fin' });
      } catch (error) {
        console.error('Error en el asesor BI:', error);
        const mensaje = error instanceof Error ? error.message : String(error);
        emitir({
          tipo: 'error',
          mensaje: mensaje.includes('recursion')
            ? 'La pregunta requirió demasiados pasos; intenta acotarla.'
            : 'Error consultando los datos. Intenta de nuevo.',
        });
      } finally {
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
