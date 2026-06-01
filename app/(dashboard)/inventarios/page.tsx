import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import FormRegisterInventario from './FormRegisterInventario';
import InventarioActions from './InventarioActions';
import { 
  ClipboardList, 
  Plus, 
  ArrowLeft, 
  Building2, 
  User, 
  Calendar, 
  Printer, 
  Eye,
  FileText
} from 'lucide-react';

interface InventariosPageProps {
  searchParams: Promise<{
    action?: string;
    inmuebleId?: string;
  }>;
}

export default async function InventariosPage({ searchParams }: InventariosPageProps) {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  const resolvedParams = await searchParams;
  const isNewAction = resolvedParams.action === 'new';

  // 1. Vista de Creación de un Nuevo Inventario
  if (isNewAction) {
    // Obtener los inmuebles elegibles
    let queryInm = supabase
      .from('inmuebles')
      .select('id, titulo, direccion, arrendasoft_id, estado')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .neq('estado', 'inactivo');

    if (!isAdmin) {
      queryInm = queryInm.eq('asesor_id', profile.id);
    }

    const { data: inmuebles } = await queryInm.order('titulo');

    return (
      <div style={styles.container} className="animate-fade-in">
        <header style={styles.formHeader}>
          <Link href="/inventarios" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Volver a inventarios
          </Link>
          <h1 style={styles.title}>Registrar Formato de Inventario</h1>
          <p style={styles.subtitle}>
            Completa la inspección física detallada del inmueble bajo los estándares de Cumbres Inmobiliaria.
          </p>
        </header>

        <FormRegisterInventario 
          inmuebles={inmuebles || []} 
          defaultInmuebleId={resolvedParams.inmuebleId || ''} 
        />
      </div>
    );
  }

  // 2. Vista de Catálogo de Inventarios
  // Admins: inner join para filtrar por inmobiliaria_id en inmuebles
  // Asesores: left join (sin !inner) para que RLS filtre. Con !inner, si el asesor
  // creó el inventario pero no es asesor_id del inmueble, PostgREST lo excluye.
  const selectFields = (inner: boolean) => `
    id,
    titulo,
    created_at,
    creado_por,
    items,
    arrendasoft_contrato_id,
    contrato_id_propuesto,
    usuarios (nombre_completo),
    inmuebles${inner ? '!inner' : ''} (
      id,
      titulo,
      direccion,
      inmobiliaria_id,
      asesor_id
    )
  `;

  const inventariosQuery = isAdmin
    ? supabase.from('inventarios').select(selectFields(true)).eq('inmuebles.inmobiliaria_id', profile.inmobiliaria_id)
    : supabase.from('inventarios').select(selectFields(false));

  const { data: inventariosRaw } = await inventariosQuery.order('created_at', { ascending: false });
  const inventarios = (inventariosRaw || []) as any[];

  // 3. Consultar tareas pendientes asociadas a los inventarios
  const { data: tareasPendientes } = await supabase
    .from('tareas')
    .select('entidad_id')
    .eq('entidad_tipo', 'inventario')
    .eq('estado', 'pendiente')
    .in('entidad_id', (inventarios || []).map(inv => inv.id));

  const inventariosConTareas = new Set(tareasPendientes?.map(t => t.entidad_id) || []);

  return (
    <div style={styles.container} className="animate-fade-in">
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Inventarios de Viviendas</h1>
          <p style={styles.subtitle}>
            {isAdmin
              ? 'Listado general de actas de entrega e inspecciones de inmuebles firmadas por tu equipo comercial.'
              : 'Administra tus inventarios de entrega y genera las actas en formato de impresión.'}
          </p>
        </div>
        <Link href="/inventarios?action=new" className="btn btn-primary" style={styles.addBtn}>
          <Plus size={18} />
          Nuevo Inventario
        </Link>
      </header>

      {/* Listado de Actas */}
      <section style={styles.list}>
        {!inventarios || inventarios.length === 0 ? (
          <div style={styles.emptyState} className="glass-card">
            <ClipboardList size={48} color="var(--text-muted)" />
            <p style={{ marginTop: '1rem', fontWeight: 600 }}>No se han registrado inventarios de entrega.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Comienza realizando tu primera acta seleccionando el botón "Nuevo Inventario".
            </p>
          </div>
        ) : (
          inventarios.map((inv) => {
            const inmueble = Array.isArray(inv.inmuebles) ? inv.inmuebles[0] : (inv.inmuebles as any);
            const usuario = Array.isArray(inv.usuarios) ? inv.usuarios[0] : (inv.usuarios as any);
            const isFirmado = !!inv.items?.biometria?.inquilino?.firma_url;
            const hasPendingTasks = inventariosConTareas.has(inv.id);

            return (
              <div key={inv.id} className="glass-card animate-fade-in" style={styles.card}>
                <div style={styles.cardMain}>
                  <div style={styles.avatar}>
                    <ClipboardList size={22} color="var(--primary)" />
                  </div>
                  <div style={styles.info}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                      <h3 style={styles.cardTitle}>{inv.titulo}</h3>
                      {isFirmado ? (
                        <span className="badge badge-success" style={{ fontSize: '0.75rem', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.25)', padding: '0.2rem 0.5rem', fontWeight: 700 }}>
                          Firmado
                        </span>
                      ) : (
                        <span className="badge" style={{ fontSize: '0.75rem', backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.25)', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                          Pendiente Firma
                        </span>
                      )}
                    </div>
                    
                    <div style={styles.metaRow}>
                      <span style={styles.metaItem}>
                        <Building2 size={12} />
                        {inmueble?.direccion || 'Sin dirección'}
                      </span>
                      <span style={styles.metaItem}>
                        <Calendar size={12} />
                        {new Date(inv.created_at).toLocaleDateString('es-CO')}
                      </span>
                      <span style={styles.metaItem}>
                        <User size={12} />
                        Elaborado por: {usuario?.nombre_completo || 'Desconocido'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={styles.actions}>
                  <InventarioActions 
                    inventarioId={inv.id}
                    hasPendingTasks={hasPendingTasks}
                    arrendasoftContratoId={inv.arrendasoft_contrato_id}
                    contratoIdPropuesto={inv.contrato_id_propuesto}
                    items={inv.items}
                    asesorNombre={profile.nombre_completo}
                  />
                  <Link 
                    href={`/inventarios/print/${inv.id}`} 
                    target="_blank" 
                    className="btn btn-secondary" 
                    style={styles.printBtn}
                  >
                    <Printer size={14} />
                    <span>Imprimir / Ver</span>
                  </Link>
                </div>
              </div>
            );
          })
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  card: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  cardMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.25rem',
    flex: 1,
    minWidth: '280px',
  },
  avatar: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    minWidth: 0,
  },
  cardTitle: {
    fontSize: '1.05rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  metaRow: {
    display: 'flex',
    gap: '1.25rem',
    flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
  },
  printBtn: {
    padding: '0.45rem 1rem',
    fontSize: '0.85rem',
  },
  emptyState: {
    padding: '5rem 2rem',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
};
