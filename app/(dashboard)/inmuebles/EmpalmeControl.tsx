'use client';

import { useState, useTransition } from 'react';
import { marcarEmpalme } from '@/app/actions/inmuebles';
import { Loader2, Handshake, X, Phone } from 'lucide-react';

interface EmpalmeControlProps {
  inmuebleId: string;
  estadoErp: string | null;
  estadoOverride: string | null;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
}

/**
 * Control para marcar un inmueble ocupado como "empalme": lo muestra el inquilino
 * de salida directamente. Guarda su contacto (teléfono obligatorio; lo carga el
 * admin, no viene del ERP). Override local 'empalme' que el sync no pisa. Es
 * EXCLUYENTE con "Ofertar" (comparten el campo estado_override).
 */
export default function EmpalmeControl({
  inmuebleId,
  estadoErp,
  estadoOverride,
  contactoNombre,
  contactoTelefono,
}: EmpalmeControlProps) {
  const [isPending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');

  const esEmpalme = estadoOverride === 'empalme';
  const ofertado = estadoOverride === 'disponible';
  const arrendadoEnErp = estadoErp === 'arrendado';

  // Excluyente con "Ofertar" y solo aplica a ocupados/empalmes.
  if (ofertado) return null;
  if (!esEmpalme && !arrendadoEnErp) return null;

  const activar = () => {
    startTransition(async () => {
      const result = await marcarEmpalme(inmuebleId, true, { nombre, telefono });
      if (!result.success) { alert(result.error || 'No se pudo marcar el empalme.'); return; }
      setAbierto(false); setNombre(''); setTelefono('');
    });
  };

  const quitar = () => {
    startTransition(async () => {
      const result = await marcarEmpalme(inmuebleId, false);
      if (!result.success) alert(result.error || 'No se pudo quitar el empalme.');
    });
  };

  if (esEmpalme) {
    return (
      <div style={styles.badgeWrap}>
        <span style={styles.badge} title="Ocupado, pero el inquilino de salida lo muestra directamente (empalme)">
          <Handshake size={12} />
          En empalme
        </span>
        {contactoTelefono && (
          <span style={styles.contacto} title="Contacto del inquilino que muestra">
            <Phone size={11} />
            {contactoNombre ? `${contactoNombre} · ` : ''}{contactoTelefono}
          </span>
        )}
        <button
          type="button"
          onClick={quitar}
          disabled={isPending}
          style={styles.clearBtn}
          title="Quitar empalme (vuelve al estado del ERP)"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />}
        </button>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={isPending}
        style={styles.empalmeBtn}
        title="Ocupado, pero el inquilino lo muestra: guarda su contacto para coordinar"
      >
        <Handshake size={13} />
        Marcar empalme
      </button>
    );
  }

  return (
    <div style={styles.form}>
      <input
        type="text"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre del inquilino (opcional)"
        style={styles.input}
        disabled={isPending}
      />
      <input
        type="tel"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        placeholder="Teléfono del inquilino *"
        style={styles.input}
        disabled={isPending}
      />
      <button
        type="button"
        onClick={activar}
        disabled={isPending || !telefono.trim()}
        style={styles.confirmBtn}
      >
        {isPending ? <Loader2 size={12} className="animate-spin" /> : <Handshake size={12} />}
        Confirmar
      </button>
      <button
        type="button"
        onClick={() => { setAbierto(false); setNombre(''); setTelefono(''); }}
        disabled={isPending}
        style={styles.cancelBtn}
      >
        Cancelar
      </button>
    </div>
  );
}

const EMPALME = '#4f46e5';

const styles: Record<string, React.CSSProperties> = {
  badgeWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    flexWrap: 'wrap',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    color: EMPALME,
    backgroundColor: 'rgba(79, 70, 229, 0.1)',
    border: '1px solid rgba(79, 70, 229, 0.3)',
    borderRadius: '6px',
    padding: '0.25rem 0.5rem',
  },
  contacto: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.72rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  clearBtn: {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    width: '22px',
    height: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    color: 'var(--text-muted)',
  },
  empalmeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    fontWeight: '600',
    color: EMPALME,
    backgroundColor: 'transparent',
    border: '1px dashed rgba(79, 70, 229, 0.5)',
    borderRadius: '6px',
    padding: '0.25rem 0.55rem',
    cursor: 'pointer',
  },
  form: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    flexWrap: 'wrap',
  },
  input: {
    fontSize: '0.75rem',
    padding: '0.3rem 0.5rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    minWidth: '150px',
  },
  confirmBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: EMPALME,
    border: 'none',
    borderRadius: '6px',
    padding: '0.3rem 0.6rem',
    cursor: 'pointer',
  },
  cancelBtn: {
    fontSize: '0.72rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    padding: '0.3rem 0.6rem',
    cursor: 'pointer',
  },
};
