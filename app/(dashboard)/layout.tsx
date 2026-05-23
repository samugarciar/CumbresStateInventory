import { getCurrentUser } from '@/lib/auth-helpers';
import { logout } from '@/app/actions/auth';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { 
  Home, 
  Building2, 
  ClipboardList, 
  Users, 
  LogOut, 
  User as UserIcon,
  Shield,
  Briefcase
} from 'lucide-react';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user || !user.profile) {
    // Si el usuario tiene sesión de Auth pero no tiene perfil en la tabla de usuarios (estado inconsistente o RLS fallando),
    // cerramos la sesión de forma activa para evitar bucles infinitos de redirección con el middleware.
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Error al cerrar sesión en redirección defensiva:', e);
    }
    redirect('/login');
  }

  const { profile, inmobiliaria } = user;
  const isAdmin = profile.rol === 'admin';

  return (
    <div style={styles.layoutContainer}>
      {/* Sidebar Lateral */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.logoContainer}>
            <Building2 size={26} color="var(--primary)" />
            <span style={styles.logoText}>Cumbres</span>
          </div>
          {inmobiliaria && (
            <div style={styles.inmobiliariaBadge}>
              {inmobiliaria.nombre}
            </div>
          )}
        </div>

        <nav style={styles.nav}>
          <Link href="/dashboard" style={styles.navLink}>
            <Home size={20} />
            <span>Inicio</span>
          </Link>
          
          <Link href="/inmuebles" style={styles.navLink}>
            <Building2 size={20} />
            <span>Inmuebles</span>
          </Link>
          
          <Link href="/inventarios" style={styles.navLink}>
            <ClipboardList size={20} />
            <span>Inventarios</span>
          </Link>

          {isAdmin && (
            <Link href="/asesores" style={styles.navLink}>
              <Users size={20} />
              <span>Asesores</span>
            </Link>
          )}
        </nav>

        {/* Perfil del Usuario en la Parte Inferior */}
        <div style={styles.sidebarFooter}>
          <div style={styles.profileSection}>
            <div style={styles.avatar}>
              <UserIcon size={18} color="#ffffff" />
            </div>
            <div style={styles.profileInfo}>
              <div style={styles.profileName} title={profile.nombre_completo}>
                {profile.nombre_completo}
              </div>
              <div style={styles.profileRoleContainer}>
                {isAdmin ? (
                  <span className="badge badge-success" style={styles.roleBadge}>
                    <Shield size={10} style={{ marginRight: 2 }} />
                    Admin
                  </span>
                ) : (
                  <span className="badge badge-info" style={styles.roleBadge}>
                    <Briefcase size={10} style={{ marginRight: 2 }} />
                    Asesor
                  </span>
                )}
              </div>
            </div>
          </div>

          <form action={logout}>
            <button type="submit" style={styles.logoutBtn}>
              <LogOut size={16} />
              <span>Cerrar Sesión</span>
            </button>
          </form>
        </div>
      </aside>

      {/* Área de Contenido Principal */}
      <main style={styles.mainContent}>
        <div style={styles.containerInner}>
          {children}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layoutContainer: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: 'var(--bg-main)',
  },
  sidebar: {
    width: '280px',
    backgroundColor: 'var(--bg-surface)',
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
  },
  sidebarHeader: {
    padding: '2rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderBottom: '1px solid var(--border-color)',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logoText: {
    fontSize: '1.4rem',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #ffffff 40%, var(--primary) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.02em',
  },
  inmobiliariaBadge: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    padding: '0.35rem 0.65rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nav: {
    padding: '1.5rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--border-radius-sm)',
    color: 'var(--text-secondary)',
    fontWeight: '500',
    fontSize: '0.95rem',
    transition: 'all var(--transition-fast)',
  },
  sidebarFooter: {
    padding: '1.5rem 1rem',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  profileSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    minWidth: 0,
  },
  profileName: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#ffffff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  profileRoleContainer: {
    display: 'flex',
  },
  roleBadge: {
    padding: '0.1rem 0.5rem',
    fontSize: '0.65rem',
  },
  logoutBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.65rem',
    borderRadius: 'var(--border-radius-sm)',
    backgroundColor: 'transparent',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: 'var(--danger)',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  mainContent: {
    flex: 1,
    marginLeft: '280px',
    minHeight: '100vh',
    backgroundColor: 'var(--bg-main)',
  },
  containerInner: {
    padding: '2.5rem',
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%',
  },
};
