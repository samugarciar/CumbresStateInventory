'use client';

import React, { useState, useMemo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X, Loader2, Phone } from 'lucide-react';
import ModalFranja from './ModalFranja';
import { eliminarFranjaHoraria } from '@/app/actions/agenda';

// --- Tipos ---
interface Franja {
  id: string;
  inmueble_id: string;
  asesor_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  color: string;
  inmuebles: { id: string; titulo: string; direccion: string; unidad?: string | null } | null;
  usuarios: { id: string; nombre_completo: string } | null;
}

interface Cita {
  id: string;
  franja_id: string;
  inmueble_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cliente_nombre: string;
  cliente_telefono: string;
  origen: string;
  alcance?: string;
  unidad?: string | null;
  aptos_snapshot?: { titulo: string }[] | null;
  inmuebles: { titulo: string; direccion?: string; unidad?: string | null } | null;
}

interface Asesor { id: string; nombre_completo: string; }
interface Inmueble { id: string; titulo: string; direccion: string; unidad?: string | null; }

interface FranjaEditable {
  id: string;
  inmueble_id: string;
  asesor_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  color: string;
}

interface AgendaViewProps {
  franjas: Franja[];
  citas: Cita[];
  asesores: Asesor[];
  inmuebles: Inmueble[];
  isAdmin: boolean;
  userId: string;
  inmobiliariaId: string;
  fechaInicioSemana: string;
}

// --- Constantes ---
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const HORA_INICIO = 8;
const HORA_FIN = 18;
const ALTO_SLOT = 36; // px por cada media hora
const ALTO_LINEA = 17; // px que ocupa una línea de cita dentro del bloque

// Genera las franjas horarias de 30 min
function generarSlots(): string[] {
  const slots: string[] = [];
  for (let h = HORA_INICIO; h < HORA_FIN; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}
const SLOTS = generarSlots();

// --- Fechas: todo como texto 'YYYY-MM-DD' y aritmética en UTC, sin depender
// de la zona horaria del navegador. «Hoy» es el de Colombia. ---
function hoyColombia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}
// Lunes de la semana de trabajo de una fecha. El domingo no se trabaja: su
// semana útil es la que empieza al día siguiente.
function lunesDeTrabajo(fecha: string): string {
  const dow = diaDeLaSemana(fecha);
  return dow === 0 ? sumarDias(fecha, 1) : sumarDias(fecha, 1 - dow);
}
function diaDelMes(fecha: string): number { return Number(fecha.slice(8, 10)); }
function mesDe(fecha: string): number { return Number(fecha.slice(5, 7)) - 1; }

// «Hoy» solo existe en el navegador: en el servidor (y al hidratar) es null.
const suscribirNada = () => () => {};

