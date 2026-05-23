import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import FormRegisterAsesor from './FormRegisterAsesor';
import { Users, Mail, Calendar, Key, ShieldCheck, Briefcase } from 'lucide-react';

export default async function AsesoresPage() {
  // 1. Validar permisos de administrador
  const user = await getCurrentUser();
  if (!user || !user.profile || user.profile.rol !== 'admin') {
    redirect('/dashboard');
  }

  const { profile } = user;
  const supabase = await createClient();

  // 2. Obtener lista de asesores registrados en la inmobiliaria
  const { data: asesores, error } = await supabase
    .from('usuarios')
    .select('id, nombre_completo, email, created_at')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .eq('rol', 'asesor')
    .order('created_at', { ascending: false });

  return (
    <div style={styles.container} className="animate-fade-in">
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Asesores Comerciales</h1>
          <p style={styles.subtitle}>
            Administra el equipo comercial autorizado para registrar inmuebles e inventarios.
          </p>
        </div>
      </header>

      <div style={styles.layout}>
        {/* Columna Izquierda: Listado de Asesores */}
        <section style={styles.listSection}>
          <div style={styles.listHeader}>
            <div style={styles.statsBadge}>
              <Users size={16} />
              <span>{asesores?.length || 0} Registrados</span>
            </div>
          </div>

          <div style={styles.list}>
            {!asesores || asesores.length === 0 ? (
              <div style={styles.emptyState}>
                <Users size={40} color="var(--text-muted)" />
                <p style={{ marginTop: '1rem' }}>No hay asesores comerciales registrados en tu inmobiliaria.</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Utiliza el formulario de la derecha para dar de alta al primer asesor.
                </p>
              </div>
            ) : (
              asesores.map((asesor) => (
                <div key={asesor.id} className="glass-card animate-fade-in" style={styles.card}>
                  <div style={styles.avatar}>
                    <Briefcase size={18} color="var(--primary)" />
                  </div>
                  <div style={styles.info}>
                    <h3 style={styles.name}>{asesor.nombre_completo}</h3>
                    <div style={styles.metaRow}>
                      <span style={styles.metaItem}>
                        <Mail size={12} />
                        {asesor.email}
                      </span>
                      <span style={styles.metaItem}>
                        <Calendar size={12} />
                        Registrado el {new Date(asesor.created_at).toLocaleDateString('es-CO')}
                      </span>
                    </div>
                  </div>
                  <div className="badge badge-info" style={styles.roleBadge}>
                    Asesor Activo
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Columna Derecha: Formulario de Registro */}
        <aside style={styles.aside}>
          <div className="glass-container" style={styles.formCard}>
            <div style={styles.formHeader}>
              <ShieldCheck size={24} color="var(--primary)" />
              <h2 style={styles.formTitle}>Registrar Asesor</h2>
            </div>
            <p style={styles.formSubtitle}>
              Completa los datos para dar de alta de forma segura una cuenta de acceso para un nuevo asesor de ventas.
            </p>
            <FormRegisterAsesor />
          </div>
        </aside>
      </div>
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
    marginBottom: '0.5rem',
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
  layout: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr',
    gap: '2.5rem',
    alignItems: 'start',
  },
  listSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.15)',
    padding: '0.4rem 0.85rem',
    borderRadius: '50px',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--primary)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.25rem',
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
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
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: '1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  metaRow: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  roleBadge: {
    fontSize: '0.75rem',
    padding: '0.25rem 0.75rem',
  },
  emptyState: {
    padding: '4rem 2rem',
    textAlign: 'center',
    border: '1px dashed var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: 'var(--text-secondary)',
  },
  aside: {
    position: 'sticky',
    top: '2.5rem',
  },
  formCard: {
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  formHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  formTitle: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  formSubtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.45',
  },
};
