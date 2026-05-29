'use client';

import React, { useState, useTransition } from 'react';
import { completarTarea, completarTareasMultiples } from '@/app/actions/tareas';
import { createClient } from '@/lib/supabase/client';
import BiometricSignatureWizard from '@/app/components/biometrics/BiometricSignatureWizard';
import { 
  CheckSquare, 
  Square, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle, 
  CheckCircle2, 
  ListTodo, 
  Calendar, 
  Tag,
  RefreshCw,
  Layers,
  FileText,
  Loader2,
  Check,
  PenTool,
  Lock
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
}

export default function TareasView({ initialTasks }: TareasViewProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<'todos' | 'pendiente' | 'completada'>('pendiente');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [isBulkCompleting, setIsBulkCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        const itemsObj = (data.items as any) || {};
        const inquilinoName = itemsObj.datos_generales?.inquilino?.nombre || '';
        const inquilinoCC = itemsObj.firmas?.arrendatario?.cc || '';
        const asesorName = (data.usuarios as any)?.nombre_completo || '';
        
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

  // 1. Alternar estado del acordeón para una entidad
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // 2. Agrupar tareas polimórficas por entidad_id
  const getGroupedTasks = () => {
    const groups: Record<string, {
      entidadId: string;
      entidadTipo: 'captacion' | 'inventario' | 'inmueble' | 'general';
      eventoTitulo: string;
      eventoOrigen: string | null;
      tasks: Task[];
    }> = {};

    tasks.forEach(task => {
      // Filtrar según el estado seleccionado
      if (filter !== 'todos' && task.estado !== filter) {
        return;
      }

      const entidadId = task.entidad_id || 'general';
      const entidadTipo = task.entidad_tipo;
      const eventoTitulo = task.evento_titulo;
      const eventoOrigen = task.evento_origen;

      if (!groups[entidadId]) {
        groups[entidadId] = {
          entidadId,
          entidadTipo,
          eventoTitulo,
          eventoOrigen,
          tasks: []
        };
      }

      groups[entidadId].tasks.push(task);
    });

    return Object.values(groups);
  };

  // 3. Manejar selección de la tarea (checkbox)
  const handleToggleTaskSelection = (taskId: string, currentStatus: 'pendiente' | 'completada') => {
    // Si ya está completada, no hacer nada
    if (currentStatus === 'completada') return;

    const task = tasks.find(t => t.id === taskId);
    if (task && (
      task.titulo === 'Firmar inventario' || 
      task.titulo === 'Asociar contrato al inventario' || 
      task.titulo === 'Asociar contrato' || 
      task.titulo === 'Aceptar asociacion inventario'
    )) {
      return; // Bloquear interacción manual para tareas automatizadas del sistema
    }

    setSelectedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };



  const grouped = getGroupedTasks();

  return (
    <div style={styles.container} className="animate-fade-in">
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Tareas Administrativas</h1>
          <p style={styles.subtitle}>
            Supervisa y completa las tareas operativas generadas dinámicamente a partir de eventos del sistema.
          </p>
        </div>
      </header>

      {/* Alerta de Error */}
      {errorMessage && (
        <div style={styles.errorAlert} className="glass-card">
          <AlertCircle size={18} color="var(--danger)" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Panel de Filtros */}
      <div className="glass-card" style={styles.filtersCard}>
        <div style={styles.filterTitleRow}>
          <ListTodo size={18} color="var(--primary)" />
          <span style={styles.filterTitle}>Filtrar Tareas por Estado</span>
        </div>
        <div style={styles.filterButtons}>
          <button
            onClick={() => setFilter('pendiente')}
            style={{
              ...styles.filterBtn,
              ...(filter === 'pendiente' ? styles.filterBtnActive : {})
            }}
          >
            Pendientes
          </button>
          <button
            onClick={() => setFilter('completada')}
            style={{
              ...styles.filterBtn,
              ...(filter === 'completada' ? styles.filterBtnActive : {})
            }}
          >
            Completadas
          </button>
          <button
            onClick={() => setFilter('todos')}
            style={{
              ...styles.filterBtn,
              ...(filter === 'todos' ? styles.filterBtnActive : {})
            }}
          >
            Todas
          </button>
        </div>
        
        {/* Botón de Acción Masiva */}
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn"
            onClick={handleBulkComplete}
            disabled={selectedTasks.size === 0 || isBulkCompleting}
            style={{
              padding: '0.6rem 1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: selectedTasks.size > 0 ? '#00abd8' : 'var(--bg-secondary)',
              color: selectedTasks.size > 0 ? '#fff' : 'var(--text-muted)',
              border: selectedTasks.size > 0 ? '1px solid #00abd8' : '1px solid var(--border-color)',
              fontWeight: 600,
              cursor: selectedTasks.size > 0 && !isBulkCompleting ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              borderRadius: '8px'
            }}
          >
            {isBulkCompleting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Completar Tareas ({selectedTasks.size})
          </button>
        </div>
      </div>

      {/* Listado de Grupos Acordeón */}
      <div style={styles.groupsContainer}>
        {grouped.length === 0 ? (
          <div style={styles.emptyState} className="glass-card animate-fade-in">
            <CheckCircle2 size={48} color="var(--primary)" style={{ opacity: 0.8 }} />
            <h3 style={{ marginTop: '1rem', fontWeight: 600 }}>¡Todo al día!</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              No se encontraron tareas en estado <strong>"{filter === 'pendiente' ? 'Pendientes' : filter === 'completada' ? 'Completadas' : 'Todas'}"</strong>.
            </p>
          </div>
        ) : (
          grouped.map(group => {
            const isExpanded = expandedGroups[group.entidadId] ?? true; // Expandidos por defecto
            const pendingTasks = group.tasks.filter(t => t.estado === 'pendiente').length;
            const totalTasks = group.tasks.length;
            const completedTasks = totalTasks - pendingTasks;
            const isFullyCompleted = pendingTasks === 0;

            return (
              <div 
                key={group.entidadId} 
                className="glass-card animate-fade-in" 
                style={{
                  ...styles.groupCard,
                  borderColor: isFullyCompleted ? 'rgba(34, 197, 94, 0.15)' : 'var(--border-color)'
                }}
              >
                {/* Cabecera del Acordeón (Interactivo) */}
                <div 
                  onClick={() => toggleGroup(group.entidadId)} 
                  style={styles.groupHeader}
                >
                  <div style={styles.groupTitleCol}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <h3 style={styles.groupTitle}>{group.eventoTitulo}</h3>
                      
                      {/* Badges polimórficos de origen */}
                      {group.entidadTipo === 'captacion' && (
                        <span className="badge" style={{ ...styles.entityTypeBadge, backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', color: 'var(--warning)' }}>
                          Captación
                        </span>
                      )}
                      {group.entidadTipo === 'inventario' && (
                        <span className="badge" style={{ ...styles.entityTypeBadge, backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)', color: 'var(--secondary)' }}>
                          Inventario
                        </span>
                      )}
                      {group.entidadTipo === 'inmueble' && (
                        <span className="badge" style={{ ...styles.entityTypeBadge, backgroundColor: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', color: 'var(--info)' }}>
                          Inmueble
                        </span>
                      )}
                      {group.entidadTipo === 'general' && (
                        <span className="badge" style={{ ...styles.entityTypeBadge, backgroundColor: 'rgba(100, 116, 139, 0.08)', border: '1px solid rgba(100, 116, 139, 0.2)', color: 'var(--text-muted)' }}>
                          General
                        </span>
                      )}
                    </div>

                    <div style={styles.groupMetaList}>
                      {group.eventoOrigen && (
                        <span style={styles.groupMetaItem}>
                          <Layers size={12} color="var(--primary)" />
                          Origen: <strong>{group.eventoOrigen}</strong>
                        </span>
                      )}
                      <span style={styles.groupMetaItem}>
                        <FileText size={12} color="var(--primary)" />
                        Tareas en este grupo: <strong>{totalTasks}</strong>
                      </span>
                    </div>
                  </div>

                  <div style={styles.groupActionsCol}>
                    {/* Badge de Progreso */}
                    <span 
                      className={`badge ${isFullyCompleted ? 'badge-success' : 'badge-info'}`}
                      style={{ 
                        fontSize: '0.78rem', 
                        fontWeight: '700', 
                        padding: '0.25rem 0.65rem',
                        backgroundColor: isFullyCompleted ? 'rgba(34, 197, 94, 0.08)' : 'rgba(0, 171, 216, 0.08)',
                        color: isFullyCompleted ? 'var(--success)' : 'var(--primary)',
                        border: isFullyCompleted ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(0, 171, 216, 0.2)'
                      }}
                    >
                      {completedTasks}/{totalTasks} completadas
                    </span>

                    {/* Flecha de Rotación */}
                    <button style={styles.collapseToggleBtn}>
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Cuerpo del Acordeón */}
                {isExpanded && (
                  <div style={styles.groupBody}>
                    <div style={styles.taskList}>
                      {group.tasks.map(task => {
                        const isTaskCompleted = task.estado === 'completada';
                        const isUpdating = updatingTaskId === task.id;

                        return (
                          <div 
                            key={task.id} 
                            style={{
                              ...styles.taskItem,
                              backgroundColor: isTaskCompleted ? 'rgba(248, 250, 252, 0.6)' : '#ffffff',
                              borderColor: isTaskCompleted ? 'rgba(226, 232, 240, 0.5)' : 'var(--border-color)',
                            }}
                          >
                            <div 
                              style={{
                                ...styles.taskLabel,
                                cursor: (task.titulo === 'Firmar inventario' || task.titulo === 'Asociar contrato al inventario' || task.titulo === 'Asociar contrato' || task.titulo === 'Aceptar asociacion inventario') && !isTaskCompleted ? 'default' : 'pointer'
                              }}
                              onClick={(task.titulo === 'Firmar inventario' || task.titulo === 'Asociar contrato al inventario' || task.titulo === 'Asociar contrato' || task.titulo === 'Aceptar asociacion inventario') && !isTaskCompleted ? undefined : () => handleToggleTaskSelection(task.id, task.estado)}
                            >
                              {(task.titulo === 'Firmar inventario' || task.titulo === 'Asociar contrato al inventario' || task.titulo === 'Asociar contrato' || task.titulo === 'Aceptar asociacion inventario') && !isTaskCompleted ? (
                                <div style={{ marginRight: '0.5rem', color: task.titulo === 'Firmar inventario' ? '#8b5cf6' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                                  {task.titulo === 'Firmar inventario' ? <PenTool size={20} /> : <Lock size={20} />}
                                </div>
                              ) : (
                                <div
                                  style={{
                                    ...styles.checkboxBtn,
                                    color: isTaskCompleted || selectedTasks.has(task.id) ? '#00abd8' : 'var(--text-muted)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    marginRight: '0.5rem',
                                    cursor: 'pointer'
                                  }}
                                >
                                  {isUpdating ? (
                                    <RefreshCw size={20} className="animate-spin" color="var(--primary)" />
                                  ) : isTaskCompleted || selectedTasks.has(task.id) ? (
                                    <CheckSquare size={20} color="#00abd8" />
                                  ) : (
                                    <Square size={20} />
                                  )}
                                </div>
                              )}
                              
                              <span style={{
                                ...styles.taskText,
                                textDecoration: isTaskCompleted ? 'line-through' : 'none',
                                color: isTaskCompleted ? 'var(--text-muted)' : 'var(--text-primary)',
                                fontWeight: isTaskCompleted ? '500' : '600'
                              }}>
                                {task.titulo}
                                {task.titulo === 'Firmar inventario' && !isTaskCompleted && (
                                  <span style={styles.signatureBadge}>
                                    Firma Digital
                                  </span>
                                )}
                                {(task.titulo === 'Asociar contrato al inventario' || task.titulo === 'Asociar contrato' || task.titulo === 'Aceptar asociacion inventario') && !isTaskCompleted && (
                                  <span style={{
                                    ...styles.signatureBadge,
                                    backgroundColor: 'rgba(0, 171, 216, 0.1)',
                                    color: '#00abd8',
                                    borderColor: 'rgba(0, 171, 216, 0.2)'
                                  }}>
                                    Automática
                                  </span>
                                )}
                              </span>
                            </div>

                            {/* Botón para iniciar firma Biométrica In-App */}
                            {task.titulo === 'Firmar inventario' && !isTaskCompleted && task.entidad_id && (
                              <button
                                onClick={() => startBiometricSigning(task.entidad_id!)}
                                disabled={loadingInvId === task.entidad_id}
                                className="btn animate-scale-up"
                                style={{
                                  padding: '0.45rem 0.85rem',
                                  fontSize: '0.8rem',
                                  background: 'linear-gradient(135deg, #8b5cf6 0%, #00abd8 100%)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontWeight: '700',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  boxShadow: '0 4px 6px -1px rgba(139, 92, 246, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                }}
                              >
                                {loadingInvId === task.entidad_id ? (
                                  <>
                                    <Loader2 size={13} className="animate-spin" />
                                    Cargando...
                                  </>
                                ) : (
                                  <>
                                    <PenTool size={13} />
                                    Iniciar Firma en Persona
                                  </>
                                )}
                              </button>
                            )}

                            {isTaskCompleted && (
                              <span style={styles.completadaMeta}>
                                <Calendar size={12} style={{ marginRight: '0.25rem' }} />
                                Completada el {new Date(task.completada_at || '').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
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
    gap: '2rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '800',
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
    fontWeight: '600',
    borderRadius: '12px',
  },
  filtersCard: {
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  filterTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  filterTitle: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  filterButtons: {
    display: 'flex',
    gap: '0.65rem',
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '0.55rem 1.25rem',
    fontSize: '0.85rem',
    fontWeight: '700',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    backgroundColor: '#ffffff',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  filterBtnActive: {
    backgroundColor: '#00abd8',
    borderColor: '#00abd8',
    color: '#ffffff',
  },
  groupsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5rem 2rem',
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.25rem 1.5rem',
    cursor: 'pointer',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderBottom: '1px solid var(--border-color)',
    flexWrap: 'wrap',
    gap: '1rem',
    userSelect: 'none',
  },
  groupTitleCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
    flex: 1,
    minWidth: '240px',
  },
  groupTitle: {
    fontSize: '1.15rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
  },
  entityTypeBadge: {
    fontSize: '0.7rem',
    fontWeight: '700',
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    textTransform: 'uppercase',
  },
  groupMetaList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    alignItems: 'center',
  },
  groupMetaItem: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
  groupActionsCol: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  collapseToggleBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.25rem',
  },
  groupBody: {
    padding: '1.5rem',
    backgroundColor: 'rgba(248, 250, 252, 0.3)',
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.85rem',
  },
  taskItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.25rem',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    transition: 'all var(--transition-fast)',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  taskLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    margin: 0,
    flex: 1,
  },
  checkboxBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  taskText: {
    fontSize: '0.92rem',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  completadaMeta: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: '500',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '1.5rem',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '850px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  modalHeader: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.8)',
  },
  modalCloseBtn: {
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    fontWeight: '700',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    backgroundColor: '#ffffff',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  signatureBadge: {
    fontSize: '0.75rem',
    color: '#8b5cf6',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    padding: '0.2rem 0.5rem',
    borderRadius: '6px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  }
};
