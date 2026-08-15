import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import FormCaptarInmueble from './FormCaptarInmueble';
import LogsWebhookTable from './LogsWebhookTable';
import InmuebleCard from './InmuebleCard';
import FiltersPanel from './FiltersPanel';
import {
  Building2,
  Plus,
  ArrowLeft,
  Key,
  Home,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  History
} from 'lucide-react';

interface InmueblesPageProps {
  searchParams: Promise<{
    action?: string;
    tipo?: string;
    transaccion?: string;
    estado?: string;
    q?: string;
    order?: string;
    page?: string;
    asesor?: string;
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
  const isCaptarAction = resolvedParams.action === 'captar';
  const isLogsAction = resolvedParams.action === 'logs';

  // Obtener lista de asesores si es administrador (se usa para creación y filtros)
  let asesores: any[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('rol', 'asesor');
    asesores = data || [];
  }

  // Unidades ya existentes en la inmobiliaria (para el autocompletado del editor de unidad).
  // Se listan todas, no solo las de la página actual, para evitar duplicados por tipeo.
  let unidadesExistentes: string[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('inmuebles')
      .select('unidad')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .not('unidad', 'is', null);
    unidadesExistentes = Array.from(
      new Set((data || []).map((r: any) => (r.unidad || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'es'));
  }

  // 1. Renderizar Vista de Registro / Captación de Inmueble a través de n8n
  if (isCaptarAction) {
    return (
      <div style={styles.container} className="animate-fade-in">
        <header style={styles.formHeader}>
          <Link href="/inmuebles" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Volver al catálogo
          </Link>
          <h1 style={styles.title}>Registrar Nuevo Inmueble</h1>
          <p style={styles.subtitle}>
            Completa la ficha técnica para registrar la propiedad e iniciar el flujo automatizado en n8n.
          </p>
        </header>

        <div className="glass-container" style={styles.formCard}>
          <FormCaptarInmueble isAdmin={isAdmin} unidades={unidadesExistentes} />
        </div>
      </div>
    );
  }

  // 1.3. Renderizar Historial de Trazabilidad Webhook (Logs)
  if (isLogsAction) {
    // Cargar logs desde Supabase en orden descendente
    let logsQuery = supabase
      .from('webhook_logs')
      .select('*')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      logsQuery = logsQuery.eq('usuario_id', profile.id);
    }
    const { data: logs } = await logsQuery;

    return (
      <div style={styles.container} className="animate-fade-in">
        <header style={styles.formHeader}>
          <Link href="/inmuebles" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Volver al catálogo
          </Link>
          <h1 style={styles.title}>Auditoría de Captaciones</h1>
          <p style={styles.subtitle}>
            Supervisa los disparos del webhook, pesos de imágenes y estados de integración.
          </p>
        </header>

        <div className="glass-container" style={{ ...styles.formCard, maxWidth: '1000px' }}>
          <LogsWebhookTable logs={logs || []} />
        </div>
      </div>
    );
  }

  // 2. Calcular contadores (KPIs) en base a roles y filtros
  let statsQuery = supabase
    .from('inmuebles')
    .select('estado, asesor_id, asesor_id_override')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .in('estado', ['disponible', 'arrendado']);

  if (!isAdmin) {
    statsQuery = statsQuery.or(`asesor_id_override.eq.${profile.id},and(asesor_id_override.is.null,asesor_id.eq.${profile.id})`);
  } else if (resolvedParams.asesor) {
    statsQuery = statsQuery.or(`asesor_id_override.eq.${resolvedParams.asesor},and(asesor_id_override.is.null,asesor_id.eq.${resolvedParams.asesor})`);
  }
  const { data: allStats } = await statsQuery;
  const totalDisponibles = allStats?.filter(i => i.estado === 'disponible').length || 0;
  const totalArrendados = allStats?.filter(i => i.estado === 'arrendado').length || 0;

  // 3. Renderizar Catálogo de Inmuebles
  // Paginación y rangos
  const page = Number(resolvedParams.page) || 1;
  const itemsPerPage = 15;
  const from = (page - 1) * itemsPerPage;
  const to = from + itemsPerPage - 1;

  // Construir consulta dinámica basada en los filtros con count: 'exact'
  let query = supabase
    .from('inmuebles')
    .select('*, usuarios!inmuebles_asesor_id_fkey(nombre_completo), usuarios_override:usuarios!inmuebles_asesor_id_override_fkey(nombre_completo)', { count: 'exact' })
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (!isAdmin) {
    // Si es asesor, forzar visualización exclusiva de los propios o reasignados a sí mismos
    query = query.or(`asesor_id_override.eq.${profile.id},and(asesor_id_override.is.null,asesor_id.eq.${profile.id})`);
  } else if (resolvedParams.asesor) {
    // Si es admin y se seleccionó un asesor, filtrar por ese asesor
    query = query.or(`asesor_id_override.eq.${resolvedParams.asesor},and(asesor_id_override.is.null,asesor_id.eq.${resolvedParams.asesor})`);
  }

  // Aplicar filtros de URL si existen
  if (resolvedParams.tipo) {
    query = query.eq('tipo_inmueble', resolvedParams.tipo);
  }
  if (resolvedParams.transaccion) {
    query = query.eq('tipo_transaccion', resolvedParams.transaccion);
  }
  if (resolvedParams.estado === 'desocupacion') {
    // Ofertados: se muestran como disponibles en la app pero el ERP los
    // mantiene 'arrendado' (override local, ver OfertarControl)
    query = query.eq('estado_override', 'disponible');
  } else if (resolvedParams.estado) {
    query = query.eq('estado', resolvedParams.estado);
  } else {
    // Omitir inactivos por defecto (según requerimiento de negocio)
    query = query.in('estado', ['disponible', 'arrendado']);
  }

  // Filtro de búsqueda textual 'q'
  if (resolvedParams.q) {
    const searchVal = `%${resolvedParams.q}%`;
    const numQ = Number(resolvedParams.q);
    if (!isNaN(numQ) && Number.isInteger(numQ)) {
      query = query.or(`titulo.ilike.${searchVal},direccion.ilike.${searchVal},descripcion.ilike.${searchVal},arrendasoft_id.eq.${numQ}`);
    } else {
      query = query.or(`titulo.ilike.${searchVal},direccion.ilike.${searchVal},descripcion.ilike.${searchVal}`);
    }
  }

  // Ordenación por código (Mayor a Menor / desc es el orden por defecto del catálogo)
  const isAsc = resolvedParams.order === 'asc';
  query = query.order('arrendasoft_id', { ascending: isAsc, nullsFirst: false });

  // Limitar rango para paginación
  query = query.range(from, to);

  const { data: inmuebles, error, count } = await query;
  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  const getPageUrl = (pageNumber: number) => {
    const params = new URLSearchParams();
    if (resolvedParams.q) params.set('q', resolvedParams.q);
    if (resolvedParams.tipo) params.set('tipo', resolvedParams.tipo);
    if (resolvedParams.transaccion) params.set('transaccion', resolvedParams.transaccion);
    if (resolvedParams.estado) params.set('estado', resolvedParams.estado);
    if (resolvedParams.order) params.set('order', resolvedParams.order);
    if (resolvedParams.asesor) params.set('asesor', resolvedParams.asesor);
    params.set('page', pageNumber.toString());
    return `/inmuebles?${params.toString()}`;
  };

  const getVisiblePages = (current: number, total: number) => {
    const range: (number | string)[] = [];
    const delta = 1;
    for (let i = 1; i <= total; i++) {
      if (
        i === 1 ||
        i === total ||
        (i >= current - delta && i <= current + delta)
      ) {
        range.push(i);
      } else if (range[range.length - 1] !== '...') {
        range.push('...');
      }
    }
    return range;
  };

  const visiblePages = getVisiblePages(page, totalPages);

  return (
    <div style={styles.container} className="animate-fade-in">
      <header className="responsive-header">
        <div>
          <h1 style={styles.title}>Catálogo de Inmuebles</h1>
          <p style={styles.subtitle}>
            {isAdmin 
              ? 'Controla y supervisa todos los inmuebles de tu inmobiliaria y sus respectivos asesores asignados.'
              : 'Administra y lleva el control de tus propiedades e inventarios asociados.'}
          </p>
        </div>
        <div className="responsive-header-buttons">
          {isAdmin && (
            <Link href="/inmuebles/sync" className="btn btn-secondary" style={styles.syncNavBtn}>
              <RefreshCw size={16} />
              Sincronizar ERP
            </Link>
          )}
          {isAdmin && (
            <Link href="/inmuebles?action=logs" className="btn btn-secondary" style={styles.syncNavBtn} title="Ver historial de disparos del Webhook">
              <History size={16} />
              Historial Webhook
            </Link>
          )}
          <Link href="/inmuebles?action=captar" className="btn btn-primary" style={styles.addBtn}>
            <Plus size={18} />
            Registrar Inmueble
          </Link>
        </div>
      </header>

      {/* Indicadores KPI */}
      <section style={styles.kpiRow}>
        <div className="glass-card animate-fade-in" style={styles.kpiCard}>
          <div style={{ ...styles.kpiIndicator, backgroundColor: 'rgba(0, 171, 216, 0.08)', border: '1px solid rgba(0, 171, 216, 0.15)' }}>
            <Home size={18} color="var(--primary)" />
          </div>
          <div>
            <span style={styles.kpiLabel}>Inmuebles Disponibles</span>
            <h3 style={styles.kpiValue}>{totalDisponibles}</h3>
          </div>
        </div>

        <div className="glass-card animate-fade-in" style={styles.kpiCard}>
          <div style={{ ...styles.kpiIndicator, backgroundColor: 'rgba(71, 85, 105, 0.08)', border: '1px solid rgba(71, 85, 105, 0.15)' }}>
            <Key size={18} color="var(--text-secondary)" />
          </div>
          <div>
            <span style={styles.kpiLabel}>Inmuebles Arrendados</span>
            <h3 style={styles.kpiValue}>{totalArrendados}</h3>
          </div>
        </div>
      </section>

      {/* Panel de Filtros Reactivos */}
      <FiltersPanel asesores={asesores} isAdmin={isAdmin} />

      {/* Listado de Inmuebles */}
      <section className="inmuebles-grid">
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
            <InmuebleCard
              key={inm.id}
              inmueble={inm}
              asesores={asesores}
              unidadesExistentes={unidadesExistentes}
              isAdmin={isAdmin}
            />
          ))
        )}
      </section>

      {/* Barra de Paginación */}
      {totalPages > 1 && (
        <div style={styles.paginationContainer}>
          <span style={styles.paginationInfo}>
            Página <strong>{page}</strong> de <strong>{totalPages}</strong> ({totalCount} inmuebles)
          </span>
          
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            {page > 1 ? (
              <Link href={getPageUrl(page - 1)} style={styles.paginationButton} title="Página Anterior">
                <ChevronLeft size={16} />
                <span style={{ marginLeft: '0.25rem' }}>Anterior</span>
              </Link>
            ) : (
              <span style={{ ...styles.paginationButton, ...styles.paginationButtonDisabled }}>
                <ChevronLeft size={16} />
                <span style={{ marginLeft: '0.25rem' }}>Anterior</span>
              </span>
            )}

            {visiblePages.map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`ellipsis-${idx}`} style={{ ...styles.paginationButton, cursor: 'default', border: 'none', backgroundColor: 'transparent' }}>
                    ...
                  </span>
                );
              }
              const pageNum = p as number;
              return (
                <Link
                  key={`page-${pageNum}`}
                  href={getPageUrl(pageNum)}
                  style={{
                    ...styles.paginationButton,
                    ...(pageNum === page ? styles.paginationButtonActive : {}),
                  }}
                >
                  {pageNum}
                </Link>
              );
            })}

            {page < totalPages ? (
              <Link href={getPageUrl(page + 1)} style={styles.paginationButton} title="Siguiente Página">
                <span style={{ marginRight: '0.25rem' }}>Siguiente</span>
                <ChevronRight size={16} />
              </Link>
            ) : (
              <span style={{ ...styles.paginationButton, ...styles.paginationButtonDisabled }}>
                <span style={{ marginRight: '0.25rem' }}>Siguiente</span>
                <ChevronRight size={16} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
    minWidth: 0,
    overflow: 'hidden',
    width: '100%',
  },
  kpiRow: {
    display: 'flex',
    gap: '1.5rem',
    flexWrap: 'wrap',
  },
  kpiCard: {
    flex: '1 1 240px',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.25rem 1.5rem',
  },
  kpiIndicator: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiLabel: {
    fontSize: '0.78rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    display: 'block',
  },
  kpiValue: {
    fontSize: '1.5rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
    marginTop: '0.15rem',
  },
  syncNavBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.55rem 1.1rem',
    fontSize: '0.87rem',
    fontWeight: '700',
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
  paginationContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    marginTop: '2.5rem',
    padding: '1.25rem 1.5rem',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    flexWrap: 'wrap',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.02)',
  },
  paginationButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    height: '36px',
    padding: '0 0.75rem',
    borderRadius: '8px',
    fontSize: '0.82rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    textDecoration: 'none',
  },
  paginationButtonActive: {
    color: '#ffffff',
    backgroundColor: '#00abd8', // Primary brand color
    borderColor: '#00abd8',
    pointerEvents: 'none',
  },
  paginationButtonDisabled: {
    color: 'var(--text-muted)',
    backgroundColor: 'rgba(241, 245, 249, 0.5)',
    borderColor: 'var(--border-color)',
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },
  paginationInfo: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
};
