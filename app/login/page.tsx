'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/app/actions/auth';
import { Home, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await login(null, formData);
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
      {/* Círculos de luz flotantes para estética premium */}
      <div style={{ ...styles.glowOrb, ...styles.orb1 }} />
      <div style={{ ...styles.glowOrb, ...styles.orb2 }} />

      <div className="glass-container animate-fade-in" style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <Home size={32} color="var(--primary)" />
            <span style={styles.logoText}>Cumbres</span>
          </div>
          <h1 style={styles.title}>Iniciar Sesión</h1>
          <p style={styles.subtitle}>Ingresa tus credenciales para acceder a la plataforma</p>
        </div>

        {error && (
          <div className="badge badge-danger" style={styles.errorBadge}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
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
                placeholder="ejemplo@cumbres.com"
                className="form-input"
                style={styles.inputWithIcon}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Contraseña
            </label>
            <div style={styles.inputWrapper}>
              <Lock size={18} style={styles.inputIcon} />
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="••••••••"
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
                Ingresando...
              </>
            ) : (
              <>
                Ingresar
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={styles.footer}>
          <span style={styles.footerText}>¿Tu inmobiliaria no está registrada?</span>
          <Link href="/registro-inmobiliaria" style={styles.registerLink}>
            Registrar Inmobiliaria
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
    padding: '1.5rem',
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
    top: '10%',
    left: '15%',
  },
  orb2: {
    width: '400px',
    height: '400px',
    background: 'var(--secondary)',
    bottom: '10%',
    right: '15%',
  },
  card: {
    width: '100%',
    maxWidth: '460px',
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
    marginTop: '1rem',
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
  registerLink: {
    color: 'var(--primary)',
    fontWeight: '600',
    transition: 'color var(--transition-fast)',
  },
};
