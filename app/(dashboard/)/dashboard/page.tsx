import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { 
  Building2, 
  ClipboardList, 
  Users, 
  Plus, 
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  MapPin,
  Tag
} from 'lucide-react';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user || !user.profile) return null;

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
      .eq('rol', 'asesor');
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
      .eq('asesor_id', profile.id);
    totalInmuebles = countInm || 0;

    const { count: countDisp } = await supabase
      .from('inmuebles')
      .select('*', { count: 'exact', head: true })
      .eq('asesor_id', profile.id)
      .eq('estado', 'disponible');
    disponiblesInmuebles = countDisp || 0;

    const { count: countInvs } = await supabase
      .from('inventarios')
      .select('*', { count: 'exact', head: true })
      .eq('creado_por', profile.id);
    totalInventarios = countInvs || 0;
  }

  // 2. Obtener Actividad Reciente (Inmuebles recientes)
  let inmueblesRecientes: any[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion, precio, tipo_transaccion, estado, usuarios(nombre_completo)')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .order('created_at', { ascending: false })
      .limit(3);
    inmueblesRecientes = data || [];
  } else {
    const { data } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion, precio, tipo_transaccion, estado')
      .eq('asesor_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(3);
    inmueblesRecientes = data || [];
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
        <div style={styles.dateBadge}>
          <TrendingUp size={16} color="var(--primary)" />
          <span>Productividad Activa</span>
        </div>
      </header>

      {/* Grid de KPIs */}
      <section style={styles.statsGrid}>
        <div className="glass-card" style={styles.statCard}>
          <div style={{ ...styles.iconContainer, backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
            <Building2 size={24} color="var(--primary)" />
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statLabel}>Inmuebles Totales</span>
            <span style={styles.statValue}>{totalInmuebles}</span>
          </div>
        </div>

        <div className="glass-card" style={styles.statCard}>
          <div style={{ ...styles.iconContainer, backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
            <Building2 size={24} color="var(--info)" />
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statLabel}>Disponibles</span>
            <span style={styles.statValue}>{disponiblesInmuebles}</span>
          </div>
        </div>

        <div className="glass-card" style={styles.statCard}>
          <div style={{ ...styles.iconContainer, backgroundColor: 'rgba(99, 102, 241, 0.1)' }}>
            <ClipboardList size={24} color="var(--secondary)" />
          </div>
          <div style={styles.statInfo}>
            <span style={styles.statLabel}>Inventarios Firmados</span>
            <span style={styles.statValue}>{totalInventarios}</span>
          </div>
        </div>

        {isAdmin && (
          <div className="glass-card" style={styles.statCard}>
            <div style={{ ...styles.iconContainer, backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
              <Users size={24} color="var(--warning)" />
            </div>
            <div style={styles.statInfo}>
              <span style={styles.statLabel}>Asesores Comerciales</span>
              <span style={styles.statValue}>{totalAsesores}</span>
            </div>
          </div>
        )}
      </section>

      {/* Contenido Principal: Acciones y Recientes */}
      <div style={styles.contentGrid}>
        {/* Columna Izquierda: Accesos Rápidos */}
        <section style={styles.columnLeft}>
          <h2 style={styles.sectionTitle}>Accesos Rápidos</h2>
          <div style={styles.actionsGrid}>
            <Link href="/inmuebles?action=new" style={styles.actionCard} className="glass-card">
              <div style={styles.actionHeader}>
                <Building2 size={20} color="var(--primary)" />
                <Plus size={16} color="var(--primary)" />
              </div>
              <h3 style={styles.actionTitle}>Registrar Inmueble</h3>
              <p style={styles.actionDesc}>Publica una nueva propiedad en la base de datos de la empresa.</p>
            </Link>

            <Link href="/inventarios?action=new" style={styles.actionCard} className="glass-card">
              <div style={styles.actionHeader}>
                <ClipboardList size={20} color="var(--secondary)" />
                <Plus size={16} color="var(--secondary)" />
              </div>
              <h3 style={styles.actionTitle}>Hacer Inventario</h3>
              <p style={styles.actionDesc}>Crea un nuevo formato de entrega para un inmueble asignado.</p>
            </Link>

            {isAdmin && (
              <Link href="/asesores?action=new" style={styles.actionCard} className="glass-card">
                <div style={styles.actionHeader}>
                  <Users size={20} color="var(--warning)" />
                  <Plus size={16} color="var(--warning)" />
                </div>
                <h3 style={styles.actionTitle}>Agregar Asesor</h3>
                <p style={styles.actionDesc}>Registra a un nuevo asesor comercial dentro de tu inmobiliaria.</p>
              </Link>
            )}
          </div>
        </section>

        {/* Columna Derecha: Inmuebles Recientes */}
        <section style={styles.columnRight}>
          <div style={styles.sectionHeaderFlex}>
            <h2 style={styles.sectionTitle}>Inmuebles Recientes</h2>
            <Link href="/inmuebles" style={styles.viewAllLink}>
              Ver todos <ArrowRight size={14} />
            </Link>
          </div>

          <div style={styles.recentList}>
            {inmueblesRecientes.length === 0 ? (
              <div style={styles.emptyState}>
                <p>Aún no hay inmuebles registrados.</p>
                <Link href="/inmuebles?action=new" style={styles.emptyStateLink}>
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
                    </div>
                    {isAdmin && inm.usuarios && (
                      <span style={styles.recentCardAsesor}>
                        Asesor: {inm.usuarios.nombre_completo}
                      </span>
                    )}
                  </div>
                  <div>
                    <span 
                      className={`badge badge-${
                        inm.estado === 'disponible' ? 'success' : 
                        inm.estado === 'reservado' ? 'warning' : 'danger'
                      }`}
                    >
                      {inm.estado}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
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
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: '0.25rem',
  },
  subtitle: {
    fontSize: '1rem',
    color: 'var(--text-secondary)',
  },
  dateBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    border: '1px solid rgba(16, 185, 129, 0.2)',
    padding: '0.5rem 1rem',
    borderRadius: '50px',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--primary)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1.5rem',
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.25rem',
    padding: '1.5rem',
  },
  iconContainer: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  },
  statLabel: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: '800',
    color: '#ffffff',
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
    color: '#ffffff',
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
    gridTemplateColumns: '1fr',
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
    color: '#ffffff',
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
    color: '#ffffff',
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
    color: 'var(--primary)',
    fontWeight: '600',
    fontSize: '0.9rem',
    textDecoration: 'underline',
  },
};
