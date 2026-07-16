'use client';

import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { GraficoSpec } from '@/lib/bi/grafico';

// Paleta categórica validada (CVD-safe en este orden fijo — no reordenar ni ciclar).
const PALETA = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];

const INK_MUTED = 'var(--text-secondary)';
const GRID = 'var(--border-color)';

function formateador(formato: GraficoSpec['formato'], compacto = false) {
  if (formato === 'moneda') {
    return (v: number) =>
      new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
        ...(compacto ? { notation: 'compact' as const } : {}),
      }).format(v);
  }
  if (formato === 'porcentaje') {
    return (v: number) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)}%`;
  }
  return (v: number) =>
    new Intl.NumberFormat('es-CO', {
      maximumFractionDigits: 1,
      ...(compacto ? { notation: 'compact' as const } : {}),
    }).format(v);
}

export default function GraficoBI({ spec }: { spec: GraficoSpec }) {
  // Guardas: el spec viene del modelo; renderizar defensivamente.
  const etiquetas = Array.isArray(spec.etiquetas) ? spec.etiquetas : [];
  const series = (Array.isArray(spec.series) ? spec.series : [])
    .filter((s) => s && Array.isArray(s.datos))
    .slice(0, 4);
  if (etiquetas.length === 0 || series.length === 0) return null;

  const fmt = formateador(spec.formato);
  const fmtEje = formateador(spec.formato, true);

  const filas = etiquetas.map((etiqueta, i) => {
    const fila: Record<string, string | number> = { etiqueta };
    for (const s of series) fila[s.nombre] = s.datos[i] ?? 0;
    return fila;
  });

  const conLeyenda = series.length >= 2 && spec.tipo !== 'pastel';
  const horizontal = spec.tipo === 'barras_horizontales';
  const alto = horizontal ? Math.max(200, 34 * etiquetas.length + 40) : 260;

  const ejes = horizontal ? (
    <>
      <XAxis type="number" tickFormatter={fmtEje} tick={estiloTick} axisLine={false} tickLine={false} />
      <YAxis type="category" dataKey="etiqueta" width={130} tick={estiloTick} axisLine={false} tickLine={false} />
    </>
  ) : (
    <>
      <XAxis dataKey="etiqueta" tick={estiloTick} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" />
      <YAxis tickFormatter={fmtEje} tick={estiloTick} axisLine={false} tickLine={false} width={56} />
    </>
  );

  const tooltip = (
    <Tooltip
      formatter={(v: unknown, nombre: unknown) => [fmt(Number(v ?? 0)), String(nombre)]}
      contentStyle={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        fontSize: '0.8rem',
        color: 'var(--text-primary)',
      }}
      cursor={{ fill: 'rgba(128,128,128,0.08)' }}
    />
  );
  const leyenda = conLeyenda ? <Legend wrapperStyle={{ fontSize: '0.78rem' }} iconType="circle" iconSize={8} /> : null;
  const grid = <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={horizontal} horizontal={!horizontal} />;

  let cuerpo: React.ReactElement;

  if (spec.tipo === 'pastel') {
    const serie = series[0];
    const datosPastel = etiquetas.map((nombre, i) => ({ nombre, valor: serie.datos[i] ?? 0 }));
    const total = datosPastel.reduce((a, d) => a + d.valor, 0) || 1;
    cuerpo = (
      <PieChart>
        <Pie
          data={datosPastel}
          dataKey="valor"
          nameKey="nombre"
          innerRadius="55%"
          outerRadius="85%"
          stroke="var(--bg-surface)"
          strokeWidth={2}
          paddingAngle={1}
        >
          {datosPastel.map((_, i) => (
            <Cell key={i} fill={PALETA[i % PALETA.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: unknown, nombre: unknown) => [
            `${fmt(Number(v ?? 0))} (${Math.round((Number(v ?? 0) / total) * 100)}%)`,
            String(nombre),
          ]}
          contentStyle={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            fontSize: '0.8rem',
            color: 'var(--text-primary)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '0.78rem' }} iconType="circle" iconSize={8} />
      </PieChart>
    );
  } else if (spec.tipo === 'lineas') {
    cuerpo = (
      <LineChart data={filas} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        {grid}
        {ejes}
        {tooltip}
        {leyenda}
        {series.map((s, i) => (
          <Line
            key={s.nombre}
            type="monotone"
            dataKey={s.nombre}
            stroke={PALETA[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
          />
        ))}
      </LineChart>
    );
  } else if (spec.tipo === 'area') {
    cuerpo = (
      <AreaChart data={filas} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        {grid}
        {ejes}
        {tooltip}
        {leyenda}
        {series.map((s, i) => (
          <Area
            key={s.nombre}
            type="monotone"
            dataKey={s.nombre}
            stroke={PALETA[i]}
            strokeWidth={2}
            fill={PALETA[i]}
            fillOpacity={0.14}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
          />
        ))}
      </AreaChart>
    );
  } else {
    cuerpo = (
      <BarChart
        data={filas}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        barCategoryGap="25%"
      >
        {grid}
        {ejes}
        {tooltip}
        {leyenda}
        {series.map((s, i) => (
          <Bar
            key={s.nombre}
            dataKey={s.nombre}
            fill={PALETA[i]}
            maxBarSize={horizontal ? 22 : 36}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <div style={{ width: 'min(600px, 100%)', margin: '0.35rem 0' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
        {spec.titulo}
      </div>
      <ResponsiveContainer width="100%" height={alto}>
        {cuerpo}
      </ResponsiveContainer>
      {spec.nota ? (
        <div style={{ fontSize: '0.72rem', color: INK_MUTED, marginTop: '0.25rem' }}>{spec.nota}</div>
      ) : null}
    </div>
  );
}

const estiloTick = { fill: 'var(--text-secondary)', fontSize: 11 } as const;
