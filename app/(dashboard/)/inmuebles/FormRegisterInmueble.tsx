'use client';

import { useState, useTransition } from 'react';
import { registrarInmueble } from '@/app/actions/inmuebles';
import { 
  Building2, 
  MapPin, 
  Tag, 
  FileText, 
  UserCheck, 
  Loader2, 
  Plus,
  HelpCircle 
} from 'lucide-react';

interface FormRegisterInmuebleProps {
  isAdmin: boolean;
  asesores: Array<{ id: string; nombre_completo: string }>;
}

export default function FormRegisterInmueble({ isAdmin, asesores }: FormRegisterInmuebleProps) {
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
      const result = await registrarInmueble(null, formData);
      if (result.success) {
        setSuccess(result.message || 'Inmueble registrado con éxito.');
        form.reset();
        // Opcional: recargar después de un delay
        setTimeout(() => {
          window.location.href = '/inmuebles';
        }, 1500);
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

      <h3 style={styles.sectionTitle}>Información Básica</h3>

      <div className="form-group">
        <label className="form-label" htmlFor="titulo">
          Título de la Propiedad *
        </label>
        <div style={styles.inputWrapper}>
          <Building2 size={18} style={styles.inputIcon} />
          <input
            id="titulo"
            name="titulo"
            type="text"
            required
            placeholder="Apartamento de lujo con balcón en el Poblado"
            className="form-input"
            style={styles.inputWithIcon}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="descripcion">
          Descripción Detallada
        </label>
        <div style={styles.inputWrapper}>
          <FileText size={18} style={{ ...styles.inputIcon, top: '1rem' }} />
          <textarea
            id="descripcion"
            name="descripcion"
            placeholder="Especificaciones, comodidades, cercanías..."
            className="form-textarea"
            style={styles.textareaWithIcon}
            rows={4}
            disabled={isPending}
          />
        </div>
      </div>

      <div style={styles.formRow}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="tipoInmueble">
            Tipo de Inmueble *
          </label>
          <select
            id="tipoInmueble"
            name="tipoInmueble"
            required
            className="form-select"
            disabled={isPending}
          >
            <option value="apartamento">Apartamento</option>
            <option value="casa">Casa</option>
            <option value="lote">Lote</option>
            <option value="local">Local Comercial</option>
            <option value="bodega">Bodega</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="tipoTransaccion">
            Tipo de Transacción *
          </label>
          <select
            id="tipoTransaccion"
            name="tipoTransaccion"
            required
            className="form-select"
            disabled={isPending}
          >
            <option value="arriendo">Arriendo</option>
            <option value="venta">Venta</option>
          </select>
        </div>
      </div>

      <h3 style={styles.sectionTitle}>Ubicación & Precio</h3>

      <div className="form-group">
        <label className="form-label" htmlFor="direccion">
          Dirección del Inmueble *
        </label>
        <div style={styles.inputWrapper}>
          <MapPin size={18} style={styles.inputIcon} />
          <input
            id="direccion"
            name="direccion"
            type="text"
            required
            placeholder="Calle 50 # 71 - 50, Estadio, Medellín"
            className="form-input"
            style={styles.inputWithIcon}
            disabled={isPending}
          />
        </div>
      </div>

      <div style={styles.formRow}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="precio">
            Precio ($ COP) *
          </label>
          <div style={styles.inputWrapper}>
            <Tag size={18} style={styles.inputIcon} />
            <input
              id="precio"
              name="precio"
              type="number"
              required
              min={0}
              placeholder="3200000"
              className="form-input"
              style={styles.inputWithIcon}
              disabled={isPending}
            />
          </div>
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="estado">
            Estado de Disponibilidad
          </label>
          <select
            id="estado"
            name="estado"
            className="form-select"
            defaultValue="disponible"
            disabled={isPending}
          >
            <option value="disponible">Disponible</option>
            <option value="reservado">Reservado</option>
            <option value="vendido">Vendido</option>
            <option value="arrendado">Arrendado</option>
          </select>
        </div>
      </div>

      {isAdmin && (
        <>
          <h3 style={styles.sectionTitle}>Asignación de Asesor</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="asesorId">
              Asesor Asignado
            </label>
            <div style={styles.inputWrapper}>
              <UserCheck size={18} style={styles.inputIcon} />
              <select
                id="asesorId"
                name="asesorId"
                className="form-select"
                style={styles.inputWithIcon}
                disabled={isPending}
              >
                <option value="">(Sin asignar - Disponible para todos)</option>
                {asesores.map((ase) => (
                  <option key={ase.id} value={ase.id}>
                    {ase.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            <span style={styles.formHint}>
              Los asesores comunes solo podrán ver y gestionar los inventarios del inmueble si están asignados a él.
            </span>
          </div>
        </>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        style={styles.submitBtn}
        disabled={isPending}
      >
        {isPending ? (
          <>
            <Loader2 size={18} className="animate-spin" style={styles.spinner} />
            Registrando Propiedad...
          </>
        ) : (
          <>
            <Plus size={18} />
            Registrar Propiedad
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
  },
  alert: {
    padding: '0.75rem 1rem',
    fontSize: '0.85rem',
    borderRadius: 'var(--border-radius-sm)',
    display: 'block',
    textAlign: 'center',
    marginBottom: '1.25rem',
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--primary)',
    marginTop: '1.25rem',
    marginBottom: '0.75rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    paddingBottom: '0.25rem',
  },
  formRow: {
    display: 'flex',
    gap: '1.5rem',
    flexWrap: 'wrap',
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
  textareaWithIcon: {
    paddingLeft: '2.75rem',
    width: '100%',
    resize: 'vertical',
  },
  formHint: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '0.15rem',
  },
  submitBtn: {
    marginTop: '2rem',
    width: '100%',
    padding: '0.85rem',
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    marginRight: '0.5rem',
  },
};
