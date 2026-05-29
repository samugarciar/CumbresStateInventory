'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { 
  Home, 
  Building2, 
  ClipboardList, 
  Users, 
  LogOut, 
  User as UserIcon,
  Shield,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Menu,
  X
} from 'lucide-react';

interface DashboardLayoutClientProps {
  profile: any;
  inmobiliaria: any;
  isAdmin: boolean;
  pendingTasksCount?: number;
  children: React.ReactNode;
}

export default function DashboardLayoutClient({
  profile,
  inmobiliaria,
  isAdmin,
  pendingTasksCount = 0,
  children
}: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // Cargar estado de colapsado y manejar cambios responsivos
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        // En celulares no nos importa el estado colapsado
      } else if (window.innerWidth < 1024) {
        // En tablet (768px - 1023px) forzamos que esté compacto/colapsado
        setIsCollapsed(true);
      } else {
        // En escritorio restauramos del localStorage
        const savedState = localStorage.getItem('sidebar_collapsed');
        setIsCollapsed(savedState === 'true');
      }
    };

    handleResize(); // Ejecutar chequeo inicial
    setMounted(true);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Guardar estado de colapsado en localStorage
  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const nextState = !prev;
      localStorage.setItem('sidebar_collapsed', String(nextState));
      return nextState;
    });
  };

  // Ancho activo del sidebar para pantallas no móviles
  const activeSidebarWidth = isCollapsed && mounted ? '72px' : '280px';

  return (
    <div style={{ ...styles.layoutContainer, ['--sidebar-width' as any]: activeSidebarWidth }}>
      {/* Overlay para móviles */}
      <div 
        className={`sidebar-overlay ${isMobileOpen ? 'active' : ''}`}
        onClick={() => setIsMobileOpen(false)}
      />

      {/* Top Header Móvil */}
      <header className="mobile-top-header mobile-only">
        <button 
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          style={styles.mobileMenuBtn}
          aria-label={isMobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div style={styles.mobileLogoContainer}>
          <img src="/logo.png" alt="Cumbres Inmobiliaria" style={{ height: '36px', width: 'auto' }} />
        </div>
        <div style={styles.mobileRightSection}>
          {inmobiliaria && (
            <span className="mobile-inmobiliaria-badge" style={styles.mobileInmobiliariaBadge}>
              {inmobiliaria.nombre}
            </span>
          )}
        </div>
      </header>

      {/* Sidebar Lateral */}
      <aside 
        className={`sidebar-responsive ${isMobileOpen ? 'open' : ''}`}
        style={{ ...styles.sidebar, width: activeSidebarWidth }}
      >
        {/* Botón flotante para contraer/desplegar */}
        {mounted && (
          <button 
            onClick={toggleSidebar} 
            className="sidebar-toggle-btn"
            style={styles.toggleBtn}
            title={isCollapsed ? 'Desplegar menú' : 'Contraer menú'}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}

        <div style={{ ...styles.sidebarHeader, padding: isCollapsed && mounted ? '2rem 0.5rem' : '2rem 1.5rem' }}>
          <div style={{ ...styles.logoContainer, justifyContent: isCollapsed && mounted ? 'center' : 'flex-start' }}>
            <img src="/logo.png" alt="Cumbres Inmobiliaria" style={{ height: '56px', width: 'auto', maxWidth: '100%' }} />
          </div>
          {inmobiliaria && (!isCollapsed || !mounted) && (
            <div style={styles.inmobiliariaBadge}>
              {inmobiliaria.nombre}
            </div>
          )}
        </div>

        <nav style={{ ...styles.nav, padding: isCollapsed && mounted ? '1.5rem 0.5rem' : '1.5rem 1rem' }}>
          <Link 
            href="/dashboard" 
            onClick={() => setIsMobileOpen(false)}
            style={{ 
              ...styles.navLink, 
              justifyContent: isCollapsed && mounted ? 'center' : 'flex-start',
              backgroundColor: pathname === '/dashboard' ? 'rgba(0, 171, 216, 0.05)' : 'transparent',
              color: pathname === '/dashboard' ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: pathname === '/dashboard' ? '700' : '500'
            }}
            title={isCollapsed ? 'Inicio' : undefined}
          >
            <Home size={20} />
            {(!isCollapsed || !mounted) && <span>Inicio</span>}
          </Link>
          
          <Link 
            href="/inmuebles" 
            onClick={() => setIsMobileOpen(false)}
            style={{ 
              ...styles.navLink, 
              justifyContent: isCollapsed && mounted ? 'center' : 'flex-start',
              backgroundColor: pathname.startsWith('/inmuebles') ? 'rgba(0, 171, 216, 0.05)' : 'transparent',
              color: pathname.startsWith('/inmuebles') ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: pathname.startsWith('/inmuebles') ? '700' : '500'
            }}
            title={isCollapsed ? 'Inmuebles' : undefined}
          >
            <Building2 size={20} />
            {(!isCollapsed || !mounted) && <span>Inmuebles</span>}
          </Link>
          
          <Link 
            href="/inventarios" 
            onClick={() => setIsMobileOpen(false)}
            style={{ 
              ...styles.navLink, 
              justifyContent: isCollapsed && mounted ? 'center' : 'flex-start',
              backgroundColor: pathname.startsWith('/inventarios') ? 'rgba(0, 171, 216, 0.05)' : 'transparent',
              color: pathname.startsWith('/inventarios') ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: pathname.startsWith('/inventarios') ? '700' : '500'
            }}
            title={isCollapsed ? 'Inventarios' : undefined}
          >
            <ClipboardList size={20} />
            {(!isCollapsed || !mounted) && <span>Inventarios</span>}
          </Link>

          {isAdmin && (
            <>
              <Link 
                href="/tareas" 
                onClick={() => setIsMobileOpen(false)}
                style={{ 
                  ...styles.navLink, 
                  justifyContent: isCollapsed && mounted ? 'center' : 'flex-start',
                  backgroundColor: pathname.startsWith('/tareas') ? 'rgba(0, 171, 216, 0.05)' : 'transparent',
                  color: pathname.startsWith('/tareas') ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: pathname.startsWith('/tareas') ? '700' : '500',
                  position: 'relative'
                }}
                title={isCollapsed ? 'Tareas' : undefined}
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <ClipboardList size={20} />
                  {isCollapsed && mounted && pendingTasksCount > 0 ? (
                    <span style={styles.collapsedBadge} />
                  ) : null}
                </div>
                {(!isCollapsed || !mounted) && (
                  <span style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                    <span>Tareas</span>
                    {pendingTasksCount > 0 ? (
                      <span className="badge badge-danger" style={styles.expandedBadge}>
                        {pendingTasksCount}
                      </span>
                    ) : null}
                  </span>
                )}
              </Link>

              <Link 
                href="/asesores" 
                onClick={() => setIsMobileOpen(false)}
                style={{ 
                  ...styles.navLink, 
                  justifyContent: isCollapsed && mounted ? 'center' : 'flex-start',
                  backgroundColor: pathname.startsWith('/asesores') ? 'rgba(0, 171, 216, 0.05)' : 'transparent',
                  color: pathname.startsWith('/asesores') ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: pathname.startsWith('/asesores') ? '700' : '500'
                }}
                title={isCollapsed ? 'Asesores' : undefined}
              >
                <Users size={20} />
                {(!isCollapsed || !mounted) && <span>Asesores</span>}
              </Link>
            </>
          )}
        </nav>

        {/* Perfil del Usuario en la Parte Inferior */}
        <div style={{ ...styles.sidebarFooter, padding: isCollapsed && mounted ? '1.5rem 0.5rem' : '1.5rem 1rem' }}>
          <div style={{ ...styles.profileSection, justifyContent: isCollapsed && mounted ? 'center' : 'flex-start' }}>
            <div style={styles.avatar}>
              <UserIcon size={18} color="var(--text-secondary)" />
            </div>
            {(!isCollapsed || !mounted) && (
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
            )}
          </div>

          <form action={logout}>
            <button 
              type="submit" 
              style={{ 
                ...styles.logoutBtn, 
                justifyContent: isCollapsed && mounted ? 'center' : 'center',
                padding: isCollapsed && mounted ? '0.65rem 0' : '0.65rem'
              }}
              title={isCollapsed ? 'Cerrar Sesión' : undefined}
            >
              <LogOut size={16} />
              {(!isCollapsed || !mounted) && <span>Cerrar Sesión</span>}
            </button>
          </form>
        </div>
      </aside>

      {/* Área de Contenido Principal */}
      <main className="main-responsive" style={styles.mainContent}>
        <div style={styles.containerInner}>
          {children}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layoutContainer: {
    display: 'block', /* Remueve el contexto flexbox innecesario */
    minHeight: '100dvh',
    backgroundColor: 'var(--bg-main)',
  },
  sidebar: {
    backgroundColor: 'var(--bg-surface)',
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  toggleBtn: {
    position: 'absolute',
    right: '-12px',
    top: '24px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    zIndex: 110,
    transition: 'all var(--transition-fast)',
    padding: 0,
  },
  sidebarHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderBottom: '1px solid var(--border-color)',
    transition: 'padding 0.25s ease',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
  },
  logoText: {
    fontSize: '1.4rem',
    fontWeight: '800',
    background: 'linear-gradient(135deg, var(--text-primary) 40%, var(--primary) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.02em',
  },
  inmobiliariaBadge: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(0, 171, 216, 0.03)',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    padding: '0.35rem 0.65rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
    transition: 'padding 0.25s ease',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--border-radius-sm)',
    fontSize: '0.95rem',
    transition: 'all var(--transition-fast)',
  },
  sidebarFooter: {
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    transition: 'padding 0.25s ease',
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
    flexShrink: 0,
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
    color: 'var(--text-primary)',
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
    minHeight: '100dvh',
    backgroundColor: 'var(--bg-main)',
    minWidth: 0, /* Previene desbordamiento heredado de WebKit en Safari */
    transition: 'margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  containerInner: {
    padding: '2.5rem',
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%',
  },
  collapsedBadge: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--danger)',
    border: '1px solid #ffffff',
  },
  expandedBadge: {
    marginLeft: 'auto',
    borderRadius: '10px',
    padding: '0.1rem 0.45rem',
    fontSize: '0.7rem',
    fontWeight: '700',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
  mobileMenuBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.25rem',
  },
  mobileLogoContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileRightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  mobileInmobiliariaBadge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'var(--primary)',
    backgroundColor: 'rgba(0, 171, 216, 0.05)',
    border: '1px solid rgba(0, 171, 216, 0.1)',
    borderRadius: '4px',
    padding: '0.25rem 0.5rem',
    maxWidth: '120px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
