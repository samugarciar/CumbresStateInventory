'use client';

import { useState, useTransition } from 'react';
import { registrarInventario } from '@/app/actions/inventarios';
import { 
  Building2, 
  ClipboardList, 
  Key, 
  ShieldCheck, 
  Users, 
  Home, 
  ChevronRight, 
  Plus, 
  Loader2, 
  CheckCircle,
  HelpCircle,
  FileText,
  AlertTriangle
} from 'lucide-react';

interface FormRegisterInventarioProps {
  inmuebles: Array<{ id: string; titulo: string; direccion: string; arrendasoft_id?: number | null; estado?: string }>;
  defaultInmuebleId: string;
}

// Catálogos estándares de ítems por sección para Cumbres Inmobiliaria
const SALA_COMEDOR_ITEMS = ["Apliques", "Cortineros", "Cortinas", "Color Paredes", "Interruptores", "Lamparas", "Muebles En", "Ojos De Buey", "Paredes Balcón", "Paredes", "Pasamanos Balcón", "Persianas", "Pisos En", "Piso Balcón", "Plafón Balcón", "Plafones y/o Rosetas", "Repisas", "Rejilla Piso Balcón", "Seguro Ventanas", "Seguro Vidrieras", "Techos", "Techo Balcón", "Tomas Elect.", "Tomas Tv", "Tomas Tel.", "Ventanas", "Vidrios", "Vidrieras", "Zócalos Balcón", "Zócalos y/o Guarda Escobas"];
const ALCOBA_ITEMS = ["Apliques", "Cajones", "Cerradura (Llaves)", "Cerraduras (Llaves)", "Color Paredes", "Cortinas", "Cortineros", "Entrepaños", "Interruptores", "Lamparas", "Muebles En", "Ojo de Buey", "Paredes", "Persianas", "Pisos En", "Plafones y/o Rosetas", "Puerta", "Puertas de Muebles", "Repisas", "Seguro de Ventanas", "Techos", "Tomas Elec.", "Tomas Tv", "Tomas Tel.", "Ventanas", "Vidrios", "Zocalos y/o Guarda Escobas"];
const BANO_ITEMS = ["Bañera", "Cabina de Baño", "Cepillero", "Cerradura (Llaves)", "Ducha (Pomos)", "Espejo", "Entrepaños", "Gabinete", "Gancho de Pared", "Interruptores", "Jabonera", "Lavamanos (Pomos)", "Lamparas", "Nariz Bañera", "Ojo de Buey", "Paredes", "Papelera", "Plafones y/o Rosetas", "Pisos", "Puerta", "Repisa de", "Rejillas de Piso", "Sanitario", "Tapon Bañera", "Tapón Lavamanos", "Tapa y Aro", "Techos", "Toalleros", "Tomas Eléctricos", "Varilla", "Ventana Baño"];
const COCINA_ITEMS = ["Alacena Superior", "Barra Americana", "Cajones Mueble Inferior", "Color Paredes", "Color Mueble Inferior", "Color Alacena Superior", "Entrepaños Mueble Inferior", "Entrepaños Alacena Superior", "Extractor Marca", "Bombillo Campana/Extractor", "Interruptores", "Lamparas", "Locero", "Mueble Inferior", "Ojo de Buey", "Paredes", "Plafones y/o Rosetas", "Pisos En", "Puerta", "Puertas Mueble Inferior", "Rejillas de Piso", "Rejilla Plástica", "Seguro de Ventanas", "Techo", "Timbre", "Tomas Elec.", "Tomas Tel.", "Trifilar", "Ventanas", "Vidrios", "Zócalos", "Acumulación / Paso", "Bombillo", "Caja Breakers (Breakers)", "Calentador Elect Marca Litro", "Calentador Gas Marca", "Conexión Agua Nevera", "Control Luz Horno", "Colador", "Cubierta", "Cubierta Marca", "Encendido Electrónico", "Horno Marca", "Lavaplatos en", "Llave Control Gas", "Mezclador", "Mueble Alacena Adicional", "Parrillas Eléctricas", "Parrillas Gas", "Perillas", "Perillas Horno", "Piloto", "Pipeta (Libra, Contenido)", "Poyo y/o Meson en", "Pomos Mezclador", "Resistencias", "Rejillas Interiores", "Tapa Caja Breakers", "Triturador"];
const PATIO_ITEMS = ["Apliques", "Color Paredes", "Desagüe", "Interruptores", "Lavadero en (Llaves)", "Lamparas", "Llaves Lavadero", "Llaves Lavadora", "Mesa de Aplanchar", "Mueble Lavadero", "Paredes", "Plafones y/o Rosetas", "Pisos En", "Seguro de Ventanas", "Rejillas de Piso", "Techos", "Tendedero", "Tomas Eléctricos", "Trifilar", "Ventanas", "Vidrios", "Zócalos y/o Guarda Escobas"];
const GARAJE_ITEMS = ["Cerradura (Llaves)", "Color Paredes", "Interruptores", "Lamparas", "Llave de Agua", "Motor", "Muebles", "Paredes", "Plafones y/o Rosetas", "Pisos En", "Puerta", "Techos", "Tomas Eléctricos", "Vidrios", "Zocalos y/o Guarda Escobas"];
const UTIL_ITEMS = ["Cerradura (Llaves)", "Color Paredes", "Entrepaños", "Interruptores", "Paredes", "Plafones y/o Rosetas", "Pisos En", "Puerta", "Techos", "Tomas Eléctricos", "Zócalos y/o Guarda Escobas"];
const PUNTO_FIJO_ITEMS = ["Color Paredes", "Interruptores", "Paredes", "Pasamanos", "Plafones y/o Rosetas", "Pisos En", "Techos"];
const JARDIN_ITEMS = ["Color Paredes", "Interruptores", "Paredes", "Plafones y/o Rosetas", "Pisos En", "Rejas", "Rejilla de Piso", "Tomas Eléctricos"];

