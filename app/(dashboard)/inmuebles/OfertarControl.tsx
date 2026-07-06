'use client';

import { useTransition } from 'react';
import { ofertarInmueble } from '@/app/actions/inmuebles';
import { Loader2, Megaphone, X } from 'lucide-react';

interface OfertarControlProps {
  inmuebleId: string;
  estadoErp: string | null;
  estadoOverride: string | null;
}

/**
 * Control para ofertar un inmueble desocupado que en el ERP sigue como 'arrendado'.
 * Setea un override LOCAL de estado (no toca el ERP y el sync lo respeta).
 * Solo aparece cuando aplica: inmueble arrendado en el ERP, o ya ofertado por override.
 */
export default function OfertarControl({ inmuebleId, estadoErp, estadoOverride }: OfertarControlProps) {
  const [isPending, startTransition] = useTransition();

  const ofertado = estadoOverride === 'disponible';
  const arrendadoEnErp = estadoErp === 'arrendado';

  if (!ofertado && !arrendadoEnErp) return null;

  const cambiar = (ofertar: boolean) => {
    startTransition(async () => {
      const result = await ofertarInmueble(inmuebleId, ofertar);
      if (!result.success) alert(result.error || 'No se pudo actualizar.');
    });
  };

  if (ofertado) {
    return (
      <div style={styles.badgeWrap}>
        <span
          style={styles.badge}
          title="Ofertado localmente aunque el ERP lo mantiene como arrendado (temas de contrato pendientes)"
        >
          <Megaphone size={12} />
          En desocupación
        </span>
        <button
          type="button"
          onClick={() => cambiar(false)}
          disabled={isPending}
          style={styles.clearBtn}
          title="Dejar de ofertar (vuelve al estado del ERP)"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => cambiar(true)}
      disabled={isPending}
      style={styles.ofertarBtn}
      title="Ofertar como disponible aunque el ERP lo tenga arrendado (no toca el ERP)"
    >
      {isPending ? <Loader2 size={13} className="animate-spin" /> : <Megaphone size={13} />}
      Ofertar (desocupado)
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
