// Tipos compartidos entre el route handler (persistencia) y el cliente
// (render + envío del historial). Un turno de chat es una lista de `Parte`;
// así queda guardado literal en `bi_mensajes.contenido` (jsonb).

import type { GraficoSpec } from './grafico';

export interface InformeSpec {
  id?: string;
  tipo: 'brief_diario' | 'informe' | 'otro';
  titulo: string;
  resumen?: string;
  contenido_markdown: string;
  created_at?: string;
}

export type Parte =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'grafico'; grafico: GraficoSpec }
  | { tipo: 'informe'; informe: InformeSpec };

export interface Turno {
  rol: 'usuario' | 'asesor';
  partes: Parte[];
}

// Texto plano de un turno (para enviar el historial a la API como contexto
// del LLM: HumanMessage/AIMessage son texto, no bloques estructurados).
export function textoDeTurno(t: Turno): string {
  return t.partes
    .map((p) => {
      if (p.tipo === 'texto') return p.texto;
      if (p.tipo === 'grafico') return `[Gráfico mostrado: ${p.grafico.titulo}]`;
      return `[Informe guardado: ${p.informe.titulo}]`;
    })
    .join('\n')
    .trim();
}