export default function FormRegisterInventario({ inmuebles, defaultInmuebleId }: FormRegisterInventarioProps) {
  const [inmuebleId, setInmuebleId] = useState(defaultInmuebleId);
  const [activeTab, setActiveTab] = useState<'datos' | 'comunes' | 'alcobas' | 'cocina' | 'confirmar'>('datos');
  const [isPending, startTransition] = useTransition();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [filterEstado, setFilterEstado] = useState<'disponible' | 'arrendado'>('disponible');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredInmuebles = inmuebles.filter(inm => {
    // Si viene el estado, aplicamos el filtro por los botones de radio
    if (inm.estado && inm.estado !== filterEstado) return false;
    
    // Filtro por texto
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const codeStr = (inm.arrendasoft_id || '').toString();
      const title = (inm.titulo || '').toLowerCase();
      const addr = (inm.direccion || '').toLowerCase();
      
      return title.includes(search) || addr.includes(search) || codeStr.includes(search);
    }
    return true;
  });

  // Estados jerárquicos del inventario
  const [datosGenerales, setDatosGenerales] = useState({
    fecha_inicio_contrato: '',
    fecha_elaboracion: '',
    ficha_no: '',
    inquilino: { nombre: '', telefono: '', celular: '', email: '' },
    propietario: { nombre: '', telefono: '', celular: '' }
  });

  const [controlLlaves, setControlLlaves] = useState({
    interiores: { alcoba_2: '', alcoba_3: '', alcoba_principal: '', alcoba_4: '', alcoba_servicio: '', sencillas: '', seguridad: '', garaje: '', puerta_principal: '' },
    cuarto_util: { sencillas: '', seguridad: '', marca: '', total: '', estado: '' },
    otras_llaves: { exteriores: '', puerta_principal: '', de_seguridad: '', sencillas: '' },
    remoto: { si: false, marca: '', estado: '' }
  });

  const [exteriores, setExteriores] = useState({
    antejardin: { si: false, detalle: '' },
    fachada_detalle: '', fachada_color: '',
    rejas_cantidad: '', rejas_materiales: '', rejas_color: '',
    puerta_principal_material: '', puerta_principal_color: '',
    cerradura_principal: '', cerradura_marca: '',
    timbre: '', timbre_clase: '', ojo_magico: ''
  });

  // Estructura genérica para almacenar el estado de cada sección
  const [secciones, setSecciones] = useState<Record<string, { items: Record<string, { estado: 'B' | 'R' | 'M' | null, obs: string }>, observaciones: string }>>({
    sala: { items: initializeSectionItems(SALA_COMEDOR_ITEMS), observaciones: '' },
    comedor: { items: initializeSectionItems(SALA_COMEDOR_ITEMS), observaciones: '' },
    punto_fijo: { items: initializeSectionItems(PUNTO_FIJO_ITEMS), observaciones: '' },
    patio_jardin: { items: initializeSectionItems(JARDIN_ITEMS), observaciones: '' },
    alcoba_1: { items: initializeSectionItems(ALCOBA_ITEMS), observaciones: '' },
    alcoba_2: { items: initializeSectionItems(ALCOBA_ITEMS), observaciones: '' },
    alcoba_3: { items: initializeSectionItems(ALCOBA_ITEMS), observaciones: '' },
    alcoba_4: { items: initializeSectionItems(ALCOBA_ITEMS), observaciones: '' },
    bano_principal: { items: initializeSectionItems(BANO_ITEMS), observaciones: '' },
    bano_alcoba: { items: initializeSectionItems(BANO_ITEMS), observaciones: '' },
    cocina: { items: initializeSectionItems(COCINA_ITEMS), observaciones: '' },
    patio_ropas: { items: initializeSectionItems(PATIO_ITEMS), observaciones: '' },
    garaje: { items: initializeSectionItems(GARAJE_ITEMS), observaciones: '' },
    cuarto_util: { items: initializeSectionItems(UTIL_ITEMS), observaciones: '' }
  });

  const [observacionesGenerales, setObservacionesGenerales] = useState('');
  const [firmas, setFirmas] = useState({
    arrendador: { nombre: '', cc: '' },
    arrendatario: { nombre: '', cc: '' },
    codeudor: { nombre: '', cc: '' }
  });

  function initializeSectionItems(itemsArray: string[]) {
    const obj: Record<string, any> = {};
    itemsArray.forEach(item => {
      obj[item] = { estado: null, obs: '' };
    });
    return obj;
  }

  // Funciones de conveniencia para marcar rápido
  const marcarTodosComoBueno = (seccionKey: string) => {
    setSecciones(prev => {
      const seccion = prev[seccionKey];
      const nuevosItems = { ...seccion.items };
      Object.keys(nuevosItems).forEach(k => {
        nuevosItems[k] = { ...nuevosItems[k], estado: 'B' };
      });
      return {
        ...prev,
        [seccionKey]: { ...seccion, items: nuevosItems }
      };
    });
  };

  const handleItemStateChange = (seccionKey: string, itemKey: string, estado: 'B' | 'R' | 'M') => {
    setSecciones(prev => {
      const seccion = prev[seccionKey];
      const nuevosItems = {
        ...seccion.items,
        [itemKey]: { ...seccion.items[itemKey], estado }
      };
      return {
        ...prev,
        [seccionKey]: { ...seccion, items: nuevosItems }
      };
    });
  };

  const handleItemObsChange = (seccionKey: string, itemKey: string, obs: string) => {
    setSecciones(prev => {
      const seccion = prev[seccionKey];
      const nuevosItems = {
        ...seccion.items,
        [itemKey]: { ...seccion.items[itemKey], obs }
      };
      return {
        ...prev,
        [seccionKey]: { ...seccion, items: nuevosItems }
      };
    });
  };

  const handleSave = () => {
    if (!inmuebleId) {
      setError('Por favor, selecciona un inmueble.');
      setActiveTab('datos');
      return;
    }

    const payload = {
      datos_generales: datosGenerales,
      control_llaves: controlLlaves,
      exteriores: exteriores,
      secciones: secciones,
      observaciones_generales: observacionesGenerales,
      firmas: firmas
    };

    const targetInmueble = inmuebles.find(i => i.id === inmuebleId);
    const titulo = `Inventario de Entrega - ${targetInmueble?.direccion || targetInmueble?.titulo || 'Inmueble'}`;

    startTransition(async () => {
      const result = await registrarInventario(inmuebleId, titulo, payload);
      if (result.success) {
        setSuccess('¡El inventario se ha guardado exitosamente!');
        setError(null);
        setTimeout(() => {
          window.location.href = '/inventarios';
        }, 1500);
      } else {
        setError(result.error || 'Ocurrió un error inesperado al guardar.');
      }
    });
  };

  const tabSteps = [
    { id: 'datos', label: 'Datos & Llaves', number: 1 },
    { id: 'comunes', label: 'Zonas Comunes', number: 2 },
    { id: 'alcobas', label: 'Alcobas & Baños', number: 3 },
    { id: 'cocina', label: 'Cocina & Ropas', number: 4 },
    { id: 'confirmar', label: 'Firmas & Guardar', number: 5 }
  ] as const;

  const currentTabStep = tabSteps.find(t => t.id === activeTab) || tabSteps[0];
  const progressPercent = (currentTabStep.number / tabSteps.length) * 100;

  return (
    <div style={styles.formLayout}>
      <style>{`
        @media (max-width: 767px) {
          .responsive-row {
            flex-direction: column !important;
            gap: 1rem !important;
          }
          .responsive-row > div {
            flex: 1 1 100% !important;
            width: 100% !important;
          }
          .responsive-grid4 {
            grid-template-columns: 1fr !important;
            gap: 0.85rem !important;
          }
          .table-responsive-wrapper {
            margin-left: -1rem !important;
            margin-right: -1rem !important;
            padding-left: 0.5rem !important;
            padding-right: 0.5rem !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch;
            touch-action: pan-y !important; /* Asegura la propagación vertical en celulares */
            border-radius: 0 !important;
            border-left: none !important;
            border-right: none !important;
          }
          .table-responsive-wrapper table {
            min-width: 600px !important;
          }
          .table-responsive-wrapper th, 
          .table-responsive-wrapper td {
            padding: 0.5rem 0.35rem !important;
            font-size: 0.8rem !important;
          }
          .table-responsive-wrapper input[type="text"] {
            font-size: 0.8rem !important;
            padding: 0.35rem 0.5rem !important;
          }
          .responsive-radio-group {
            gap: 0.6rem !important;
          }
          .section-header-mobile {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 0.75rem !important;
          }
          .section-header-mobile button {
            width: 100% !important;
            text-align: center !important;
          }
        }
      `}</style>

      {/* Selector de Pestañas (Stepper - ESCRITORIO) */}
      <nav className="glass-card desktop-only" style={styles.tabNav}>
        <button 
          onClick={() => setActiveTab('datos')} 
          style={{ ...styles.tabBtn, ...(activeTab === 'datos' ? styles.tabBtnActive : {}) }}
        >
          <span style={styles.tabNumber}>1</span>
          <span>Datos & Llaves</span>
        </button>
        <button 
          onClick={() => setActiveTab('comunes')} 
          style={{ ...styles.tabBtn, ...(activeTab === 'comunes' ? styles.tabBtnActive : {}) }}
        >
          <span style={styles.tabNumber}>2</span>
          <span>Zonas Comunes</span>
        </button>
        <button 
          onClick={() => setActiveTab('alcobas')} 
          style={{ ...styles.tabBtn, ...(activeTab === 'alcobas' ? styles.tabBtnActive : {}) }}
        >
          <span style={styles.tabNumber}>3</span>
          <span>Alcobas & Baños</span>
        </button>
        <button 
          onClick={() => setActiveTab('cocina')} 
          style={{ ...styles.tabBtn, ...(activeTab === 'cocina' ? styles.tabBtnActive : {}) }}
        >
          <span style={styles.tabNumber}>4</span>
          <span>Cocina & Ropas</span>
        </button>
        <button 
          onClick={() => setActiveTab('confirmar')} 
          style={{ ...styles.tabBtn, ...(activeTab === 'confirmar' ? styles.tabBtnActive : {}) }}
        >
          <span style={styles.tabNumber}>5</span>
          <span>Firmas & Guardar</span>
        </button>
      </nav>

      {/* Barra de Progreso adaptativa (Stepper - MÓVIL) */}
      <div className="mobile-only glass-card mobile-progress-container" style={styles.mobileProgressContainer}>
        <div style={styles.mobileProgressHeader}>
          <span style={styles.mobileStepText}>
            Paso {currentTabStep.number} de {tabSteps.length}
          </span>
          <span style={styles.mobileStepLabel}>
            {currentTabStep.label}
          </span>
        </div>
        <div style={styles.mobileProgressBarBg}>
          <div 
            style={{ 
              ...styles.mobileProgressBarFill, 
              width: `${progressPercent}%` 
            }} 
          />
        </div>
        <div style={styles.mobileQuickNav} className="mobile-quick-nav-stepper">
          <button
            type="button"
            disabled={activeTab === 'datos'}
            onClick={handlePrevTab}
            style={{
              ...styles.mobileQuickNavBtn,
              ...(activeTab === 'datos' ? styles.mobileQuickNavBtnDisabled : {})
            }}
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={activeTab === 'confirmar'}
            onClick={handleNextTab}
            style={{
              ...styles.mobileQuickNavBtn,
              ...(activeTab === 'confirmar' ? styles.mobileQuickNavBtnDisabled : {})
            }}
          >
            Siguiente
          </button>
        </div>
      </div>

      {/* Contenedor de Alertas */}
      {error && <div className="badge badge-danger animate-fade-in" style={styles.alert}>{error}</div>}
      {success && <div className="badge badge-success animate-fade-in" style={styles.alert}>{success}</div>}

      {/* =====================================================================
          TAB 1: DATOS & LLAVES
          ===================================================================== */}
      {activeTab === 'datos' && (
        <div style={styles.tabContent} className="animate-fade-in">
          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>1. Selección de Inmueble</h3>
            
            <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'center' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Mostrar:</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input type="radio" name="estado_filter" value="disponible" checked={filterEstado === 'disponible'} onChange={() => setFilterEstado('disponible')} />
                  Disponibles
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input type="radio" name="estado_filter" value="arrendado" checked={filterEstado === 'arrendado'} onChange={() => setFilterEstado('arrendado')} />
                  Arrendados
                </label>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <input 
                type="text" 
                placeholder="Buscar por código Arrendasoft, título o dirección..." 
                className="form-control"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.95rem' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Inmueble Relacionado *</label>
              <select 
                value={inmuebleId} 
                onChange={(e) => setInmuebleId(e.target.value)} 
                className="form-select"
                style={{ width: '100%' }}
              >
                <option value="">Selecciona el inmueble a inspeccionar...</option>
                {filteredInmuebles.map(inm => (
                  <option key={inm.id} value={inm.id}>
                    {inm.arrendasoft_id ? `[${inm.arrendasoft_id}] ` : ''}{inm.titulo} - ({inm.direccion})
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>2. Fechas & Ficha</h3>
            <div style={styles.row} className="responsive-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Ficha No.</label>
                <input 
                  type="text" 
                  value={datosGenerales.ficha_no} 
                  onChange={(e) => setDatosGenerales(prev => ({ ...prev, ficha_no: e.target.value }))}
                  placeholder="00234" 
                  className="form-input" 
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Fecha Inicio Contrato</label>
                <input 
                  type="date" 
                  value={datosGenerales.fecha_inicio_contrato} 
                  onChange={(e) => setDatosGenerales(prev => ({ ...prev, fecha_inicio_contrato: e.target.value }))}
                  className="form-input" 
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Fecha Elaboración Inventario</label>
                <input 
                  type="date" 
                  value={datosGenerales.fecha_elaboracion} 
                  onChange={(e) => setDatosGenerales(prev => ({ ...prev, fecha_elaboracion: e.target.value }))}
                  className="form-input" 
                />
              </div>
            </div>
          </section>

          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>3. Información de las Partes</h3>
            <div style={styles.row} className="responsive-row">
              {/* Inquilino */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h4 style={styles.subSubTitle}>Inquilino (Arrendatario)</h4>
                <div className="form-group">
                  <label className="form-label">Nombre Completo</label>
                  <input 
                    type="text" 
                    value={datosGenerales.inquilino.nombre} 
                    onChange={(e) => setDatosGenerales(prev => ({ ...prev, inquilino: { ...prev.inquilino, nombre: e.target.value } }))}
                    className="form-input" 
                    placeholder="Nombre inquilino"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Celular</label>
                  <input 
                    type="text" 
                    value={datosGenerales.inquilino.celular} 
                    onChange={(e) => setDatosGenerales(prev => ({ ...prev, inquilino: { ...prev.inquilino, celular: e.target.value } }))}
                    className="form-input" 
                    placeholder="Celular"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Correo Electrónico</label>
                  <input 
                    type="email" 
                    value={datosGenerales.inquilino.email} 
                    onChange={(e) => setDatosGenerales(prev => ({ ...prev, inquilino: { ...prev.inquilino, email: e.target.value } }))}
                    className="form-input" 
                    placeholder="correo@ejemplo.com"
                  />
                </div>
              </div>

              {/* Propietario */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h4 style={styles.subSubTitle}>Propietario (Arrendador)</h4>
                <div className="form-group">
                  <label className="form-label">Nombre Completo</label>
                  <input 
                    type="text" 
                    value={datosGenerales.propietario.nombre} 
                    onChange={(e) => setDatosGenerales(prev => ({ ...prev, propietario: { ...prev.propietario, nombre: e.target.value } }))}
                    className="form-input" 
                    placeholder="Nombre propietario"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Celular</label>
                  <input 
                    type="text" 
                    value={datosGenerales.propietario.celular} 
                    onChange={(e) => setDatosGenerales(prev => ({ ...prev, propietario: { ...prev.propietario, celular: e.target.value } }))}
                    className="form-input" 
                    placeholder="Celular"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>4. Control de Llaves (Cantidades)</h3>
            <div style={styles.grid4} className="responsive-grid4">
              <div className="form-group">
                <label className="form-label">Puerta Principal</label>
                <input 
                  type="text" 
                  value={controlLlaves.interiores.puerta_principal} 
                  onChange={(e) => setControlLlaves(prev => ({ ...prev, interiores: { ...prev.interiores, puerta_principal: e.target.value } }))}
                  placeholder="Cant. llaves" 
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Alcoba Principal</label>
                <input 
                  type="text" 
                  value={controlLlaves.interiores.alcoba_principal} 
                  onChange={(e) => setControlLlaves(prev => ({ ...prev, interiores: { ...prev.interiores, alcoba_principal: e.target.value } }))}
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Sencillas</label>
                <input 
                  type="text" 
                  value={controlLlaves.interiores.sencillas} 
                  onChange={(e) => setControlLlaves(prev => ({ ...prev, interiores: { ...prev.interiores, sencillas: e.target.value } }))}
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Seguridad</label>
                <input 
                  type="text" 
                  value={controlLlaves.interiores.seguridad} 
                  onChange={(e) => setControlLlaves(prev => ({ ...prev, interiores: { ...prev.interiores, seguridad: e.target.value } }))}
                  className="form-input" 
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          TAB 2: ZONAS COMUNES (Sala, Comedor, Punto Fijo, Exteriores)
          ===================================================================== */}
      {activeTab === 'comunes' && (
        <div style={styles.tabContent} className="animate-fade-in">
          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>Exteriores (Fachadas)</h3>
            <div style={styles.row} className="responsive-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">¿Antejardín?</label>
                <select 
                  value={exteriores.antejardin.si ? 'si' : 'no'}
                  onChange={(e) => setExteriores(prev => ({ ...prev, antejardin: { ...prev.antejardin, si: e.target.value === 'si' } }))}
                  className="form-select"
                >
                  <option value="no">No</option>
                  <option value="si">Sí</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Detalle Antejardín</label>
                <input 
                  type="text" 
                  value={exteriores.antejardin.detalle} 
                  onChange={(e) => setExteriores(prev => ({ ...prev, antejardin: { ...prev.antejardin, detalle: e.target.value } }))}
                  className="form-input" 
                  placeholder="Detalles"
                />
              </div>
            </div>
            <div style={styles.row} className="responsive-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Rejas Cantidad</label>
                <input 
                  type="text" 
                  value={exteriores.rejas_cantidad} 
                  onChange={(e) => setExteriores(prev => ({ ...prev, rejas_cantidad: e.target.value }))}
                  className="form-input" 
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Material Puerta Principal</label>
                <input 
                  type="text" 
                  value={exteriores.puerta_principal_material} 
                  onChange={(e) => setExteriores(prev => ({ ...prev, puerta_principal_material: e.target.value }))}
                  className="form-input" 
                />
              </div>
            </div>
          </section>

          {/* Renderizar Salas, Comedores y Puntos Fijos */}
          {renderSectionChecklist('sala', 'Inspección de Sala', SALA_COMEDOR_ITEMS)}
          {renderSectionChecklist('comedor', 'Inspección de Comedor', SALA_COMEDOR_ITEMS)}
          {renderSectionChecklist('punto_fijo', 'Escalas y Punto Fijo', PUNTO_FIJO_ITEMS)}
        </div>
      )}

      {/* =====================================================================
          TAB 3: ALCOBAS & BAÑOS
          ===================================================================== */}
      {activeTab === 'alcobas' && (
        <div style={styles.tabContent} className="animate-fade-in">
          {renderSectionChecklist('alcoba_1', 'Alcoba 1', ALCOBA_ITEMS)}
          {renderSectionChecklist('alcoba_2', 'Alcoba 2', ALCOBA_ITEMS)}
          {renderSectionChecklist('alcoba_3', 'Alcoba 3', ALCOBA_ITEMS)}
          {renderSectionChecklist('alcoba_4', 'Alcoba 4', ALCOBA_ITEMS)}
          {renderSectionChecklist('bano_principal', 'Baño Principal - Social', BANO_ITEMS)}
          {renderSectionChecklist('bano_alcoba', 'Baño Alcoba', BANO_ITEMS)}
        </div>
      )}

      {/* =====================================================================
          TAB 4: COCINA & ROPAS
          ===================================================================== */}
      {activeTab === 'cocina' && (
        <div style={styles.tabContent} className="animate-fade-in">
          {renderSectionChecklist('cocina', 'Cocina (Inspección General y Electrodomésticos)', COCINA_ITEMS)}
          {renderSectionChecklist('patio_ropas', 'Patio de Ropas / Lavadero', PATIO_ITEMS)}
          {renderSectionChecklist('garaje', 'Garaje y Parqueadero', GARAJE_ITEMS)}
          {renderSectionChecklist('cuarto_util', 'Cuarto Útil / Depósito', UTIL_ITEMS)}
        </div>
      )}

      {/* =====================================================================
          TAB 5: CONFIRMAR & GUARDAR
          ===================================================================== */}
      {activeTab === 'confirmar' && (
        <div style={styles.tabContent} className="animate-fade-in">
          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>Observaciones Generales</h3>
            <div className="form-group">
              <label className="form-label">Escribe aquí las observaciones o compromisos del acta de entrega</label>
              <textarea 
                value={observacionesGenerales}
                onChange={(e) => setObservacionesGenerales(e.target.value)}
                rows={5}
                className="form-textarea"
                placeholder="Ej. El arrendatario se compromete a cambiar el bombillo de la alcoba 2..."
              />
            </div>
          </section>

          <section className="glass-card form-section-card">
            <h3 style={styles.sectionTitle}>Firmas e Identificaciones</h3>
            <div style={styles.row} className="responsive-row">
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h4 style={styles.subSubTitle}>Por Arrendamientos Cumbres</h4>
                <div className="form-group">
                  <label className="form-label">Nombre del Asesor</label>
                  <input 
                    type="text" 
                    value={firmas.arrendador.nombre} 
                    onChange={(e) => setFirmas(prev => ({ ...prev, arrendador: { ...prev.arrendador, nombre: e.target.value } }))}
                    className="form-input" 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Cédula</label>
                  <input 
                    type="text" 
                    value={firmas.arrendador.cc} 
                    onChange={(e) => setFirmas(prev => ({ ...prev, arrendador: { ...prev.arrendador, cc: e.target.value } }))}
                    className="form-input" 
                  />
                </div>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h4 style={styles.subSubTitle}>Por el Arrendatario</h4>
                <div className="form-group">
                  <label className="form-label">Nombre del Inquilino</label>
                  <input 
                    type="text" 
                    value={firmas.arrendatario.nombre} 
                    onChange={(e) => setFirmas(prev => ({ ...prev, arrendatario: { ...prev.arrendatario, nombre: e.target.value } }))}
                    className="form-input" 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Cédula</label>
                  <input 
                    type="text" 
                    value={firmas.arrendatario.cc} 
                    onChange={(e) => setFirmas(prev => ({ ...prev, arrendatario: { ...prev.arrendatario, cc: e.target.value } }))}
                    className="form-input" 
                  />
                </div>
              </div>
            </div>
          </section>

          <div style={styles.footerActions}>
            <button 
              onClick={handleSave} 
              className="btn btn-primary" 
              style={styles.saveBtn}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 size={20} className="animate-spin" style={{ marginRight: '0.5rem' }} />
                  Guardando Inventario...
                </>
              ) : (
                <>
                  <CheckCircle size={20} style={{ marginRight: '0.5rem' }} />
                  Guardar y Firmar Acta
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Navegación Inferior */}
      <footer style={styles.navFooter}>
        <button 
          onClick={handlePrevTab}
          disabled={activeTab === 'datos'} 
          className="btn btn-secondary"
        >
          Anterior
        </button>

        {activeTab !== 'confirmar' ? (
          <button 
            onClick={handleNextTab}
            className="btn btn-primary"
          >
            Siguiente
            <ChevronRight size={16} />
          </button>
        ) : null}
      </footer>
    </div>
  );

  // Helper para renderizar los items de cada sección de forma hermosa
  function renderSectionChecklist(seccionKey: string, label: string, itemsList: string[]) {
    const seccionData = secciones[seccionKey];

    return (
      <section className="glass-card form-section-card" key={seccionKey}>
        <div style={styles.sectionHeaderRow} className="section-header-mobile">
          <h3 style={styles.sectionTitleNested}>{label}</h3>
          <button 
            type="button" 
            onClick={() => marcarTodosComoBueno(seccionKey)}
            style={styles.quickSelectBtn}
          >
            <span className="desktop-only">Marcar todo "Bueno (B)"</span>
            <span className="mobile-only">Marcar todo como Bueno (B)</span>
          </button>
        </div>

        <div style={styles.tableWrapper} className="table-responsive-wrapper">
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeaderRow}>
                <th style={{ ...styles.th, width: '35%' }}>Elemento / Artículo</th>
                <th style={{ ...styles.th, width: '35%', textAlign: 'center' }}>Calificación (B - R - M)</th>
                <th style={{ ...styles.th, width: '30%' }}>Observaciones Detalladas</th>
              </tr>
            </thead>
            <tbody>
              {itemsList.map(item => {
                const itemData = seccionData.items[item] || { estado: null, obs: '' };
                return (
                  <tr key={item} style={styles.tr}>
                    <td style={styles.tdItemName}>{item}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <div style={styles.radioGroup} className="responsive-radio-group">
                        <label style={{ ...styles.radioLabel, color: '#10b981' }}>
                          <input 
                            type="radio" 
                            name={`${seccionKey}-${item}`} 
                            checked={itemData.estado === 'B'}
                            onChange={() => handleItemStateChange(seccionKey, item, 'B')}
                            style={styles.radioInput}
                          />
                          B
                        </label>
                        <label style={{ ...styles.radioLabel, color: 'var(--warning)' }}>
                          <input 
                            type="radio" 
                            name={`${seccionKey}-${item}`} 
                            checked={itemData.estado === 'R'}
                            onChange={() => handleItemStateChange(seccionKey, item, 'R')}
                            style={styles.radioInput}
                          />
                          R
                        </label>
                        <label style={{ ...styles.radioLabel, color: 'var(--danger)' }}>
                          <input 
                            type="radio" 
                            name={`${seccionKey}-${item}`} 
                            checked={itemData.estado === 'M'}
                            onChange={() => handleItemStateChange(seccionKey, item, 'M')}
                            style={styles.radioInput}
                          />
                          M
                        </label>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <input 
                        type="text" 
                        value={itemData.obs}
                        onChange={(e) => handleItemObsChange(seccionKey, item, e.target.value)}
                        placeholder="Ej. Raspones leves"
                        className="form-input"
                        style={styles.itemObsInput}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function handleNextTab() {
    if (activeTab === 'datos') setActiveTab('comunes');
    else if (activeTab === 'comunes') setActiveTab('alcobas');
    else if (activeTab === 'alcobas') setActiveTab('cocina');
    else if (activeTab === 'cocina') setActiveTab('confirmar');
  }

  function handlePrevTab() {
    if (activeTab === 'confirmar') setActiveTab('cocina');
    else if (activeTab === 'cocina') setActiveTab('alcobas');
    else if (activeTab === 'alcobas') setActiveTab('comunes');
    else if (activeTab === 'comunes') setActiveTab('datos');
  }
}

const styles: Record<string, React.CSSProperties> = {
  formLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
    maxWidth: '960px',
    margin: '0 auto',
    width: '100%',
  },
  tabNav: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.75rem',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  tabBtn: {
    flex: 1,
    minWidth: '130px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.6rem 0.85rem',
    borderRadius: 'var(--border-radius-sm)',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    border: '1px solid rgba(0, 171, 216, 0.2)',
    color: 'var(--primary)',
  },
  tabNumber: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-surface-elevated)',
    fontSize: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
  },
  alert: {
    padding: '1rem',
    fontSize: '0.9rem',
    borderRadius: 'var(--border-radius-sm)',
    textAlign: 'center',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.75rem',
  },
  sectionCard: {
    padding: '2rem',
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    marginBottom: '1.5rem',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '0.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitleNested: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
    padding: 0,
    border: 'none',
  },
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '0.5rem',
  },
  quickSelectBtn: {
    padding: '0.35rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    borderRadius: '6px',
    backgroundColor: 'rgba(0, 171, 216, 0.08)',
    color: 'var(--primary)',
    border: '1px solid rgba(0, 171, 216, 0.2)',
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    gap: '1.5rem',
    flexWrap: 'wrap',
  },
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '1rem',
  },
  subSubTitle: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--primary)',
    marginBottom: '0.5rem',
  },
  tableWrapper: {
    overflowX: 'auto',
    marginTop: '0.5rem',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeaderRow: {
    borderBottom: '1px solid var(--border-color)',
  },
  th: {
    padding: '0.75rem 0.5rem',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontWeight: '700',
    textAlign: 'left',
    textTransform: 'uppercase',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '0.65rem 0.5rem',
  },
  tdItemName: {
    padding: '0.65rem 0.5rem',
    fontSize: '0.9rem',
    fontWeight: '500',
    color: 'var(--text-primary)',
  },
  radioGroup: {
    display: 'inline-flex',
    gap: '1.25rem',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    fontWeight: '700',
    cursor: 'pointer',
  },
  radioInput: {
    cursor: 'pointer',
    transform: 'scale(1.3)',
    marginRight: '4px',
  },
  itemObsInput: {
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    width: '100%',
  },
  navFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '1rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '1.5rem',
  },
  footerActions: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '1.5rem',
  },
  saveBtn: {
    width: '100%',
    maxWidth: '380px',
    padding: '0.9rem',
  },
  mobileProgressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    padding: '1rem',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0, 171, 216, 0.08)',
    marginBottom: '0.5rem',
    position: 'sticky',
    top: '60px',
    zIndex: 70,
  },
  mobileProgressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileStepText: {
    fontSize: '0.78rem',
    fontWeight: '700',
    color: 'var(--primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  mobileStepLabel: {
    fontSize: '0.88rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  mobileProgressBarBg: {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--bg-surface-elevated)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  mobileProgressBarFill: {
    height: '100%',
    backgroundColor: 'var(--primary)',
    borderRadius: '10px',
    transition: 'width var(--transition-normal)',
  },
  mobileQuickNav: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '0.4rem',
  },
  mobileQuickNavBtn: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    padding: '0.5rem',
    fontSize: '0.8rem',
    fontWeight: '700',
    borderRadius: '8px',
    backgroundColor: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  mobileQuickNavBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  }
};
