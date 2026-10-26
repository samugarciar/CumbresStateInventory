'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, Search, Loader2 } from 'lucide-react';

interface Asesor {
  id: string;
  nombre_completo: string;
  activo?: boolean;
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
  // Móvil: los selects van plegados detrás de «Filtros (n)»
  const [abiertoMovil, setAbiertoMovil] = useState(false);

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

  // Cuántos filtros (fuera del buscador) están puestos, para el botón del celular
  const filtrosActivos =
    ['tipo', 'transaccion', 'estado', 'asesor'].filter(k => searchParams.has(k)).length +
    (searchParams.get('order') === 'asc' ? 1 : 0);

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
        <span style={styles.filtersTitle}>Buscar y filtrar</span>
        {isPending && (
          <div style={styles.loaderWrapper}>
            <Loader2 size={16} className="animate-spin" color="var(--primary)" />
            <span style={styles.loadingText}>Actualizando...</span>
          </div>
        )}
      </div>

      <div className="filters-form-responsive">
        {/* Buscador (su flex vive en .filter-group-buscador para que el celular lo anule;
            en línea dejaba un hueco en blanco de 240 px al apilar los filtros) */}
        <div className="filter-group-responsive filter-group-buscador">
          <label style={styles.filterLabel} htmlFor="inmuebles-buscar">Buscar</label>
          <div style={styles.buscadorFila}>
            <div style={styles.searchWrapper}>
              <Search size={14} color="var(--text-muted)" style={styles.searchIcon} />
              <input 
                id="inmuebles-buscar"
                type="text" 
                className="form-input" 
                placeholder="Título, dirección o código..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={styles.filterInput}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary filtros-toggle"
              style={styles.toggleBtn}
              aria-expanded={abiertoMovil}
              aria-controls="inmuebles-filtros-extra"
              onClick={() => setAbiertoMovil(v => !v)}
            >
              <SlidersHorizontal size={15} />
              Filtros{filtrosActivos > 0 ? ` (${filtrosActivos})` : ''}
            </button>
          </div>
        </div>

        {/* En escritorio estos grupos se ven siempre (display: contents); en el
            celular se despliegan con «Filtros (n)» */}
        <div id="inmuebles-filtros-extra" className={`filtros-extra${abiertoMovil ? ' abierto' : ''}`}>

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
                <option key={a.id} value={a.id}>
                  {a.nombre_completo}{a.activo === false ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Orden (por código: el más alto es el más nuevo) */}
        <div className="filter-group-responsive">
          <label style={styles.filterLabel}>Orden</label>
          <select 
            className="form-select" 
            value={searchParams.get('order') || 'desc'} 
            onChange={(e) => updateFilters('order', e.target.value)}
            style={styles.filterSelect}
          >
            <option value="desc">Más nuevos primero</option>
            <option value="asc">Más antiguos primero</option>
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
              Limpiar filtros
            </button>
          </div>
        )}
        </div>
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
  buscadorFila: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'stretch',
  },
  searchWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    flex: 1,
    minWidth: 0,
  },
  toggleBtn: {
    padding: '0.5rem 0.85rem',
    fontSize: '0.85rem',
    gap: '0.35rem',
    whiteSpace: 'nowrap',
    flexShrink: 0,
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
