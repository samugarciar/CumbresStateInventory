'use client';

import { useState, useTransition } from 'react';
import { registrarAsesor } from '@/app/actions/admin';
import { User, Mail, Lock, Plus, Loader2, Phone } from 'lucide-react';

export default function FormRegisterAsesor() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await registrarAsesor(null, formData);
      if (result.success) {
        setSuccess(result.message || 'Asesor comercial registrado con éxito.');
        form.reset();
      } else {
        setError(result.error || 'Ocurrió un error inesperado.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {error && (
        <div className="badge badge-danger" style={styles.alert}>
          {error}
        </div>
      )}

      {success && (
        <div className="badge badge-success" style={styles.alert}>
          {success}
        </div>
      )}

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
            placeholder="Juan David Restrepo"
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
            placeholder="juan.restrepo@cumbres.com"
            className="form-input"
            style={styles.inputWithIcon}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="telefono">
          Teléfono <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span>
        </label>
        <div style={styles.inputWrapper}>
          <Phone size={18} style={styles.inputIcon} />
          <input
            id="telefono"
            name="telefono"
            type="tel"
            placeholder="3001234567"
            className="form-input"
            style={styles.inputWithIcon}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="password">
          Contraseña Inicial
        </label>
        <div style={styles.inputWrapper}>
          <Lock size={18} style={styles.inputIcon} />
          <input
            id="password"
            name="password"
            type="password"
            required
            placeholder="Mínimo 6 caracteres"
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
            Registrando...
          </>
        ) : (
          <>
            <Plus size={18} />
            Agregar al Equipo
          </>
        )}
      </button>
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    marginTop: '0.5rem',
  },
  alert: {
    padding: '0.75rem 1rem',
    fontSize: '0.85rem',
    borderRadius: 'var(--border-radius-sm)',
    display: 'block',
    textAlign: 'center',
    marginBottom: '1rem',
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
};