function minutos(hora: string): number {
  const [h, m] = hora.substring(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// Etiqueta de ubicación para mostrar: la unidad si existe; si no, la dirección
function etiquetaUbicacion(inm?: { unidad?: string | null; direccion?: string | null } | null): string {
  if (!inm) return 'Sin ubicación';
  const u = (inm.unidad || '').trim();
  return u || inm.direccion || 'Sin ubicación';
}

// +573000000106 → «+57 300 000 0106» y el número para tel:. Si no parece un
// celular colombiano (p. ej. «kommo-123»), se muestra tal cual y sin enlace.
function telefonoLegible(tel: string): { texto: string; href: string | null } {
  const dig = (tel || '').replace(/\D/g, '');
  const nacional = dig.length === 12 && dig.startsWith('57') ? dig.slice(2) : dig.length === 10 ? dig : null;
  if (!nacional || /[a-z]/i.test(tel)) return { texto: tel, href: null };
  return {
    texto: `+57 ${nacional.slice(0, 3)} ${nacional.slice(3, 6)} ${nacional.slice(6)}`,
    href: `tel:+57${nacional}`,
  };
}

// Reparte en carriles las franjas que se cruzan en el mismo día, para que
// ninguna quede tapada por otra (antes, dos franjas a la misma hora —de dos
// asesores— mostraban solo una).
interface Colocada { franja: Franja; carril: number; carriles: number; }
function colocarFranjas(lista: Franja[]): Colocada[] {
  const orden = [...lista].sort((a, b) =>
    a.hora_inicio.localeCompare(b.hora_inicio) || a.hora_fin.localeCompare(b.hora_fin));
  const resultado: Colocada[] = [];
  let grupo: Colocada[] = [];
  let finesCarril: number[] = [];
  let finGrupo = 0;
  const cerrarGrupo = () => {
    for (const g of grupo) g.carriles = finesCarril.length;
    resultado.push(...grupo);
    grupo = [];
    finesCarril = [];
  };
  for (const f of orden) {
    const ini = minutos(f.hora_inicio);
    const fin = minutos(f.hora_fin);
    if (grupo.length > 0 && ini >= finGrupo) cerrarGrupo();
    if (grupo.length === 0) finGrupo = fin;
    let carril = finesCarril.findIndex(x => x <= ini);
    if (carril === -1) { carril = finesCarril.length; finesCarril.push(fin); }
    else finesCarril[carril] = fin;
    grupo.push({ franja: f, carril, carriles: 0 });
    if (fin > finGrupo) finGrupo = fin;
  }
  if (grupo.length > 0) cerrarGrupo();
  return resultado;
}

export default function AgendaView({
  franjas: franjasIniciales, citas, asesores, inmuebles, isAdmin, fechaInicioSemana
}: AgendaViewProps) {
  const router = useRouter();
  const [filtroAsesor, setFiltroAsesor] = useState<string>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editData, setEditData] = useState<FranjaEditable | null>(null);
  const [defaultFecha, setDefaultFecha] = useState('');
  const [defaultHora, setDefaultHora] = useState('');
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  // Móvil: el día que eligió la persona, atado a la semana en que lo eligió.
  const [eleccionMovil, setEleccionMovil] = useState<{ semana: string; dia: number } | null>(null);

  const hoy = useSyncExternalStore(suscribirNada, hoyColombia, () => null);

  // La semana mostrada la dicta el servidor (prop), que la lee de la URL (?semana=)
  const dias = useMemo(
    () => Array.from({ length: 6 }, (_, i) => sumarDias(fechaInicioSemana, i)),
    [fechaInicioSemana]
  );

  // El domingo, si nadie pidió una semana concreta, se muestra la que empieza
  // mañana (la que ya terminó no le sirve a nadie).
  useEffect(() => {
    const h = hoyColombia();
    if (diaDeLaSemana(h) !== 0) return;
    if (new URLSearchParams(window.location.search).has('semana')) return;
    const siguiente = lunesDeTrabajo(h);
    if (siguiente !== fechaInicioSemana) router.replace(`/agenda?semana=${siguiente}`);
  }, [fechaInicioSemana, router]);

  // Citas agendadas agrupadas por franja
  const citasPorFranja = useMemo(() => {
    const map: Record<string, Cita[]> = {};
    for (const c of citas) {
      if (!map[c.franja_id]) map[c.franja_id] = [];
      map[c.franja_id].push(c);
    }
    for (const lista of Object.values(map)) lista.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    return map;
  }, [citas]);

  // Filtrar franjas según asesor seleccionado
  const franjasFiltradas = useMemo(() => {
    if (filtroAsesor === 'todos') return franjasIniciales;
    return franjasIniciales.filter(f => f.asesor_id === filtroAsesor);
  }, [franjasIniciales, filtroAsesor]);

  // Franjas de cada día, ya repartidas en carriles
  const colocadasPorDia = useMemo(() => {
    const map: Record<string, Colocada[]> = {};
    for (const fecha of dias) {
      map[fecha] = colocarFranjas(franjasFiltradas.filter(f => f.fecha === fecha));
    }
    return map;
  }, [dias, franjasFiltradas]);

  // Móvil: hoy si cae en esta semana; si no, el primer día que tiene franjas.
  const diaPorDefecto = useMemo(() => {
    if (hoy) {
      const idx = dias.indexOf(hoy);
      if (idx >= 0) return idx;
    }
    const primero = dias.findIndex(f => (colocadasPorDia[f] || []).length > 0);
    return primero >= 0 ? primero : 0;
  }, [hoy, dias, colocadasPorDia]);
  const diaMovil = eleccionMovil && eleccionMovil.semana === fechaInicioSemana ? eleccionMovil.dia : diaPorDefecto;

  const mostrarAsesor = isAdmin && filtroAsesor === 'todos';

  // Navegación semanal: cambia la URL (?semana=) para que el servidor traiga esa semana
  const navSemana = useCallback((dir: number) => {
    router.push(`/agenda?semana=${sumarDias(fechaInicioSemana, dir * 7)}`);
  }, [fechaInicioSemana, router]);

  const irHoy = useCallback(() => {
    router.push(`/agenda?semana=${lunesDeTrabajo(hoyColombia())}`);
  }, [router]);

  // Abrir modal para nueva franja
  const abrirNueva = (fecha: string, hora: string) => {
    setEditData(null);
    setDefaultFecha(fecha);
    setDefaultHora(hora);
    setModalOpen(true);
  };

  // Abrir modal para editar
  const abrirEdicion = (franja: Franja) => {
    if (!isAdmin) return;
    setEditData({
      id: franja.id,
      inmueble_id: franja.inmueble_id,
      asesor_id: franja.asesor_id,
      fecha: franja.fecha,
      hora_inicio: franja.hora_inicio,
      hora_fin: franja.hora_fin,
      color: franja.color,
    });
    setDefaultFecha('');
    setDefaultHora('');
    setModalOpen(true);
  };

  const cerrarModal = () => {
    setModalOpen(false);
    setEditData(null);
    router.refresh();
  };

  // Eliminar una franja directo desde el calendario (X roja), sin abrir el modal.
  // El server action rechaza si la franja tiene citas agendadas.
  const eliminarFranja = useCallback(async (e: React.MouseEvent, franja: Franja) => {
    e.stopPropagation(); // no disparar la edición de la franja
    const nombre = franja.inmuebles?.titulo || 'esta franja';
    const horario = `${franja.hora_inicio.substring(0, 5)}–${franja.hora_fin.substring(0, 5)}`;
    if (!confirm(`¿Eliminar la franja de "${nombre}" (${horario})?`)) return;
    setEliminandoId(franja.id);
    const result = await eliminarFranjaHoraria(franja.id);
    setEliminandoId(null);
    if (!result.success) {
      alert(result.error || 'No se pudo eliminar la franja.');
      return;
    }
    router.refresh();
  }, [router]);

  // Formato de semana para el header
  const textoSemana = `${diaDelMes(dias[0])} ${MESES_SHORT[mesDe(dias[0])]}. — ${diaDelMes(dias[5])} ${MESES_SHORT[mesDe(dias[5])]}. de ${dias[5].slice(0, 4)}`;

  // Contenido de un bloque de franja en escritorio: lugar, horario, (asesor) y
  // las citas «11:00 · Felipe Gómez», con «+N más» si no caben.
  const contenidoFranja = (franja: Franja) => {
    const ubicacion = etiquetaUbicacion(franja.inmuebles);
    const asesorNombre = franja.usuarios?.nombre_completo || '';
    const citasFranja = citasPorFranja[franja.id] || [];
    const alto = ((minutos(franja.hora_fin) - minutos(franja.hora_inicio)) / 30) * ALTO_SLOT - 4;
    const cabecera = 8 + 17 + 16 + (mostrarAsesor && asesorNombre ? 16 : 0);
    const capacidad = Math.max(0, Math.floor((alto - cabecera) / ALTO_LINEA));
    const visibles = citasFranja.length <= capacidad ? citasFranja : citasFranja.slice(0, Math.max(0, capacidad - 1));
    const resto = citasFranja.length - visibles.length;
    return (
      <>
        <span style={styles.franjaTitle}>{ubicacion}</span>
        <span style={styles.franjaHora}>
          {franja.hora_inicio.substring(0, 5)} – {franja.hora_fin.substring(0, 5)}
          {capacidad === 0 && citasFranja.length > 0 && ` · ${citasFranja.length} cita${citasFranja.length > 1 ? 's' : ''}`}
        </span>
        {mostrarAsesor && asesorNombre && (
          <span style={styles.franjaAsesor}>{asesorNombre.split(' ')[0]}</span>
        )}
        {capacidad > 0 && visibles.map(c => (
          <span key={c.id} style={styles.franjaCita}>
            <strong style={{ fontWeight: 700 }}>{c.hora_inicio.substring(0, 5)}</strong> · {c.cliente_nombre}
          </span>
        ))}
        {capacidad > 0 && resto > 0 && (
          <span style={styles.franjaMas}>+{resto} más</span>
        )}
      </>
    );
  };

  const tituloFranja = (franja: Franja) => {
    const citasFranja = citasPorFranja[franja.id] || [];
    return [
      etiquetaUbicacion(franja.inmuebles),
      `${franja.hora_inicio.substring(0, 5)} – ${franja.hora_fin.substring(0, 5)}`,
      franja.usuarios?.nombre_completo || '',
      ...citasFranja.map(c => `${c.hora_inicio.substring(0, 5)} · ${c.cliente_nombre}`),
    ].filter(Boolean).join('\n');
  };

  return (
    <div style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="responsive-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={styles.pageTitle}>
            <CalendarDays size={28} color="var(--primary)" />
            Agenda
          </h1>
          <p style={styles.pageSubtitle}>
            {isAdmin
              ? 'Programa las franjas de visita de tus asesores'
              : 'Tu agenda de la semana (la programa la administración)'}
          </p>
        </div>
        {isAdmin && (
          <div className="responsive-header-buttons">
            <button
              className="btn btn-primary"
              onClick={() => abrirNueva(dias[0], '08:00')}
            >
              <Plus size={18} />
              Nueva franja
            </button>
          </div>
        )}
      </div>

      {/* Controles: Navegación de semana + Filtro asesor */}
      <div style={styles.controlsBar} className="glass-card agenda-controles">
        {/* Navegación semanal */}
        <div style={styles.navSemana}>
          <button onClick={() => navSemana(-1)} style={styles.navBtn} aria-label="Semana anterior" title="Semana anterior">
            <ChevronLeft size={18} />
          </button>
          <span style={styles.semanaTexto}>{textoSemana}</span>
          <button onClick={() => navSemana(1)} style={styles.navBtn} aria-label="Semana siguiente" title="Semana siguiente">
            <ChevronRight size={18} />
          </button>
          <button onClick={irHoy} className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
            Hoy
          </button>
        </div>

        {/* Filtro por asesor (solo admin) */}
        {isAdmin && asesores.length > 0 && (
          <div style={styles.filtroAsesor} role="group" aria-label="Filtrar por asesor">
            <button
              onClick={() => setFiltroAsesor('todos')}
              aria-pressed={filtroAsesor === 'todos'}
              style={{
                ...styles.filtroBtn,
                backgroundColor: filtroAsesor === 'todos' ? 'var(--primary)' : 'transparent',
                color: filtroAsesor === 'todos' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Todos
            </button>
            {asesores.map(a => (
              <button
                key={a.id}
                onClick={() => setFiltroAsesor(a.id)}
                aria-pressed={filtroAsesor === a.id}
                style={{
                  ...styles.filtroBtn,
                  backgroundColor: filtroAsesor === a.id ? 'var(--primary)' : 'transparent',
                  color: filtroAsesor === a.id ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {a.nombre_completo.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selector de día para móvil */}
      <div className="mobile-only" style={styles.diasMovil} role="group" aria-label="Día">
        {dias.map((d, i) => {
          const elegido = diaMovil === i;
          const esHoy = d === hoy;
          const tieneFranjas = (colocadasPorDia[d] || []).length > 0;
          return (
            <button
              key={d}
              onClick={() => setEleccionMovil({ semana: fechaInicioSemana, dia: i })}
              aria-pressed={elegido}
              aria-label={`${DIAS_LARGOS[i]} ${diaDelMes(d)}${tieneFranjas ? ', con franjas' : ''}`}
              style={{
                ...styles.diaMovilBtn,
                backgroundColor: elegido ? 'var(--primary)' : esHoy ? 'rgba(0,171,216,0.08)' : 'transparent',
                color: elegido ? '#fff' : esHoy ? 'var(--primary)' : 'var(--text-secondary)',
                fontWeight: elegido || esHoy ? 700 : 500,
              }}
            >
              <span style={{ fontSize: '0.75rem' }}>{DIAS_SEMANA[i]}</span>
              <span style={{ fontSize: '1rem' }}>{diaDelMes(d)}</span>
              <span
                aria-hidden="true"
                style={{
                  ...styles.diaMovilPunto,
                  backgroundColor: tieneFranjas ? (elegido ? '#fff' : 'var(--primary)') : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>

      {/* ========== CALENDARIO DESKTOP ========== */}
      <div className="desktop-only" style={styles.calendarWrapper}>
        <div style={styles.calendarGrid}>
          {/* Header de días */}
          <div style={styles.headerVacio} />
          {dias.map((d, i) => {
            const esHoy = d === hoy;
            return (
              <div
                key={d}
                style={{
                  ...styles.headerDia,
                  backgroundColor: esHoy ? 'rgba(0,171,216,0.06)' : 'transparent',
                  borderBottom: esHoy ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                }}
              >
                <span style={styles.headerDiaNombre}>{DIAS_SEMANA[i]}</span>
                <span style={{ ...styles.headerDiaNum, color: esHoy ? 'var(--primary)' : 'var(--text-primary)' }}>
                  {diaDelMes(d)}
                </span>
              </div>
            );
          })}

          {/* Columna de horas */}
          <div style={styles.columnaHoras}>
            {SLOTS.map(slot => (
              <div key={slot} style={styles.horaLabel}>
                {slot.endsWith(':00') ? slot : ''}
              </div>
            ))}
          </div>

          {/* Una columna por día: celdas de fondo + franjas encima */}
          {dias.map(fechaStr => (
            <div key={fechaStr} style={styles.columnaDia}>
              {SLOTS.map(slot => (
                <div
                  key={slot}
                  data-celda={`${fechaStr}_${slot}`}
                  className={isAdmin ? 'agenda-celda-admin' : undefined}
                  style={{
                    ...styles.celda,
                    borderBottom: slot.endsWith(':30') ? '1px solid var(--border-color)' : '1px solid rgba(226,232,240,0.45)',
                  }}
                  onClick={isAdmin ? () => abrirNueva(fechaStr, slot) : undefined}
                />
              ))}

              {(colocadasPorDia[fechaStr] || []).map(({ franja, carril, carriles }) => {
                const ini = Math.max(minutos(franja.hora_inicio), HORA_INICIO * 60);
                const fin = Math.min(minutos(franja.hora_fin), HORA_FIN * 60);
                const top = ((ini - HORA_INICIO * 60) / 30) * ALTO_SLOT;
                const alto = Math.max(((fin - ini) / 30) * ALTO_SLOT, ALTO_SLOT);
                const posicion: React.CSSProperties = {
                  ...styles.franjaBloque,
                  top: top + 1,
                  height: alto - 3,
                  left: `calc(${(carril / carriles) * 100}% + 2px)`,
                  width: `calc(${100 / carriles}% - 4px)`,
                  borderLeftColor: franja.color || 'var(--primary)',
                };
                const titulo = tituloFranja(franja);
                if (!isAdmin) {
                  return (
                    <div key={franja.id} style={posicion} title={titulo}>
                      <div style={styles.franjaContenido}>{contenidoFranja(franja)}</div>
                    </div>
                  );
                }
                return (
                  <div key={franja.id} style={posicion}>
                    <button
                      type="button"
                      className="agenda-franja-btn"
                      onClick={() => abrirEdicion(franja)}
                      title={titulo}
                      aria-label={`Editar franja: ${titulo.replace(/\n/g, ', ')}`}
                      style={{ ...styles.franjaBoton, ...styles.franjaContenido }}
                    >
                      {contenidoFranja(franja)}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => eliminarFranja(e, franja)}
                      disabled={eliminandoId === franja.id}
                      style={styles.franjaDeleteBtn}
                      aria-label="Eliminar franja"
                      title="Eliminar franja"
                    >
                      <span style={styles.franjaDeleteCirculo}>
                        {eliminandoId === franja.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <X size={12} />}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ========== CALENDARIO MÓVIL (vista de día) ========== */}
      <div className="mobile-only" style={{ marginTop: '0.75rem', flexDirection: 'column' }}>
        {(() => {
          const fechaStr = dias[diaMovil];
          const franjasDelDia = franjasFiltradas
            .filter(f => f.fecha === fechaStr)
            .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

          if (franjasDelDia.length === 0) {
            return (
              <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <CalendarDays size={40} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
                <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Sin franjas este día</p>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  {DIAS_LARGOS[diaMovil].replace(/^\w/, c => c.toUpperCase())} {diaDelMes(fechaStr)} de {MESES_LONG[mesDe(fechaStr)]}
                </p>
                {isAdmin && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '1rem' }}
                    onClick={() => abrirNueva(fechaStr, '08:00')}
                  >
                    <Plus size={16} /> Agregar franja
                  </button>
                )}
              </div>
            );
          }

          return franjasDelDia.map(f => {
            const citasFranja = citasPorFranja[f.id] || [];
            const cabecera = (
              <>
                <div style={styles.movilCardHeader}>
                  <span style={styles.movilCardHora}>
                    {f.hora_inicio.substring(0, 5)} – {f.hora_fin.substring(0, 5)}
                  </span>
                  {mostrarAsesor && f.usuarios && (
                    <span className="badge badge-info" style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}>
                      {f.usuarios.nombre_completo.split(' ')[0]}
                    </span>
                  )}
                </div>
                <div style={styles.movilCardTitle}>{etiquetaUbicacion(f.inmuebles)}</div>
                {f.inmuebles?.unidad?.trim() && f.inmuebles?.direccion && (
                  <div style={styles.movilCardDireccion}>{f.inmuebles.direccion}</div>
                )}
              </>
            );
            return (
              <div
                key={f.id}
                className="glass-card"
                style={{ ...styles.movilCard, borderLeft: `4px solid ${f.color || 'var(--primary)'}` }}
              >
                {isAdmin ? (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <button
                      type="button"
                      className="agenda-franja-btn"
                      onClick={() => abrirEdicion(f)}
                      style={{ ...styles.franjaBoton, flex: 1, minWidth: 0 }}
                      aria-label={`Editar franja de ${etiquetaUbicacion(f.inmuebles)}, ${f.hora_inicio.substring(0, 5)} a ${f.hora_fin.substring(0, 5)}`}
                    >
                      {cabecera}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => eliminarFranja(e, f)}
                      disabled={eliminandoId === f.id}
                      style={styles.movilDeleteBtn}
                      aria-label="Eliminar franja"
                      title="Eliminar franja"
                    >
                      {eliminandoId === f.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <X size={14} />}
                    </button>
                  </div>
                ) : cabecera}
                {citasFranja.length === 0 ? (
                  <div style={styles.movilSinCitas}>Sin visitas agendadas</div>
                ) : citasFranja.map(c => {
                  const tel = telefonoLegible(c.cliente_telefono);
                  return (
                    <div key={c.id} style={styles.movilCita}>
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{c.hora_inicio.substring(0, 5)}</strong> · {c.cliente_nombre}
                      </span>
                      {tel.href ? (
                        <a href={tel.href} style={styles.movilTel}>
                          <Phone size={12} /> {tel.texto}
                        </a>
                      ) : (
                        <span style={{ ...styles.movilTel, textDecoration: 'none' }}>{tel.texto}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>

      {/* Modal: se monta solo abierto y con una key por franja (o por celda).
          ModalFranja guarda los valores en useState, que solo lee sus props al
          montarse: si quedaba montado, al abrir otra franja seguía mostrando —y
          guardando— los datos de la primera. */}
      {modalOpen && (
        <ModalFranja
          key={editData ? editData.id : `${defaultFecha}-${defaultHora}`}
          isOpen
          onClose={cerrarModal}
          asesores={asesores}
          inmuebles={inmuebles}
          citasFranja={editData ? citasPorFranja[editData.id] || [] : []}
          editData={editData}
          defaultFecha={defaultFecha}
          defaultHora={defaultHora}
          defaultAsesorId={filtroAsesor !== 'todos' ? filtroAsesor : undefined}
        />
      )}
    </div>
  );
}

// --- Estilos ---
const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: '1.65rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  pageSubtitle: {
    fontSize: '0.88rem',
    color: 'var(--text-muted)',
    marginTop: '0.25rem',
  },
  controlsBar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
  },
  navSemana: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  navBtn: {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    transition: 'all 0.15s',
    flexShrink: 0,
  },
  semanaTexto: {
    fontSize: '0.92rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  filtroAsesor: {
    display: 'flex',
    gap: '0.25rem',
    flexWrap: 'wrap' as const,
  },
  filtroBtn: {
    padding: '0.35rem 0.75rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    borderRadius: '20px',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  },
  diasMovil: {
    display: 'flex',
    gap: '0.25rem',
    padding: '0.25rem 0',
    justifyContent: 'space-between',
  },
  diaMovilBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.1rem',
    padding: '0.45rem 0.25rem 0.35rem',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
    flex: 1,
    minWidth: 0,
  },
  diaMovilPunto: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    marginTop: '2px',
  },

  // ---- Calendario Desktop ----
  calendarWrapper: {
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
    borderRadius: 'var(--border-radius-md)',
    border: '1px solid var(--border-color)',
    backgroundColor: '#fff',
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: '56px repeat(6, minmax(0, 1fr))',
    minWidth: '760px',
  },
  headerVacio: {
    padding: '0.5rem',
    borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-secondary)',
  },
  headerDia: {
    padding: '0.6rem 0.35rem',
    textAlign: 'center' as const,
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.15rem',
  },
  headerDiaNombre: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  headerDiaNum: {
    fontSize: '1.1rem',
    fontWeight: 700,
  },
  columnaHoras: {
    borderRight: '1px solid var(--border-color)',
  },
  horaLabel: {
    padding: '0.15rem 0.4rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textAlign: 'right' as const,
    height: `${ALTO_SLOT}px`,
  },
  columnaDia: {
    position: 'relative' as const,
    borderRight: '1px solid var(--border-color)',
    minWidth: 0,
  },
  celda: {
    height: `${ALTO_SLOT}px`,
    transition: 'background-color 0.1s',
  },
  franjaBloque: {
    position: 'absolute' as const,
    borderLeft: '3px solid var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    borderRadius: '6px',
    overflow: 'hidden' as const,
  },
  franjaContenido: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1px',
    padding: '0.25rem 0.4rem',
    paddingRight: '1.6rem',
    height: '100%',
    minWidth: 0,
    overflow: 'hidden' as const,
  },
  // Botón sin aspecto de botón: ocupa todo el bloque y conserva el texto.
  franjaBoton: {
    width: '100%',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    padding: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  // Área de toque de 28 px; el círculo visible es más pequeño.
  franjaDeleteBtn: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    width: '28px',
    height: '28px',
    border: 'none',
    background: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    zIndex: 1,
  },
  franjaDeleteCirculo: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    color: 'var(--danger)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  movilDeleteBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    color: 'var(--danger)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  franjaTitle: {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    lineHeight: '16px',
  },
  franjaHora: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    lineHeight: '15px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  franjaAsesor: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    lineHeight: '15px',
  },
  franjaCita: {
    fontSize: '0.75rem',
    color: 'var(--text-primary)',
    lineHeight: '16px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  franjaMas: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--primary)',
    lineHeight: '16px',
  },

  // ---- Calendario Móvil ----
  movilCard: {
    padding: '0.85rem 1rem',
    marginBottom: '0.5rem',
    borderRadius: 'var(--border-radius-md)',
  },
  movilCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.3rem',
  },
  movilCardHora: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--primary)',
  },
  movilCardTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  movilCardDireccion: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    marginTop: '0.15rem',
  },
  movilSinCitas: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    marginTop: '0.4rem',
  },
  movilCita: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.25rem 0.75rem',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(0, 171, 216, 0.07)',
    borderRadius: '8px',
    padding: '0.4rem 0.6rem',
    marginTop: '0.4rem',
  },
  movilTel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--primary)',
    whiteSpace: 'nowrap' as const,
  },
};
