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
  X,
  CalendarDays,
  CalendarCheck,
  BrainCircuit,
  Bot,
  Handshake,
  MessageCircle,
  Eye,
  ListTodo,
  MessagesSquare,
  ExternalLink,
  type LucideIcon
} from 'lucide-react';

// --- Menú ---
// Cada enlace dice quién lo ve; los grupos solo se rotulan si les queda algo.
// (Mismos destinos y mismas restricciones por rol que antes de agruparlos.)
type Rol = 'admin' | 'asesor';
interface EnlaceMenu {
  href: string;
  label: string;
  icono: LucideIcon;
  roles: Rol[];
  activo: (pathname: string) => boolean;
  externo?: boolean;
  conteo?: 'tareas';
}

const empiezaCon = (prefijo: string) => (pathname: string) => pathname.startsWith(prefijo);

// Conversaciones del CRM: otra app. Sin la variable (p. ej. en local) no se muestra.
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL;

const GRUPOS_MENU: { titulo: string; enlaces: EnlaceMenu[] }[] = [
  {
    titulo: 'Día a día',
    enlaces: [
      { href: '/dashboard', label: 'Inicio', icono: Home, roles: ['admin', 'asesor'], activo: (p) => p === '/dashboard' },
      { href: '/citas', label: 'Citas', icono: CalendarCheck, roles: ['admin', 'asesor'], activo: empiezaCon('/citas') },
      { href: '/agenda', label: 'Agenda', icono: CalendarDays, roles: ['admin', 'asesor'], activo: empiezaCon('/agenda') },
      { href: '/tareas', label: 'Tareas', icono: ListTodo, roles: ['admin'], activo: empiezaCon('/tareas'), conteo: 'tareas' },
      ...(CRM_URL
        ? [{ href: CRM_URL, label: 'Conversaciones (CRM)', icono: MessagesSquare, roles: ['admin', 'asesor'] as Rol[], activo: () => false, externo: true }]
        : []),
      { href: '/inmuebles', label: 'Inmuebles', icono: Building2, roles: ['admin', 'asesor'], activo: empiezaCon('/inmuebles') },
      { href: '/inventarios', label: 'Inventarios', icono: ClipboardList, roles: ['admin', 'asesor'], activo: empiezaCon('/inventarios') },
      { href: '/captaciones', label: 'Captaciones', icono: Handshake, roles: ['admin'], activo: empiezaCon('/captaciones') },
    ],
  },
  {
    titulo: 'Configuración',
    enlaces: [
      { href: '/asesores', label: 'Asesores', icono: Users, roles: ['admin'], activo: empiezaCon('/asesores') },
      { href: '/whatsapp', label: 'WhatsApp', icono: MessageCircle, roles: ['admin'], activo: empiezaCon('/whatsapp') },
      { href: '/agentes', label: 'Agentes', icono: Bot, roles: ['admin'], activo: empiezaCon('/agentes') },
      { href: '/inteligencia', label: 'Arriendabot', icono: BrainCircuit, roles: ['admin'], activo: empiezaCon('/inteligencia') },
    ],
  },
];

interface DashboardLayoutClientProps {
  profile: { nombre_completo: string };
  inmobiliaria: { nombre: string } | null;
  isAdmin: boolean;
  isRevisor?: boolean;
  pendingTasksCount?: number;
  children: React.ReactNode;
}

export default function DashboardLayoutClient({
  profile,
  inmobiliaria,
  isAdmin,
  isRevisor = false,
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
  const compacto = isCollapsed && mounted;

  const enlaceMenu = (e: EnlaceMenu) => {
    const activo = e.activo(pathname);
    const Icono = e.icono;
    const conteo = e.conteo === 'tareas' ? pendingTasksCount : 0;
    return (
      <Link
        key={e.href}
        href={e.href}
        onClick={() => setIsMobileOpen(false)}
        {...(e.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-current={activo ? 'page' : undefined}
        className="menu-enlace"
        style={{
          ...styles.navLink,
          justifyContent: compacto ? 'center' : 'flex-start',
          backgroundColor: activo ? 'rgba(0, 171, 216, 0.07)' : undefined,
          color: activo ? 'var(--primary)' : 'var(--text-secondary)',
          fontWeight: activo ? 700 : 500,
        }}
        title={compacto ? e.label : undefined}
      >
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Icono size={20} />
          {compacto && conteo > 0 ? <span style={styles.collapsedBadge} /> : null}
        </span>
        {!compacto && (
          <span style={styles.navLinkTexto}>
            <span>{e.label}</span>
            {e.externo && <ExternalLink size={13} aria-label="(se abre en otra pestaña)" style={{ flexShrink: 0, opacity: 0.7 }} />}
            {conteo > 0 ? (
              <span className="badge badge-danger" style={styles.expandedBadge}>
                {conteo}
              </span>
            ) : null}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div style={{ ...styles.layoutContainer, '--sidebar-width': activeSidebarWidth } as React.CSSProperties}>
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
        {/* Hueco del mismo ancho que el botón del menú, para que el logo quede centrado */}
        <div style={styles.mobileRightSection} aria-hidden="true" />
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

        <nav
          aria-label="Menú principal"
          style={{ ...styles.nav, padding: compacto ? '1.25rem 0.5rem' : '1.25rem 1rem' }}
        >
          {/* La cuenta del revisor de Meta solo ve WhatsApp */}
          {isRevisor ? (
            enlaceMenu({ href: '/whatsapp', label: 'WhatsApp', icono: MessageCircle, roles: [], activo: empiezaCon('/whatsapp') })
          ) : (
            GRUPOS_MENU.map(grupo => {
              const visibles = grupo.enlaces.filter(e => e.roles.includes(isAdmin ? 'admin' : 'asesor'));
              if (visibles.length === 0) return null;
              return (
                <div key={grupo.titulo} style={styles.navGrupo}>
                  {compacto
                    ? <div style={styles.navSeparador} aria-hidden="true" />
                    : <div style={styles.navGrupoTitulo}>{grupo.titulo}</div>}
                  {visibles.map(e => enlaceMenu(e))}
                </div>
              );
            })
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
                  ) : isRevisor ? (
                    <span className="badge badge-info" style={styles.roleBadge}>
                      <Eye size={10} style={{ marginRight: 2 }} />
                      Revisor
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
              className="menu-cerrar-sesion"
              style={{ 
                ...styles.logoutBtn, 
                justifyContent: compacto ? 'center' : 'flex-start',
                padding: compacto ? '0.5rem 0' : '0.5rem 0.5rem'
              }}
              title={compacto ? 'Cerrar sesión' : undefined}
            >
              <LogOut size={16} />
              {!compacto && <span>Cerrar sesión</span>}
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
    gap: '1.1rem',
    flex: 1,
    overflowY: 'auto',
    transition: 'padding 0.25s ease',
  },
  navGrupo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  },
  navGrupoTitulo: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '0 1rem 0.35rem',
  },
  navSeparador: {
    height: '1px',
    backgroundColor: 'var(--border-color)',
    margin: '0 0.5rem 0.4rem',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.6rem 1rem',
    borderRadius: 'var(--border-radius-sm)',
    fontSize: '0.93rem',
    transition: 'all var(--transition-fast)',
  },
  navLinkTexto: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    flex: 1,
    minWidth: 0,
  },
  sidebarFooter: {
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
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
  // Texto gris: salir no es una acción de todos los días.
  logoutBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: 'var(--border-radius-sm)',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    fontWeight: 500,
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
    flexShrink: 0,
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
    width: '32px',
  },
};
