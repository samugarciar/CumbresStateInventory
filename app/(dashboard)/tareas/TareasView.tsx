'use client';

import React, { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { completarTareasMultiples } from '@/app/actions/tareas';
import { createClient } from '@/lib/supabase/client';
import BiometricSignatureWizard from '@/app/components/biometrics/BiometricSignatureWizard';
import {
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Loader2,
  Check,
  PenTool,
  Lock,
  ArrowRight,
  User as UserIcon,
  Clock,
} from 'lucide-react';

interface Task {
  id: string;
  inmobiliaria_id: string;
  usuario_id: string | null;
  entidad_tipo: 'captacion' | 'inventario' | 'inmueble' | 'general';
  entidad_id: string | null;
  evento_origen: string | null;
  evento_titulo: string;
  titulo: string;
  estado: 'pendiente' | 'completada';
  created_at: string;
  completada_at: string | null;
  completada_por: string | null;
}

interface TareasViewProps {
  initialTasks: Task[];
  // Nombre de cada usuario de la inmobiliaria, para decir de quién es la tarea
  asesores?: Record<string, string>;
  // Código (arrendasoft_id) de los inmuebles de las tareas, para el enlace «Ir»
  codigosInmuebles?: Record<string, string>;
  // Hora del servidor (ms): el «hace 2 h» del primer render coincide con el del navegador
  ahora: number;
}

// Tareas que la app completa sola (o con la firma): no se marcan a mano.
const AUTOMATICAS = new Set([
  'Firmar inventario',
  'Asociar contrato al inventario',
  'Asociar contrato',
  'Aceptar asociacion inventario',
]);

function haceCuanto(iso: string, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' });
}

// A dónde lleva «Ir», según de dónde salió la tarea.
function enlaceIr(t: Task, codigos: Record<string, string>): string | null {
  const origen = t.evento_origen || '';
  if (origen === 'solicitud_apertura' || origen.startsWith('cita')) return '/citas';
  if (origen.startsWith('inmueble_') || origen.startsWith('empalme') || t.entidad_tipo === 'inmueble') {
    const codigo = t.entidad_id ? codigos[t.entidad_id] : undefined;
    return codigo ? `/inmuebles?q=${encodeURIComponent(codigo)}` : '/inmuebles';
  }
  if (origen.startsWith('inventario') || origen === 'asociacion_contrato' || t.entidad_tipo === 'inventario') return '/inventarios';
  if (origen === 'captacion_creada') return '/inmuebles?action=logs';
  if (origen === 'sync_diario_inmuebles') return '/inmuebles/sync';
  return null;
}

export default function TareasView({ initialTasks, asesores = {}, codigosInmuebles = {}, ahora: ahoraInicial }: TareasViewProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<'todos' | 'pendiente' | 'completada'>('pendiente');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [isBulkCompleting, setIsBulkCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ahora, setAhora] = useState(ahoraInicial);
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Estados del Wizard de Firma Biométrica In-App
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [loadingInvId, setLoadingInvId] = useState<string | null>(null);
  const [selectedSigningData, setSelectedSigningData] = useState<{
    inventarioId: string;
    asesorName: string;
    inquilinoName: string;
    inquilinoCC: string;
  } | null>(null);

  const startBiometricSigning = async (inventarioId: string) => {
    setLoadingInvId(inventarioId);
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from('inventarios')
        .select('items, usuarios(nombre_completo)')
        .eq('id', inventarioId)
        .single();

      if (error) {
        console.error('Error al recuperar detalles del inventario:', error.message);
        alert('No se pudo recuperar la información del inventario.');
      } else if (data) {
        const itemsObj = (data.items as { datos_generales?: { inquilino?: { nombre?: string } }; firmas?: { arrendatario?: { cc?: string } } } | null) || {};
        const inquilinoName = itemsObj.datos_generales?.inquilino?.nombre || '';
        const inquilinoCC = itemsObj.firmas?.arrendatario?.cc || '';
        const usuario = data.usuarios as { nombre_completo?: string } | { nombre_completo?: string }[] | null;
        const asesorName = (Array.isArray(usuario) ? usuario[0] : usuario)?.nombre_completo || '';

        setSelectedSigningData({
          inventarioId,
          asesorName,
          inquilinoName,
          inquilinoCC
        });
        setIsWizardOpen(true);
      }
    } catch (err) {
      console.error('Excepción al buscar inventario:', err);
    } finally {
      setLoadingInvId(null);
    }
  };

  const handleBulkComplete = () => {
    if (selectedTasks.size === 0) return;
    setIsBulkCompleting(true);
    setErrorMessage(null);

    const taskIds = Array.from(selectedTasks);

    // Optimistic Update
    const previousTasks = [...tasks];
    setTasks(prev =>
      prev.map(t => taskIds.includes(t.id) ? { ...t, estado: 'completada' } : t)
    );
    setSelectedTasks(new Set()); // Clear selection

    startTransition(async () => {
      const res = await completarTareasMultiples(taskIds);
      if (!res.success) {
        setTasks(previousTasks); // Rollback
        setErrorMessage(res.error || 'No se pudieron completar las tareas. Intenta de nuevo.');
      }
      setIsBulkCompleting(false);
    });
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true)
    }));
  };

  // Agrupar tareas por la entidad de la que salieron
  const grouped = (() => {
    const groups: Record<string, { entidadId: string; eventoTitulo: string; tasks: Task[] }> = {};
    tasks.forEach(task => {
      if (filter !== 'todos' && task.estado !== filter) return;
      // Sin entidad, se agrupan por origen: así no se mezclan, p. ej., la sincronización
      // diaria con una captación (y «Ir» lleva al mismo sitio para todo el grupo).
      const entidadId = task.entidad_id || `sin-entidad:${task.evento_origen ?? ''}`;
      if (!groups[entidadId]) {
        groups[entidadId] = { entidadId, eventoTitulo: task.evento_titulo, tasks: [] };
      }
      groups[entidadId].tasks.push(task);
    });
    return Object.values(groups);
  })();

  // Seleccionar / deseleccionar una tarea (las automáticas no se marcan a mano)
  const handleToggleTaskSelection = (task: Task) => {
    if (task.estado === 'completada' || AUTOMATICAS.has(task.titulo)) return;
    setSelectedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(task.id)) newSet.delete(task.id);
      else newSet.add(task.id);
      return newSet;
    });
  };

  const filtros: { valor: typeof filter; texto: string }[] = [
    { valor: 'pendiente', texto: 'Pendientes' },
    { valor: 'completada', texto: 'Completadas' },
    { valor: 'todos', texto: 'Todas' },
  ];

  return (
    <div style={styles.container} className="animate-fade-in">
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Tareas</h1>
          <p style={styles.subtitle}>Lo que hay que revisar hoy</p>
        </div>
      </header>

      {/* Alerta de Error */}
      {errorMessage && (
        <div style={styles.errorAlert} className="glass-card" role="alert">
          <AlertCircle size={18} color="var(--danger)" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Filtro por estado */}
      <div style={styles.filterButtons} role="group" aria-label="Mostrar tareas">
        {filtros.map(f => (
          <button
            key={f.valor}
            onClick={() => setFilter(f.valor)}
            aria-pressed={filter === f.valor}
            style={{
              ...styles.filterBtn,
              ...(filter === f.valor ? styles.filterBtnActive : {})
            }}
          >
            {f.texto}
          </button>
        ))}
      </div>

      {/* Grupos */}
      <div style={styles.groupsContainer}>
        {grouped.length === 0 ? (
          <div style={styles.emptyState} className="glass-card animate-fade-in">
            <CheckCircle2 size={44} color="var(--primary)" style={{ opacity: 0.8 }} />
            <h3 style={{ marginTop: '1rem', fontWeight: 600 }}>
              {filter === 'pendiente' ? 'Todo al día' : 'No hay tareas aquí'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {filter === 'pendiente'
                ? 'No queda nada pendiente por revisar.'
                : filter === 'completada' ? 'Todavía no se ha completado ninguna tarea.' : 'No hay tareas.'}
            </p>
          </div>
        ) : (
          grouped.map(group => {
            const isExpanded = expandedGroups[group.entidadId] ?? true; // Expandidos por defecto
            const pendingTasks = group.tasks.filter(t => t.estado === 'pendiente').length;
            const totalTasks = group.tasks.length;
            const completedTasks = totalTasks - pendingTasks;
            const isFullyCompleted = pendingTasks === 0;
            const masReciente = group.tasks.reduce((max, t) => (t.created_at > max ? t.created_at : max), group.tasks[0].created_at);
            const duenos = Array.from(new Set(group.tasks.map(t => t.usuario_id).filter(Boolean))) as string[];
            const asesor = duenos.length === 1 ? asesores[duenos[0]] : undefined;
            const ir = enlaceIr(group.tasks[0], codigosInmuebles);
            const idCuerpo = `tareas-grupo-${group.entidadId}`;

            return (
              <div
                key={group.entidadId}
                className="glass-card animate-fade-in"
                style={{
                  ...styles.groupCard,
                  borderColor: isFullyCompleted ? 'rgba(34, 197, 94, 0.15)' : 'var(--border-color)'
                }}
              >
                {/* Cabecera: el título despliega/pliega; «Ir» lleva a donde se resuelve */}
                <div style={styles.groupHeader}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.entidadId)}
                    aria-expanded={isExpanded}
                    aria-controls={idCuerpo}
                    className="tareas-grupo-btn"
                    style={styles.groupToggle}
                  >
                    <span style={styles.groupTitleCol}>
                      <span style={styles.groupTitle}>{group.eventoTitulo}</span>
                      <span style={styles.groupMetaList}>
                        <span style={styles.groupMetaItem}>
                          <Clock size={12} />
                          {haceCuanto(masReciente, ahora)}
                        </span>
                        {asesor && (
                          <span style={styles.groupMetaItem}>
                            <UserIcon size={12} />
                            {asesor}
                          </span>
                        )}
                        <span style={{ ...styles.groupMetaItem, color: isFullyCompleted ? 'var(--success)' : 'var(--text-secondary)' }}>
                          {completedTasks}/{totalTasks} hechas
                        </span>
                      </span>
                    </span>
                    {isExpanded ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
                  </button>
                  {ir && (
                    <Link href={ir} className="btn btn-secondary" style={styles.irBtn}>
                      Ir <ArrowRight size={14} />
                    </Link>
                  )}
                </div>

                {/* Cuerpo */}
                {isExpanded && (
                  <div style={styles.groupBody} id={idCuerpo}>
                    <div style={styles.taskList}>
                      {group.tasks.map(task => {
                        const isTaskCompleted = task.estado === 'completada';
                        const automatica = AUTOMATICAS.has(task.titulo) && !isTaskCompleted;
                        const seleccionada = selectedTasks.has(task.id);

                        const texto = (
                          <span style={{
                            ...styles.taskText,
                            textDecoration: isTaskCompleted ? 'line-through' : 'none',
                            color: isTaskCompleted ? 'var(--text-muted)' : 'var(--text-primary)',
                            fontWeight: isTaskCompleted ? 500 : 600
                          }}>
                            {task.titulo}
                            {task.titulo === 'Firmar inventario' && !isTaskCompleted && (
                              <span style={styles.signatureBadge}>Firma en persona</span>
                            )}
                            {automatica && task.titulo !== 'Firmar inventario' && (
                              <span style={{ ...styles.signatureBadge, ...styles.automaticaBadge }}>Se completa sola</span>
                            )}
                          </span>
                        );

                        return (
                          <div
                            key={task.id}
                            style={{
                              ...styles.taskItem,
                              backgroundColor: isTaskCompleted ? 'rgba(248, 250, 252, 0.6)' : seleccionada ? 'rgba(0, 171, 216, 0.05)' : '#ffffff',
                              borderColor: seleccionada ? 'var(--primary)' : isTaskCompleted ? 'rgba(226, 232, 240, 0.5)' : 'var(--border-color)',
                            }}
                          >
                            {automatica ? (
                              <div style={styles.taskLabel}>
                                <span style={{ color: task.titulo === 'Firmar inventario' ? '#7c3aed' : 'var(--text-muted)', display: 'flex' }} aria-hidden="true">
                                  {task.titulo === 'Firmar inventario' ? <PenTool size={20} /> : <Lock size={20} />}
                                </span>
                                {texto}
                              </div>
                            ) : isTaskCompleted ? (
                              <div style={styles.taskLabel}>
                                <CheckSquare size={20} color="var(--primary)" aria-hidden="true" />
                                {texto}
                              </div>
                            ) : (
                              // Botón con rol de casilla: se usa con el ratón, el dedo o el teclado
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={seleccionada}
                                onClick={() => handleToggleTaskSelection(task)}
                                className="tareas-item-btn"
                                style={{ ...styles.taskLabel, ...styles.taskLabelBtn }}
                              >
                                {seleccionada
                                  ? <CheckSquare size={20} color="var(--primary)" aria-hidden="true" />
                                  : <Square size={20} color="var(--text-muted)" aria-hidden="true" />}
                                {texto}
                              </button>
                            )}

                            {/* Botón para iniciar firma Biométrica In-App */}
                            {task.titulo === 'Firmar inventario' && !isTaskCompleted && task.entidad_id && (
                              <button
                                onClick={() => startBiometricSigning(task.entidad_id!)}
                                disabled={loadingInvId === task.entidad_id}
                                className="btn btn-primary"
                                style={styles.firmaBtn}
                              >
                                {loadingInvId === task.entidad_id ? (
                                  <>
                                    <Loader2 size={13} className="animate-spin" />
                                    Cargando...
                                  </>
                                ) : (
                                  <>
                                    <PenTool size={13} />
                                    Firmar en persona
                                  </>
                                )}
                              </button>
                            )}

                            {isTaskCompleted && task.completada_at && (
                              <span style={styles.completadaMeta}>
                                <Calendar size={12} style={{ marginRight: '0.25rem' }} />
                                Completada el {new Date(task.completada_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Barra de acción: solo aparece cuando hay algo seleccionado */}
      {selectedTasks.size > 0 && (
        <>
          <div style={{ height: '76px' }} />
          <div style={styles.barraSeleccion} role="region" aria-label="Tareas seleccionadas">
            <span style={styles.barraTexto}>
              {selectedTasks.size} seleccionada{selectedTasks.size !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                style={styles.barraBtn}
                onClick={() => setSelectedTasks(new Set())}
                disabled={isBulkCompleting}
              >
                Quitar selección
              </button>
              <button
                className="btn btn-primary"
                style={styles.barraBtn}
                onClick={handleBulkComplete}
                disabled={isBulkCompleting}
              >
                {isBulkCompleting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Completar seleccionadas
              </button>
            </div>
          </div>
        </>
      )}

      {/* Wizard de Firma Biométrica */}
      {isWizardOpen && selectedSigningData && (
        <BiometricSignatureWizard
          inventarioId={selectedSigningData.inventarioId}
          asesorDefaultName={selectedSigningData.asesorName}
          asesorDefaultId=""
          inquilinoDefaultName={selectedSigningData.inquilinoName}
          inquilinoDefaultId={selectedSigningData.inquilinoCC}
          onClose={() => {
            setIsWizardOpen(false);
            setSelectedSigningData(null);
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
    marginBottom: '0.25rem',
  },
  subtitle: {
    fontSize: '1rem',
    color: 'var(--text-secondary)',
  },
  errorAlert: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem 1.25rem',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    color: 'var(--danger)',
    fontSize: '0.9rem',
    fontWeight: 600,
    borderRadius: '12px',
  },
  filterButtons: {
    display: 'flex',
    gap: '0.4rem',
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '0.45rem 1rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    borderRadius: '20px',
    border: '1px solid var(--border-color)',
    backgroundColor: '#ffffff',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  filterBtnActive: {
    backgroundColor: 'var(--primary)',
    borderColor: 'var(--primary)',
    color: '#ffffff',
  },
  groupsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3.5rem 2rem',
    textAlign: 'center',
    color: 'var(--text-secondary)',
  },
  groupCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: '1px',
    transition: 'all var(--transition-normal)',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.9rem 1.25rem',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderBottom: '1px solid var(--border-color)',
  },
  groupToggle: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: 'none',
    border: 'none',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
  },
  groupTitleCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    flex: 1,
    minWidth: 0,
  },
  groupTitle: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  groupMetaList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.35rem 0.9rem',
    alignItems: 'center',
  },
  groupMetaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
  irBtn: {
    padding: '0.4rem 0.8rem',
    fontSize: '0.82rem',
    gap: '0.3rem',
    flexShrink: 0,
  },
  groupBody: {
    padding: '1rem 1.25rem',
    backgroundColor: 'rgba(248, 250, 252, 0.3)',
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  },
  taskItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    transition: 'all var(--transition-fast)',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  taskLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    margin: 0,
    flex: 1,
    minWidth: 0,
  },
  taskLabelBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
  },
  taskText: {
    fontSize: '0.92rem',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  completadaMeta: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 500,
  },
  firmaBtn: {
    padding: '0.45rem 0.85rem',
    fontSize: '0.82rem',
    gap: '0.35rem',
  },
  barraSeleccion: {
    position: 'fixed',
    left: '50%',
    bottom: '1.25rem',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.75rem 1.5rem',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    boxShadow: '0 8px 28px rgba(15, 23, 42, 0.18)',
    padding: '0.65rem 1rem 0.65rem 1.25rem',
    zIndex: 200,
    width: 'min(560px, calc(100% - 2rem))',
  },
  barraTexto: {
    fontSize: '0.88rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  barraBtn: {
    padding: '0.5rem 0.9rem',
    fontSize: '0.85rem',
  },
  signatureBadge: {
    fontSize: '0.75rem',
    color: '#7c3aed',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    padding: '0.15rem 0.5rem',
    borderRadius: '6px',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  automaticaBadge: {
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    color: 'var(--primary)',
    borderColor: 'rgba(0, 171, 216, 0.2)',
  },
};
