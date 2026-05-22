'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signupInmobiliaria } from '@/app/actions/auth';
import { Home, Mail, Lock, User, ShieldCheck, ArrowRight, Loader2, FileText } from 'lucide-react';

export default function RegisterInmobiliariaPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await signupInmobiliaria(null, formData);
      if (result.success && result.redirect) {
        router.push(result.redirect);
        router.refresh();
      } else {
        setError(result.error || 'Ocurrió un error inesperado.');
      }
    });
  };

  return (
    <div style={styles.container}>
      <div style={{ ...styles.glowOrb, ...styles.orb1 }} />
      <div style={{ ...styles.glowOrb, ...styles.orb2 }} />

      <div className="glass-container animate-fade-in" style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <Home size={32} color="var(--primary)" />
            <span style={styles.logoText}>Cumbres</span>
          </div>
          <h1 style={styles.title}>Registrar Inmobiliaria</h1>
          <p style={styles.subtitle}>Crea una cuenta para tu inmobiliaria y su administrador principal</p>
        </div>

        {error && (
          <div className="badge badge-danger" style={styles.errorBadge}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <h3 style={styles.sectionDivider}>Datos de la Inmobiliaria</h3>
          
          <div className="form-group">
            <label className="form-label" htmlFor="nombreInmobiliaria">
              Nombre de la Inmobiliaria
            </label>
            <div style={styles.inputWrapper}>
              <Home size={18} style={styles.inputIcon} />
              <input
                id="nombreInmobiliaria"
                name="nombreInmobiliaria"
                type="text"
                required
                placeholder="Inmobiliaria Cumbres S.A.S."
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="nit">
              NIT (Identificación Tributaria)
            </label>
            <div style={styles.inputWrapper}>
              <FileText size={18} style={styles.inputIcon} />
              <input
                id="nit"
                name="nit"
                type="text"
                required
                placeholder="900.123.456-7"
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <h3 style={styles.sectionDivider}>Administrador Principal</h3>

          <div className="form-group">
            <label className="form-label" htmlFor="nombreCompleto">
              Nombre Completo
            </label>
            <div style={styles.inputWrapper}>
              <User size={18} style={styles.inputIcon} />
              <input
                id="nombreCompleto"
                name="nombreCompleto"
                type="text"
                required
                placeholder="Carlos Mario Restrepo"
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Correo Electrónico
            </label>
            <div style={styles.inputWrapper}>
              <Mail size={18} style={styles.inputIcon} />
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="carlos.restrepo@cumbres.com"
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Contraseña de Acceso
            </label>
            <div style={styles.inputWrapper}>
              <Lock size={18} style={styles.inputIcon} />
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="Min. 6 caracteres"
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={styles.submitBtn}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 size={18} className="animate-spin" style={styles.spinner} />
                Creando Inmobiliaria...
              </>
            ) : (
              <>
                Crear Inmobiliaria
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={styles.footer}>
          <span style={styles.footerText}>¿Ya tienes una cuenta registrada?</span>
          <Link href="/login" style={styles.loginLink}>
            Iniciar Sesión
          </Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2.5rem 1.5rem',
    position: 'relative',
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(100px)',
    opacity: 0.15,
    zIndex: -1,
  },
  orb1: {
    width: '350px',
    height: '350px',
    background: 'var(--primary)',
    top: '5%',
    right: '10%',
  },
  orb2: {
    width: '400px',
    height: '400px',
    background: 'var(--secondary)',
    bottom: '5%',
    left: '10%',
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    padding: '2.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.75rem',
  },
  header: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  },
  logoText: {
    fontSize: '1.75rem',
    fontWeight: '800',
    letterSpacing: '-0.03em',
    background: 'linear-gradient(135deg, #ffffff 40%, var(--primary) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
  },
  errorBadge: {
    padding: '0.75rem 1rem',
    fontSize: '0.85rem',
    borderRadius: 'var(--border-radius-sm)',
    display: 'block',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  sectionDivider: {
    fontSize: '0.9rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--primary)',
    marginTop: '0.75rem',
    marginBottom: '0.5rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    paddingBottom: '0.25rem',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: '1rem',
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  inputWithIcon: {
    paddingLeft: '2.75rem',
    width: '100%',
  },
  submitBtn: {
    marginTop: '1.5rem',
    width: '100%',
    padding: '0.85rem',
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    marginRight: '0.5rem',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.85rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '1.5rem',
  },
  footerText: {
    color: 'var(--text-muted)',
  },
  loginLink: {
    color: 'var(--primary)',
    fontWeight: '600',
    transition: 'color var(--transition-fast)',
  },
};
