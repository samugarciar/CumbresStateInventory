'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, Search, Loader2 } from 'lucide-react';

interface Asesor {
  id: string;
  nombre_completo: string;
}

interface FiltersPanelProps {
  asesores: Asesor[];
  isAdmin: boolean;
}

export default function FiltersPanel({ asesores, isAdmin }: FiltersPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state for the text input to ensure fluid typing
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');

  // Apply filters instantly
  const updateFilters = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    
    // Al filtrar, casi siempre es mejor regresar a la página 1
    params.delete('page');

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  // Debounced search for q
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      const currentQ = searchParams.get('q') || '';
      if (searchTerm !== currentQ) {
        updateFilters('q', searchTerm);
      }
    }, 450);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, searchParams]);

  // Sync state if URL changes externally (e.g. from Clear Filters)
  useEffect(() => {
    setSearchTerm(searchParams.get('q') || '');
  }, [searchParams]);

  const hasActiveFilters = 
    searchParams.has('q') || 
    searchParams.has('tipo') || 
    searchParams.has('transaccion') || 
    searchParams.has('estado') || 
    searchParams.has('order') || 
    searchParams.has('asesor');

  const handleClearFilters = () => {
    setSearchTerm('');
    startTransition(() => {
      router.push('/inmuebles');
    });
  };

  return (
    <section className="glass-card" style={{ ...styles.filtersCard, opacity: isPending ? 0.75 : 1 }}>
      <div style={styles.filtersTitleRow}>
        <SlidersHorizontal size={16} color="var(--primary)" />
        <span style={styles.filtersTitle}>Filtros de Búsqueda</span>
        {isPending && (
          <div style={styles.loaderWrapper}>
            <Loader2 size={16} className="animate-spin" color="var(--primary)" />
            <span style={styles.loadingText}>Actualizando...</span>
          </div>
        )}
      </div>

      <div className="filters-form-responsive">
        {/* Buscador */}
        <div className="filter-group-responsive" style={{ flex: '1.5 1 240px' }}>
          <label style={styles.filterLabel}>Buscador</label>
          <div style={styles.searchWrapper}>
            <Search size={14} color="var(--text-muted)" style={styles.searchIcon} />
            <input 
              type="text" 
              className="form-input" 
              placeholder="Buscar por título, dirección, ID..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.filterInput}
            />
          </div>
        </div>

        {/* Tipo de Inmueble */}
        <div className="filter-group-responsive">
          <label style={styles.filterLabel}>Tipo de Inmueble</label>
          <select 
            className="form-select" 
            value={searchParams.get('tipo') || ''} 
            onChange={(e) => updateFilters('tipo', e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">Todos</option>
            <option value="casa">Casa</option>
            <option value="apartamento">Apartamento</option>
            <option value="lote">Lote</option>
            <option value="local">Local Comercial</option>
            <option value="bodega">Bodega</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        {/* Transacción */}
        <div className="filter-group-responsive">
          <label style={styles.filterLabel}>Transacción</label>
          <select 
            className="form-select" 
            value={searchParams.get('transaccion') || ''} 
            onChange={(e) => updateFilters('transaccion', e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">Todas</option>
            <option value="arriendo">Arriendo</option>
            <option value="venta">Venta</option>
          </select>
        </div>

        {/* Estado */}
        <div className="filter-group-responsive">
          <label style={styles.filterLabel}>Estado</label>
          <select 
            className="form-select" 
            value={searchParams.get('estado') || ''} 
            onChange={(e) => updateFilters('estado', e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">Todos (activos)</option>
            <option value="disponible">Disponible (incluye desocupación)</option>
            <option value="desocupacion">En desocupación (ofertados)</option>
            <option value="arrendado">Arrendado</option>
            <option value="empalme">En empalme</option>
          </select>
        </div>

        {/* Asesor (Admin only) */}
        {isAdmin && (
          <div className="filter-group-responsive">
            <label style={styles.filterLabel}>Asesor</label>
            <select 
              className="form-select" 
              value={searchParams.get('asesor') || ''} 
              onChange={(e) => updateFilters('asesor', e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">Todos</option>
              {asesores.map(a => (
                <option key={a.id} value={a.id}>{a.nombre_completo}</option>
              ))}
            </select>
          </div>
        )}

        {/* Orden por Código */}
        <div className="filter-group-responsive">
          <label style={styles.filterLabel}>Orden por Código</label>
          <select 
            className="form-select" 
            value={searchParams.get('order') || 'desc'} 
            onChange={(e) => updateFilters('order', e.target.value)}
            style={styles.filterSelect}
          >
            <option value="desc">Código: Mayor a Menor</option>
            <option value="asc">Código: Menor a Mayor</option>
          </select>
        </div>

        {/* Botón de Limpiar */}
        {hasActiveFilters && (
          <div className="filters-buttons-responsive">
            <button 
              onClick={handleClearFilters} 
              className="btn btn-secondary" 
              style={styles.clearBtn}
              disabled={isPending}
            >
              Limpiar Filtros
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  filtersCard: {
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    transition: 'opacity 0.25s ease',
  },
  filtersTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    height: '24px',
  },
  filtersTitle: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  loaderWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    marginLeft: 'auto',
  },
  loadingText: {
    fontSize: '0.75rem',
    color: 'var(--primary)',
    fontWeight: '600',
  },
  filtersForm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1.25rem',
    alignItems: 'flex-end',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    flex: 1,
    minWidth: '180px',
  },
  filterLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  searchWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
  },
  searchIcon: {
    position: 'absolute',
    left: '0.75rem',
    pointerEvents: 'none',
  },
  filterInput: {
    width: '100%',
    padding: '0.5rem 0.75rem 0.5rem 2.2rem',
    fontSize: '0.85rem',
  },
  filterSelect: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem',
    width: '100%',
  },
  filterButtons: {
    display: 'flex',
    gap: '0.5rem',
    alignSelf: 'flex-end',
    height: '38px',
  },
  clearBtn: {
    padding: '0.55rem 1.25rem',
    fontSize: '0.85rem',
    height: '100%',
    whiteSpace: 'nowrap',
  },
};
