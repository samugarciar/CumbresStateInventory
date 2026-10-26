import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { 
  Building2, 
  ClipboardList, 
  Users, 
  Plus, 
  ArrowRight,
  ShieldCheck,
  MapPin,
  Tag
} from 'lucide-react';
import AdminApprovalWidget from './AdminApprovalWidget';
import { estadoChip } from '../inmuebles/estado';

// Lo que el inicio muestra de cada inmueble reciente (joins de usuarios solo para admin)
interface InmuebleReciente {
  id: string;
  titulo: string;
  direccion: string;
  precio: number;
  tipo_transaccion: string;
  estado: string;
  arrendasoft_id: number | null;
  usuarios?: { nombre_completo: string } | null;
  usuarios_override?: { nombre_completo: string } | null;
}
interface CaptacionPendiente {
  id: string;
  titulo_captacion: string;
  tareas: { id: string; titulo: string; estado: string }[];
}
// Misma forma que espera AdminApprovalWidget
interface SolicitudAprobacion {
  tareaId: string;
  inventarioId: string;
  tituloInventario: string;
  contratoIdPropuesto: string;
  creadoPorNombre: string;
  fecha: string;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user || !user.profile) return null;
  // La cuenta del revisor de Meta solo entra a /whatsapp.
  if (user.profile.rol === 'revisor') redirect('/whatsapp');

  const { profile, inmobiliaria } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  // 1. Obtener Estadísticas en base al Rol
  let totalInmuebles = 0;
  let disponiblesInmuebles = 0;
  let totalInventarios = 0;
  let totalAsesores = 0;

  if (isAdmin) {
    // Estadísticas para Administradores (toda la inmobiliaria)
    const { count: countInm } = await supabase
      .from('inmuebles')
      .select('*', { count: 'exact', head: true })
      .eq('inmobiliaria_id', profile.inmobiliaria_id);
    totalInmuebles = countInm || 0;

    const { count: countDisp } = await supabase
      .from('inmuebles')
      .select('*', { count: 'exact', head: true })
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('estado', 'disponible');
    disponiblesInmuebles = countDisp || 0;

    const { count: countAsesores } = await supabase
      .from('usuarios')
      .select('*', { count: 'exact', head: true })
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('rol', 'asesor')
      .eq('activo', true);
    totalAsesores = countAsesores || 0;

    // Conteo de inventarios para la inmobiliaria
    const { data: invs } = await supabase
      .from('inventarios')
      .select('id, inmuebles!inner(inmobiliaria_id)')
      .eq('inmuebles.inmobiliaria_id', profile.inmobiliaria_id);
    totalInventarios = invs?.length || 0;

  } else {
    // Estadísticas para Asesores (solo lo propio)
    const { count: countInm } = await supabase
      .from('inmuebles')
      .select('*', { count: 'exact', head: true })
      .or(`asesor_id_override.eq.${profile.id},and(asesor_id_override.is.null,asesor_id.eq.${profile.id})`);
    totalInmuebles = countInm || 0;

    const { count: countDisp } = await supabase
      .from('inmuebles')
      .select('*', { count: 'exact', head: true })
      .or(`asesor_id_override.eq.${profile.id},and(asesor_id_override.is.null,asesor_id.eq.${profile.id})`)
      .eq('estado', 'disponible');
    disponiblesInmuebles = countDisp || 0;

    const { count: countInvs } = await supabase
      .from('inventarios')
      .select('*', { count: 'exact', head: true })
      .eq('creado_por', profile.id);
    totalInventarios = countInvs || 0;
  }

  // 2. Obtener Actividad Reciente (Inmuebles recientes)
  let inmueblesRecientes: InmuebleReciente[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion, precio, tipo_transaccion, estado, arrendasoft_id, usuarios!inmuebles_asesor_id_fkey(nombre_completo), usuarios_override:usuarios!inmuebles_asesor_id_override_fkey(nombre_completo)')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .order('arrendasoft_id', { ascending: false, nullsFirst: false })
      .limit(3);
    inmueblesRecientes = (data || []) as unknown as InmuebleReciente[];
  } else {
    const { data } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion, precio, tipo_transaccion, estado, arrendasoft_id')
      .or(`asesor_id_override.eq.${profile.id},and(asesor_id_override.is.null,asesor_id.eq.${profile.id})`)
      .order('arrendasoft_id', { ascending: false, nullsFirst: false })
      .limit(3);
    inmueblesRecientes = (data || []) as unknown as InmuebleReciente[];
  }

  // 3. Obtener Tareas de Captaciones en proceso (pendientes) asociadas al asesor comercial
  let captacionesPendientes: CaptacionPendiente[] = [];
  if (!isAdmin) {
    const { data: tareasPendientesAsesor } = await supabase
      .from('tareas')
      .select('id, entidad_id, evento_titulo, titulo, estado')
      .eq('usuario_id', profile.id)
      .eq('entidad_tipo', 'captacion')
      .eq('estado', 'pendiente');

    // Agrupar las tareas por captación en memoria para mantener la estructura visual anterior
    const captacionesPendientesMap: Record<string, {
      id: string;
      titulo_captacion: string;
      precio?: number;
      tareas: { id: string; titulo: string; estado: string; }[];
    }> = {};

    if (tareasPendientesAsesor) {
      tareasPendientesAsesor.forEach(t => {
        const entidadId = t.entidad_id || 'general';
        if (!captacionesPendientesMap[entidadId]) {
          captacionesPendientesMap[entidadId] = {
            id: entidadId,
            titulo_captacion: t.evento_titulo,
            tareas: []
          };
        }
        captacionesPendientesMap[entidadId].tareas.push({
          id: t.id,
          titulo: t.titulo,
          estado: t.estado
        });
      });
    }

    captacionesPendientes = Object.values(captacionesPendientesMap);
  }

  // 4. Obtener Solicitudes de Asociación de Contratos para Admins
  let solicitudesAprobacion: SolicitudAprobacion[] = [];
  if (isAdmin) {
    const { data: tareasAsociacion } = await supabase
      .from('tareas')
      .select(`
        id,
        entidad_id,
        evento_titulo,
        created_at
      `)
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('titulo', 'Aceptar asociacion inventario')
      .eq('estado', 'pendiente');

    if (tareasAsociacion && tareasAsociacion.length > 0) {
      const inventarioIds = tareasAsociacion.map(t => t.entidad_id).filter(Boolean);
      const { data: invs } = await supabase
        .from('inventarios')
        .select('id, contrato_id_propuesto, usuarios(nombre_completo)')
        .in('id', inventarioIds as string[]);

      const invsMap = new Map(invs?.map(i => {
        const usuario = (Array.isArray(i.usuarios) ? i.usuarios[0] : i.usuarios) as { nombre_completo?: string } | null | undefined;
        return [i.id, { 
          contrato_id_propuesto: i.contrato_id_propuesto, 
          creado_por: usuario?.nombre_completo || 'Asesor' 
        }];
      }));

      solicitudesAprobacion = tareasAsociacion.map(t => {
        const invInfo = invsMap.get(t.entidad_id) || { contrato_id_propuesto: 'Desconocido', creado_por: 'Asesor' };
        return {
          tareaId: t.id,
          inventarioId: t.entidad_id as string, // la consulta solo trae tareas de inventarios
          tituloInventario: t.evento_titulo,
          contratoIdPropuesto: invInfo.contrato_id_propuesto,
          creadoPorNombre: invInfo.creado_por,
          fecha: t.created_at
        };
      });
    }
  }

  return (
    <div style={styles.dashboardContainer} className="animate-fade-in">
      {/* Header */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>¡Hola, {profile.nombre_completo}!</h1>
          <p style={styles.subtitle}>
            Bienvenido al panel de control de <strong>{inmobiliaria?.nombre}</strong>.
          </p>
        </div>
      </header>

      {/* Grid de KPIs */}
      {/* Cifras: en el celular van en una sola fila compacta (ver .inicio-cifras) */}
      <section className="inicio-cifras">
        <div className="glass-card inicio-cifra">
          <div className="inicio-cifra-icono" style={{ ...styles.iconContainer, backgroundColor: 'rgba(0, 171, 216, 0.1)' }}>
            <Building2 size={24} color="var(--primary)" />
          </div>
          <div className="inicio-cifra-info">
            <span className="inicio-cifra-etiqueta">Inmuebles</span>
            <span className="inicio-cifra-valor">{totalInmuebles}</span>
          </div>
        </div>

        <div className="glass-card inicio-cifra">
          <div className="inicio-cifra-icono" style={{ ...styles.iconContainer, backgroundColor: 'rgba(22, 163, 74, 0.1)' }}>
            <Building2 size={24} color="var(--success)" />
          </div>
          <div className="inicio-cifra-info">
            <span className="inicio-cifra-etiqueta">Disponibles</span>
            <span className="inicio-cifra-valor">{disponiblesInmuebles}</span>
          </div>
        </div>

        <div className="glass-card inicio-cifra">
          <div className="inicio-cifra-icono" style={{ ...styles.iconContainer, backgroundColor: 'rgba(99, 102, 241, 0.1)' }}>
            <ClipboardList size={24} color="var(--secondary)" />
          </div>
          <div className="inicio-cifra-info">
            <span className="inicio-cifra-etiqueta">Inventarios firmados</span>
            <span className="inicio-cifra-valor">{totalInventarios}</span>
          </div>
        </div>

        {isAdmin && (
          <div className="glass-card inicio-cifra">
            <div className="inicio-cifra-icono" style={{ ...styles.iconContainer, backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
              <Users size={24} color="var(--warning)" />
            </div>
            <div className="inicio-cifra-info">
              <span className="inicio-cifra-etiqueta">Asesores</span>
              <span className="inicio-cifra-valor">{totalAsesores}</span>
            </div>
          </div>
        )}
      </section>

      {isAdmin && solicitudesAprobacion.length > 0 && (
        <AdminApprovalWidget solicitudes={solicitudesAprobacion} />
      )}

      {/* Contenido Principal: Acciones y Recientes */}
      <div className="dashboard-content-grid">
        {/* Columna Izquierda: Accesos Rápidos */}
        <section style={styles.columnLeft}>
          <h2 style={styles.sectionTitle}>Accesos rápidos</h2>
          <div style={styles.actionsGrid}>
            <Link href="/inmuebles?action=captar" style={styles.actionCard} className="glass-card">
              <div style={styles.actionHeader}>
                <Building2 size={20} color="var(--primary)" />
                <Plus size={16} color="var(--primary)" />
              </div>
              <h3 style={styles.actionTitle}>Registrar inmueble</h3>
              <p style={styles.actionDesc}>Publica una nueva propiedad en la base de datos de la empresa.</p>
            </Link>

            <Link href="/inventarios?action=new" style={styles.actionCard} className="glass-card">
              <div style={styles.actionHeader}>
                <ClipboardList size={20} color="var(--secondary)" />
                <Plus size={16} color="var(--secondary)" />
              </div>
              <h3 style={styles.actionTitle}>Hacer inventario</h3>
              <p style={styles.actionDesc}>Crea un nuevo formato de entrega para un inmueble asignado.</p>
            </Link>

            {isAdmin && (
              <Link href="/asesores?action=new" style={styles.actionCard} className="glass-card">
                <div style={styles.actionHeader}>
                  <Users size={20} color="var(--warning)" />
                  <Plus size={16} color="var(--warning)" />
                </div>
                <h3 style={styles.actionTitle}>Agregar asesor</h3>
                <p style={styles.actionDesc}>Registra a un nuevo asesor comercial dentro de tu inmobiliaria.</p>
              </Link>
            )}
          </div>
        </section>

        {/* Columna Derecha: Inmuebles Recientes */}
        <section style={styles.columnRight}>
          <div style={styles.sectionHeaderFlex}>
            <h2 style={styles.sectionTitle}>Inmuebles recientes</h2>
            <Link href="/inmuebles" style={styles.viewAllLink} className="enlace-accion">
              Ver todos <ArrowRight size={14} />
            </Link>
          </div>

          <div style={styles.recentList}>
            {inmueblesRecientes.length === 0 ? (
              <div style={styles.emptyState}>
                <p>Aún no hay inmuebles registrados.</p>
                <Link href="/inmuebles?action=captar" className="enlace" style={styles.emptyStateLink}>
                  Registrar mi primer inmueble
                </Link>
              </div>
            ) : (
              inmueblesRecientes.map((inm) => (
                <div key={inm.id} className="glass-card" style={styles.recentCard}>
                  <div style={styles.recentCardInfo}>
                    <h4 style={styles.recentCardTitle}>{inm.titulo}</h4>
                    <div style={styles.recentCardMeta}>
                      <span style={styles.recentCardMetaItem}>
                        <MapPin size={12} />
                        {inm.direccion}
                      </span>
                      <span style={styles.recentCardMetaItem}>
                        <Tag size={12} />
                        ${Number(inm.precio).toLocaleString('es-CO')} COP ({inm.tipo_transaccion})
                      </span>
                      {inm.arrendasoft_id && (
                        <span style={{ ...styles.recentCardMetaItem, fontFamily: 'monospace', fontWeight: 'bold' }}>
                          ID: {inm.arrendasoft_id}
                        </span>
                      )}
                    </div>
                    {isAdmin && (inm.usuarios_override || inm.usuarios) && (
                      <span style={styles.recentCardAsesor}>
                        Asesor: {inm.usuarios_override?.nombre_completo || inm.usuarios?.nombre_completo}
                        {inm.usuarios_override && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--success)', marginLeft: '0.3rem', fontWeight: 600 }}>
                            (Reasignado)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div>
                    {(() => {
                      // Mismos colores que la tarjeta del catálogo (antes «arrendado» salía en rojo)
                      const chip = estadoChip(inm.estado);
                      return (
                        <span style={{ ...styles.estadoChip, backgroundColor: chip.bg, color: chip.color }}>
                          {chip.txt}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Captaciones Pendientes de Procesamiento (Solo visible para Asesores comercial) */}
          {!isAdmin && captacionesPendientes.length > 0 && (
            <div style={{ marginTop: '2.5rem' }} className="animate-fade-in">
              <h2 style={{ ...styles.sectionTitle, marginBottom: '1.25rem' }}>
                Mis captaciones en proceso
              </h2>
              <div style={styles.recentList}>
                {captacionesPendientes.map((capt) => (
                  <div key={capt.id} className="glass-card" style={styles.pendingCaptCard}>
                    <div style={styles.recentCardInfo}>
                      <h4 style={styles.recentCardTitle}>{capt.titulo_captacion}</h4>
                      <div style={styles.recentCardMeta}>
                        <span style={styles.recentCardMetaItem}>
                          <Tag size={12} />
                          En espera de publicación
                        </span>
                        <div style={styles.pendingTasksBadgeContainer}>
                          {capt.tareas.map((task) => (
                            <span key={task.id} className="badge" style={styles.pendingTaskBadge}>
                              Falta: {task.titulo === 'Subir a marketplace' ? 'Marketplace' : 'ERP'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className="badge badge-warning" style={{ fontSize: '0.75rem', fontWeight: '700' }}>
                        En Proceso
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  dashboardContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2.5rem',
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
  iconContainer: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  estadoChip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.2rem 0.65rem',
    borderRadius: '50px',
    fontSize: '0.75rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2.5rem',
  },
  columnLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  columnRight: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
  },
  sectionHeaderFlex: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewAllLink: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    transition: 'color var(--transition-fast)',
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1rem',
  },
  actionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1.5rem',
    cursor: 'pointer',
  },
  actionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  actionTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  actionDesc: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
  },
  recentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  recentCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem',
    padding: '1.25rem',
  },
  recentCardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    minWidth: 0,
  },
  recentCardTitle: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  recentCardMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  },
  recentCardMetaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  recentCardAsesor: {
    fontSize: '0.75rem',
    color: 'var(--primary)',
    fontWeight: '500',
    marginTop: '0.25rem',
  },
  emptyState: {
    padding: '3rem 2rem',
    textAlign: 'center',
    border: '1px dashed var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    color: 'var(--text-secondary)',
  },
  emptyStateLink: {
    fontSize: '0.9rem',
  },
  pendingCaptCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem',
    padding: '1.25rem',
    borderLeft: '4px solid var(--warning)',
  },
  pendingTasksBadgeContainer: {
    display: 'flex',
    gap: '0.35rem',
    marginTop: '0.4rem',
    flexWrap: 'wrap',
  },
  pendingTaskBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.2)',
    color: 'var(--warning)',
    fontSize: '0.7rem',
    fontWeight: '700',
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
    textTransform: 'uppercase',
  },
};
