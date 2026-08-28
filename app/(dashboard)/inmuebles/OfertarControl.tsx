'use client';

import { useState, useTransition } from 'react';
import { ofertarInmueble } from '@/app/actions/inmuebles';
import { Loader2, Megaphone, X, Check, Pencil } from 'lucide-react';

interface OfertarControlProps {
  inmuebleId: string;
  estadoErp: string | null;
  estadoOverride: string | null;
  /** Precio del ERP: el del contrato viejo. Sirve de punto de partida. */
  precio: number | null;
  /** Canon con el que se está ofreciendo hoy. null = todavía no se fijó. */
  precioOferta: number | null;
}

const pesos = (n: number) => '$' + n.toLocaleString('es-CO');
const soloDigitos = (s: string) => s.replace(/\D/g, '').slice(0, 12);
const agrupar = (d: string) => (d ? Number(d).toLocaleString('es-CO') : '');

/**
 * Control para ofertar un inmueble desocupado que en el ERP sigue como 'arrendado'.
 * Setea un override LOCAL de estado (no toca el ERP y el sync lo respeta).
 * Solo aparece cuando aplica: inmueble arrendado en el ERP, o ya ofertado por override.
 *
 * Pide SIEMPRE el canon de oferta. Al desocuparse, el inmueble se vuelve a
 * ofrecer con el precio ajustado por IPC, mientras el ERP conserva el del
 * contrato viejo: sin este dato el agente comercial cotiza el precio de hace
 * un año. El valor arranca precargado con el del ERP para que subirlo sea
 * escribir la diferencia, no teclear todo de cero.
 */
export default function OfertarControl({
  inmuebleId,
  estadoErp,
  estadoOverride,
  precio,
  precioOferta,
}: OfertarControlProps) {
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ofertado = estadoOverride === 'disponible';
  const arrendadoEnErp = estadoErp === 'arrendado';

  // Excluyente con "Empalme": si el override ya es empalme, este control no aplica.
  if (estadoOverride === 'empalme') return null;
  if (!ofertado && !arrendadoEnErp) return null;

  const abrir = () => {
    setValor(String(precioOferta ?? precio ?? ''));
    setError(null);
    setEditando(true);
  };

  const confirmar = () => {
    const n = Number(valor);
    if (!n) {
      setError('Escribe el canon con el que se va a ofrecer.');
      return;
    }
    startTransition(async () => {
      const r = await ofertarInmueble(inmuebleId, true, n);
      if (!r.success) setError(r.error || 'No se pudo actualizar.');
      else {
        setEditando(false);
        setError(null);
      }
    });
  };

  const quitar = () => {
    startTransition(async () => {
      const r = await ofertarInmueble(inmuebleId, false);
      if (!r.success) setError(r.error || 'No se pudo actualizar.');
    });
  };

  if (editando) {
    return (
      <div style={styles.formWrap}>
        <label style={styles.hint}>
          ¿Con qué canon se ofrece?
          {precio ? <span style={styles.erp}> ERP: {pesos(precio)}</span> : null}
        </label>
        <div style={styles.formFila}>
          <span style={styles.signo}>$</span>
          <input
            autoFocus
            inputMode="numeric"
            value={agrupar(valor)}
            onChange={e => setValor(soloDigitos(e.target.value))}
            onKeyDown={e => {
              if (e.key === 'Enter') confirmar();
              if (e.key === 'Escape') setEditando(false);
            }}
            style={styles.input}
            disabled={isPending}
          />
          <button type="button" onClick={confirmar} disabled={isPending} style={styles.okBtn} title="Guardar y ofertar">
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditando(false);
              setError(null);
            }}
            disabled={isPending}
            style={styles.clearBtn}
            title="Cancelar"
          >
            <X size={13} />
          </button>
        </div>
        {error && <span style={styles.error}>{error}</span>}
      </div>
    );
  }

  if (ofertado) {
    return (
      <div style={styles.formWrap}>
        <div style={styles.badgeWrap}>
          <span
            style={styles.badge}
            title="Ofertado localmente aunque el ERP lo mantiene como arrendado (temas de contrato pendientes)"
          >
            <Megaphone size={12} />
            En desocupación
            {precioOferta ? ` · ${pesos(precioOferta)}` : ''}
          </span>
          <button type="button" onClick={abrir} disabled={isPending} style={styles.clearBtn} title="Cambiar el canon de oferta">
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={quitar}
            disabled={isPending}
            style={styles.clearBtn}
            title="Dejar de ofertar (vuelve al estado y al precio del ERP)"
          >
            {isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />}
          </button>
        </div>
        {!precioOferta && (
          <span style={styles.aviso}>Sin canon de oferta: el agente está cotizando el precio del ERP.</span>
        )}
        {error && <span style={styles.error}>{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={isPending}
      style={styles.ofertarBtn}
      title="Ofertar como disponible aunque el ERP lo tenga arrendado (no toca el ERP)"
    >
      <Megaphone size={13} />
      Ofertar (desocupado)
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  formWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    alignItems: 'flex-start',
  },
  hint: {
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
  },
  erp: {
    fontWeight: 500,
    opacity: 0.8,
  },
  formFila: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  signo: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
  },
  input: {
    width: 110,
    fontSize: '0.8rem',
    fontWeight: 700,
    padding: '0.25rem 0.4rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-input, transparent)',
    color: 'inherit',
  },
  okBtn: {
    background: 'rgba(245, 158, 11, 0.15)',
    border: '1px solid rgba(245, 158, 11, 0.45)',
    color: '#b45309',
    borderRadius: '6px',
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  error: {
    fontSize: '0.72rem',
    fontWeight: 600,
    color: '#dc2626',
    maxWidth: 240,
  },
  aviso: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#b45309',
  },
  badgeWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    fontWeight: '700',
    color: '#b45309',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: '6px',
    padding: '0.25rem 0.5rem',
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
  ofertarBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    fontWeight: '600',
    color: '#b45309',
    backgroundColor: 'transparent',
    border: '1px dashed rgba(245, 158, 11, 0.5)',
    borderRadius: '6px',
    padding: '0.25rem 0.55rem',
    cursor: 'pointer',
  },
};
