import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import FormRegisterInmueble from './FormRegisterInmueble';
import StateSelector from './StateSelector';
import { 
  Building2, 
  Plus, 
  ArrowLeft, 
  MapPin, 
  Tag, 
  Key, 
  SlidersHorizontal,
  Home,
  UserCheck,
  Search
} from 'lucide-react';

interface InmueblesPageProps {
  searchParams: Promise<{
    action?: string;
    tipo?: string;
    transaccion?: string;
    estado?: string;
    q?: string;
  }>;
}

export default async function InmueblesPage({ searchParams }: InmueblesPageProps) {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  const resolvedParams = await searchParams;
  const isNewAction = resolvedParams.action === 'new';

  // 1. Renderizar Vista de Creación de Inmueble
  if (isNewAction) {
    let asesores: any[] = [];
    if (isAdmin) {
      const { data } = await supabase
        .from('usuarios')
        .select('id, nombre_completo')
        .eq('inmobiliaria_id', profile.inmobiliaria_id)
        .eq('rol', 'asesor');
      asesores = data || [];
    }

    return (
      <div style={styles.container} className="animate-fade-in">
        <header style={styles.formHeader}>
          <Link href="/inmuebles" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Volver al catálogo
          </Link>
          <h1 style={styles.title}>Registrar Nuevo Inmueble</h1>
          <p style={styles.subtitle}>
            Añade una nueva propiedad al inventario de tu inmobiliaria.
          </p>
        </header>

        <div className="glass-container" style={styles.formCard}>
          <FormRegisterInmueble isAdmin={isAdmin} asesores={asesores} />
        </div>
      </div>
    );
  }

  // 2. Renderizar Catálogo de Inmuebles
  // Construir consulta dinámica basada en los filtros
  let query = supabase
    .from('inmuebles')
    .select('*, usuarios(nombre_completo)')
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (!isAdmin) {
    // Si es asesor, forzar visualización exclusiva de los propios
    query = query.eq('asesor_id', profile.id);
  }

  // Aplicar filtros de URL si existen
  if (resolvedParams.tipo) {
    query = query.eq('tipo_inmueble', resolvedParams.tipo);
  }
  if (resolvedParams.transaccion) {
    query = query.eq('tipo_transaccion', resolvedParams.transaccion);
  }
  if (resolvedParams.estado) {
    query = query.eq('estado', resolvedParams.estado);
  }

  const { data: inmuebles, error } = await query.order('created_at', { ascending: false });

  return (
    <div style={styles.container} className="animate-fade-in">
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Catálogo de Inmuebles</h1>
          <p style={styles.subtitle}>
            {isAdmin 
              ? 'Controla y supervisa todos los inmuebles de tu inmobiliaria y sus respectivos asesores asignados.'
              : 'Administra y lleva el control de tus propiedades e inventarios asociados.'}
          </p>
        </div>
        <Link href="/inmuebles?action=new" className="btn btn-primary" style={styles.addBtn}>
          <Plus size={18} />
          Registrar Inmueble
        </Link>
      </header>

      {/* Panel de Filtros */}
      <section className="glass-card" style={styles.filtersCard}>
        <div style={styles.filtersTitleRow}>
          <SlidersHorizontal size={16} color="var(--primary)" />
          <span style={styles.filtersTitle}>Filtros de Búsqueda</span>
        </div>
        <form method="GET" action="/inmuebles" style={styles.filtersForm}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Tipo de Inmueble</label>
            <select name="tipo" className="form-select" defaultValue={resolvedParams.tipo || ''} style={styles.filterSelect}>
              <option value="">Todos</option>
              <option value="casa">Casa</option>
              <option value="apartamento">Apartamento</option>
              <option value="lote">Lote</option>
              <option value="local">Local Comercial</option>
              <option value="bodega">Bodega</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Transacción</label>
            <select name="transaccion" className="form-select" defaultValue={resolvedParams.transaccion || ''} style={styles.filterSelect}>
              <option value="">Todas</option>
              <option value="arriendo">Arriendo</option>
              <option value="venta">Venta</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Estado</label>
            <select name="estado" className="form-select" defaultValue={resolvedParams.estado || ''} style={styles.filterSelect}>
              <option value="">Todos</option>
              <option value="disponible">Disponible</option>
              <option value="reservado">Reservado</option>
              <option value="vendido">Vendido</option>
              <option value="arrendado">Arrendado</option>
            </select>
          </div>

          <div style={styles.filterButtons}>
            <button type="submit" className="btn btn-primary" style={styles.filterBtn}>
              Aplicar Filtros
            </button>
            {(resolvedParams.tipo || resolvedParams.transaccion || resolvedParams.estado) && (
              <Link href="/inmuebles" className="btn btn-secondary" style={styles.clearBtn}>
                Limpiar
              </Link>
            )}
          </div>
        </form>
      </section>

      {/* Listado de Inmuebles */}
      <section style={styles.grid}>
        {!inmuebles || inmuebles.length === 0 ? (
          <div style={styles.emptyState} className="glass-card">
            <Building2 size={48} color="var(--text-muted)" />
            <p style={{ marginTop: '1rem', fontWeight: 600 }}>No se encontraron inmuebles registrados.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Intenta cambiar los filtros o registra una nueva propiedad presionando el botón superior.
            </p>
          </div>
        ) : (
          inmuebles.map((inm) => (
            <div key={inm.id} className="glass-card animate-fade-in" style={styles.inmuebleCard}>
              <div style={styles.cardHeader}>
                <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>
                  {inm.tipo_inmueble}
                </span>
                <span style={styles.transactionBadge}>
                  {inm.tipo_transaccion === 'arriendo' ? 'En Arriendo' : 'En Venta'}
                </span>
              </div>

              <div style={styles.cardBody}>
                <h3 style={styles.cardTitle} title={inm.titulo}>
                  {inm.titulo}
                </h3>
                <p style={styles.cardDesc}>{inm.descripcion || 'Sin descripción adicional.'}</p>
                
                <div style={styles.metaList}>
                  <div style={styles.metaItem}>
                    <MapPin size={14} color="var(--primary)" />
                    <span style={styles.metaText}>{inm.direccion}</span>
                  </div>
                  <div style={styles.metaItem}>
                    <Tag size={14} color="var(--primary)" />
                    <span style={styles.metaPrice}>
                      ${Number(inm.precio).toLocaleString('es-CO')} COP
                    </span>
                  </div>
                  {isAdmin && inm.usuarios && (
                    <div style={styles.metaItem}>
                      <UserCheck size={14} color="var(--secondary)" />
                      <span style={styles.metaText} title={inm.usuarios.nombre_completo}>
                        Asesor: {inm.usuarios.nombre_completo}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.cardFooter}>
                <div style={styles.stateSelectorWrapper}>
                  <span style={styles.stateLabel}>Estado:</span>
                  <StateSelector inmuebleId={inm.id} currentEstado={inm.estado} />
                </div>
                
                <Link href={`/inventarios?action=new&inmuebleId=${inm.id}`} className="btn btn-secondary" style={styles.inventarioBtn}>
                  <Plus size={14} />
                  Inventario
                </Link>
              </div>
            </div>
          ))
        )}
      </section>
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
  formHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.75rem',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: 'var(--primary)',
    fontWeight: '600',
    fontSize: '0.9rem',
    transition: 'color var(--transition-fast)',
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
  addBtn: {
    padding: '0.65rem 1.25rem',
  },
  filtersCard: {
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  filtersTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  filtersTitle: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  filtersForm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1.25rem',
    alignItems: 'flex-end',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    flex: 1,
    minWidth: '180px',
  },
  filterLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  filterSelect: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem',
  },
  filterButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  filterBtn: {
    padding: '0.55rem 1.25rem',
    fontSize: '0.85rem',
  },
  clearBtn: {
    padding: '0.55rem 1.25rem',
    fontSize: '0.85rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '1.5rem',
  },
  inmuebleCard: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '1.5rem',
    height: '100%',
    minHeight: '340px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  transactionBadge: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--primary)',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    flex: 1,
  },
  cardTitle: {
    fontSize: '1.15rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardDesc: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    height: '2.5rem',
  },
  metaList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginTop: '0.5rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '0.75rem',
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    minWidth: 0,
  },
  metaText: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  metaPrice: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '1.5rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '1rem',
  },
  stateSelectorWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  stateLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
  },
  inventarioBtn: {
    padding: '0.4rem 0.85rem',
    fontSize: '0.8rem',
  },
  formCard: {
    padding: '2.5rem',
    maxWidth: '720px',
    width: '100%',
    margin: '0 auto',
  },
  emptyState: {
    gridColumn: '1 / -1',
    padding: '5rem 2rem',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
};
