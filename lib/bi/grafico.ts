// Spec de gráfico que el agente BI emite (herramienta mostrar_grafico) y el
// chat renderiza. Compartida entre el route handler y el cliente.

export type TipoGrafico = 'barras' | 'barras_horizontales' | 'lineas' | 'area' | 'pastel';

export interface SerieGrafico {
  nombre: string;
  datos: number[];
}

export interface GraficoSpec {
  tipo: TipoGrafico;
  titulo: string;
  /** Categorías del eje X (o porciones en pastel). Misma longitud que cada serie. */
  etiquetas: string[];
  /** 1 a 4 series. En pastel solo se usa la primera. */
  series: SerieGrafico[];
  formato?: 'numero' | 'moneda' | 'porcentaje';
  /** Nota corta bajo el gráfico (fuente, período, aclaración). */
  nota?: string;
}
