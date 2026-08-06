'use client';

import React, { useState, useRef, useTransition } from 'react';
import { enviarCaptacionWebhook } from '@/app/actions/webhook-n8n';
import { createClient } from '@/lib/supabase/client';
import { BARRIOS_POR_MUNICIPIO } from '@/lib/captacion/barrios';
import { 
  Building2, 
  MapPin, 
  Tag, 
  User, 
  FileText, 
  UploadCloud, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  Info,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';

interface FormCaptarInmuebleProps {
  isAdmin: boolean;
  unidades: string[];
}

type TabType = 'general' | 'caracteristicas' | 'comodidades' | 'propietario' | 'fotos';

export default function FormCaptarInmueble({ isAdmin, unidades }: FormCaptarInmuebleProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  // Municipio y Barrio son controlados: Barrio es un desplegable dependiente de Municipio.
  const [municipio, setMunicipio] = useState('');
  const [barrioId, setBarrioId] = useState('');
  // Unidad cerrada: toggle sí/no + selector de unidades existentes (con "agregar nueva").
  const [enUnidad, setEnUnidad] = useState(false);
  const [unidadSel, setUnidadSel] = useState('');
  const [unidadNueva, setUnidadNueva] = useState('');
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Límites de tamaño
  const MAX_FILE_SIZE_MB = 5;
  const MAX_TOTAL_SIZE_MB = 25;

  // Manejar drag & drop
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setFileError(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles: File[]) => {
    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const filteredFiles: File[] = [];

    for (const file of newFiles) {
      if (!validImageTypes.includes(file.type)) {
        setFileError(`El archivo "${file.name}" no es una imagen válida (JPG, PNG, WEBP).`);
        return;
      }
      
      const fileSizeBytes = file.size;
      if (fileSizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setFileError(`La foto "${file.name}" supera el límite de ${MAX_FILE_SIZE_MB}MB.`);
        return;
      }

      filteredFiles.push(file);
    }

    setFiles(prev => {
      const merged = [...prev, ...filteredFiles];
      const totalSize = merged.reduce((acc, f) => acc + f.size, 0);
      
      if (totalSize > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
        setFileError(`El peso total de las imágenes (${(totalSize / (1024 * 1024)).toFixed(2)}MB) supera el límite de ${MAX_TOTAL_SIZE_MB}MB.`);
        return prev;
      }

      return merged;
    });
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setFileError(null);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const totalSizeCurrent = files.reduce((acc, f) => acc + f.size, 0);

  // Envío del Formulario
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus(null);
    setFileError(null);

    if (files.length === 0) {
      setFileError('Debes cargar al menos una foto de la propiedad.');
      setActiveTab('fotos');
      return;
    }

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        // 1. Subir las fotos DIRECTO a Supabase Storage (navegador → Supabase,
        // sin pasar por la función serverless de Vercel y su tope de ~4.5 MB).
        const supabase = createClient();
        const urls: string[] = [];
        let totalBytes = 0;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setUploadMsg(`Subiendo foto ${i + 1} de ${files.length}...`);
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('captaciones')
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) {
            throw new Error(`No se pudo subir la foto "${file.name}": ${upErr.message}`);
          }
          const { data: pub } = supabase.storage.from('captaciones').getPublicUrl(path);
          urls.push(pub.publicUrl);
          totalBytes += file.size;
        }

        // 2. Enviar SOLO las URLs (sin binarios) al server action → n8n.
        formData.append('Fotos_URLs', JSON.stringify(urls));
        formData.append('Fotos_size_bytes', String(totalBytes));
        setUploadMsg('Enviando captación...');

        const result = await enviarCaptacionWebhook(null, formData);

        if (result.success) {
          setStatus({ success: true, message: result.message });
          setFiles([]);
          formRef.current?.reset();
          setMunicipio('');
          setBarrioId('');
          setEnUnidad(false);
          setUnidadSel('');
          setUnidadNueva('');
          setActiveTab('general');
        } else {
          setStatus({ success: false, message: result.message });
        }
      } catch (err: any) {
        setStatus({ success: false, message: err?.message || 'Ocurrió un error inesperado al conectar con el servidor.' });
      } finally {
        setUploadMsg(null);
      }
    });
  };

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: '1. General', icon: <Building2 size={16} /> },
    { id: 'caracteristicas', label: '2. Características', icon: <FileText size={16} /> },
    { id: 'comodidades', label: '3. Comodidades', icon: <Tag size={16} /> },
    { id: 'propietario', label: '4. Propietario', icon: <User size={16} /> },
    { id: 'fotos', label: '5. Fotos', icon: <UploadCloud size={16} /> }
  ];

  const currentStepIndex = tabs.findIndex(t => t.id === activeTab);
  const currentStepNumber = currentStepIndex + 1;
  const progressPercent = (currentStepNumber / tabs.length) * 100;
  const currentStepLabel = tabs[currentStepIndex].label.replace(/^\d+\.\s*/, '');

  // Barrios del municipio seleccionado + nombre del barrio elegido (se envía como `Barrio`).
  const barriosDelMunicipio = BARRIOS_POR_MUNICIPIO[municipio] || [];
  const barrioNombre = barriosDelMunicipio.find((b) => String(b.id) === barrioId)?.barrio || '';

  // `Unidad` = nombre del edificio (n/a si no aplica); `Unidad Cerrada` = sí/no del toggle.
  const unidadValue = !enUnidad ? 'n/a' : (unidadSel === '__otra__' ? unidadNueva.trim() : unidadSel);
  const unidadCerradaValue = enUnidad ? 'Si' : 'No';

  return (
    <div style={styles.formContainer}>
      <style>{`
        .toggle-switch {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          cursor: pointer;
          margin-top: 0.35rem;
        }
        .toggle-switch input {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-track {
          width: 42px;
          height: 24px;
          background: var(--border-color);
          border-radius: 999px;
          position: relative;
          transition: background var(--transition-fast);
          flex-shrink: 0;
        }
        .toggle-track::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: #ffffff;
          border-radius: 50%;
          transition: transform var(--transition-fast);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .toggle-switch input:checked + .toggle-track {
          background: var(--primary);
        }
        .toggle-switch input:checked + .toggle-track::after {
          transform: translateX(18px);
        }
        @media (max-width: 767px) {
          .field-grid-responsive {
            grid-template-columns: 1fr !important;
          }
          .checkbox-grid-responsive {
            grid-template-columns: 1fr 1fr !important;
            gap: 0.75rem !important;
          }
        }
        @media (max-width: 480px) {
          .checkbox-grid-responsive {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <header style={styles.formTitleHeader}>
        <h2 style={styles.formTitle}>Formulario de Captaciones (n8n Webhook)</h2>
        <p style={styles.formSub}>
          Registra una propiedad y retransmite datos e imágenes en tiempo real a nuestro flujo de automatización en n8n.
        </p>
      </header>

      {/* Tabs Nav (ESCRITORIO) */}
      <nav style={styles.tabsNav} className="desktop-only">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === t.id ? styles.tabBtnActive : {})
            }}
          >
            {t.icon}
            <span style={styles.tabBtnText}>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Barra de Progreso y Quick Nav (MÓVIL) */}
      <div className="mobile-only" style={styles.mobileProgressContainer}>
        <div style={styles.mobileProgressHeader}>
          <span style={styles.mobileStepText}>
            Paso {currentStepNumber} de {tabs.length}
          </span>
          <span style={styles.mobileStepLabel}>
            {currentStepLabel}
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
        <div style={styles.mobileQuickNav}>
          <button
            type="button"
            disabled={currentStepIndex === 0}
            onClick={() => setActiveTab(tabs[currentStepIndex - 1].id)}
            style={{
              ...styles.mobileQuickNavBtn,
              ...(currentStepIndex === 0 ? styles.mobileQuickNavBtnDisabled : {})
            }}
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <button
            type="button"
            disabled={currentStepIndex === tabs.length - 1}
            onClick={() => setActiveTab(tabs[currentStepIndex + 1].id)}
            style={{
              ...styles.mobileQuickNavBtn,
              ...(currentStepIndex === tabs.length - 1 ? styles.mobileQuickNavBtnDisabled : {})
            }}
          >
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {status && (
        <div 
          style={{
            ...styles.alertBanner,
            backgroundColor: status.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            borderColor: status.success ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: status.success ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)'
          }}
        >
          {status.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span style={{ fontSize: '0.88rem', fontWeight: '500' }}>{status.message}</span>
        </div>
      )}

      {fileError && (
        <div style={{ ...styles.alertBanner, backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.2)', color: 'rgb(245, 158, 11)' }}>
          <AlertTriangle size={18} />
          <span style={{ fontSize: '0.88rem', fontWeight: '500' }}>{fileError}</span>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} style={styles.form}>
        
        {/* PESTAÑA 1: GENERAL */}
          <div className="animate-fade-in" style={{ ...styles.tabContent, display: activeTab === 'general' ? 'flex' : 'none' }}>
            <div style={styles.fieldGrid} className="field-grid-responsive">
              <div style={{ ...styles.fieldGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Título de Captación *</label>
                <input 
                  type="text" 
                  name="Titulo Captacion" 
                  className="form-control" 
                  placeholder="Ej. Arriendo apartamento en Robledo con vista" 
                  required
                  defaultValue=""
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Dirección *</label>
                <input 
                  type="text" 
                  name="Direccion" 
                  className="form-control" 
                  placeholder="Ej. Calle 67 # 99 - 183" 
                  required 
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Tipo de Operación *</label>
                <select name="Tipo Operacion" className="form-select" required defaultValue="">
                  <option value="" disabled>Selecciona una opción...</option>
                  <option value="arriendo">Arriendo</option>
                  <option value="venta">Venta</option>
                  <option value="venta y arriendo">Venta y Arriendo</option>
                </select>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Municipio *</label>
                <select
                  name="Municipio"
                  className="form-select"
                  required
                  value={municipio}
                  onChange={(e) => { setMunicipio(e.target.value); setBarrioId(''); }}
                >
                  <option value="" disabled>Selecciona un municipio...</option>
                  <option value="Medellin">Medellín</option>
                  <option value="Bello">Bello</option>
                  <option value="Sabaneta">Sabaneta</option>
                  <option value="Envigado">Envigado</option>
                </select>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Barrio *</label>
                <select
                  name="Barrio_id"
                  className="form-select"
                  required
                  disabled={!municipio}
                  value={barrioId}
                  onChange={(e) => setBarrioId(e.target.value)}
                >
                  <option value="" disabled>
                    {municipio ? 'Selecciona un barrio...' : 'Primero elige el municipio'}
                  </option>
                  {barriosDelMunicipio.map((b) => (
                    <option key={b.id} value={b.id}>{b.barrio}</option>
                  ))}
                </select>
                {/* El nombre del barrio se sigue enviando como `Barrio` (hoja/doc/post de n8n) */}
                <input type="hidden" name="Barrio" value={barrioNombre} />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Estrato *</label>
                <select name="Estrato" className="form-select" required defaultValue="">
                  <option value="" disabled>Selecciona el estrato...</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                </select>
              </div>

              <div style={{ ...styles.fieldGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Unidad Cerrada / Edificio</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={enUnidad}
                    onChange={(e) => {
                      setEnUnidad(e.target.checked);
                      if (!e.target.checked) { setUnidadSel(''); setUnidadNueva(''); }
                    }}
                  />
                  <span className="toggle-track" />
                  <span style={styles.toggleText}>El inmueble está en una unidad cerrada / edificio</span>
                </label>

                {enUnidad && (
                  <div style={styles.unidadReveal}>
                    <select
                      className="form-select"
                      required
                      value={unidadSel}
                      onChange={(e) => { setUnidadSel(e.target.value); if (e.target.value !== '__otra__') setUnidadNueva(''); }}
                    >
                      <option value="" disabled>Selecciona la unidad...</option>
                      {unidades.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                      <option value="__otra__">➕ Otra (agregar nueva)</option>
                    </select>

                    {unidadSel === '__otra__' && (
                      <input
                        type="text"
                        className="form-control"
                        required
                        value={unidadNueva}
                        onChange={(e) => setUnidadNueva(e.target.value)}
                        placeholder="Nombre de la nueva unidad (ej. Luna del Mar)"
                        style={{ marginTop: '0.6rem' }}
                      />
                    )}
                  </div>
                )}

                {/* Lo que realmente viaja al POST de n8n */}
                <input type="hidden" name="Unidad" value={unidadValue} />
                <input type="hidden" name="Unidad Cerrada" value={unidadCerradaValue} />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Torre / Apartamento</label>
                <input 
                  type="text" 
                  name="Apartamento" 
                  className="form-control" 
                  placeholder="Ej. Apto 903" 
                  defaultValue="n/a"
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Precio (COP) *</label>
                <input 
                  type="number" 
                  name="Precio(COP)" 
                  className="form-control" 
                  placeholder="Ej. 1500000" 
                  required 
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Asesor *</label>
                <select name="Asesor" className="form-select" required defaultValue="Sebastian">
                  <option value="Sebastian">Sebastian</option>
                  <option value="Gisela">Gisela</option>
                  <option value="Liz">Liz</option>
                  <option value="Samuel">Samuel</option>
                </select>
              </div>
            </div>

            <div style={styles.navigationRow}>
              <span style={styles.requiredText}>* Campos obligatorios</span>
              <button 
                type="button" 
                onClick={() => setActiveTab('caracteristicas')} 
                style={styles.navBtnNext}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>

        {/* PESTAÑA 2: CARACTERÍSTICAS */}
          <div className="animate-fade-in" style={{ ...styles.tabContent, display: activeTab === 'caracteristicas' ? 'flex' : 'none' }}>
            <div style={styles.fieldGrid} className="field-grid-responsive">
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Número de Habitaciones *</label>
                <input 
                  type="number" 
                  name="num de habitaciones" 
                  className="form-control" 
                  placeholder="Ej. 3" 
                  required 
                  defaultValue="1"
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Número de Baños *</label>
                <input 
                  type="number" 
                  name="num de baños" 
                  className="form-control" 
                  placeholder="Ej. 2" 
                  required 
                  defaultValue="1"
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Número de Closets *</label>
                <input 
                  type="number" 
                  name="num de closet" 
                  className="form-control" 
                  placeholder="Ej. 3" 
                  required 
                  defaultValue="0"
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Área Privada (m²) *</label>
                <input 
                  type="number" 
                  name="Area" 
                  className="form-control" 
                  placeholder="Ej. 55" 
                  required 
                />
              </div>
            </div>

            <div style={styles.navigationRow}>
              <button 
                type="button" 
                onClick={() => setActiveTab('general')} 
                style={styles.navBtnBack}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <button 
                type="button" 
                onClick={() => setActiveTab('comodidades')} 
                style={styles.navBtnNext}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>

        {/* PESTAÑA 3: COMODIDADES */}
          <div className="animate-fade-in" style={{ ...styles.tabContent, display: activeTab === 'comodidades' ? 'flex' : 'none' }}>
            
            <div style={{ ...styles.fieldGrid, marginBottom: '1.5rem' }} className="field-grid-responsive">
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Tipo de Cocina *</label>
                <select name="Cocina" className="form-select" required defaultValue="Integral">
                  <option value="Integral">Integral</option>
                  <option value="Semi-integral">Semi-integral</option>
                  <option value="Cocineta">Cocineta</option>
                  <option value="No aplica">No aplica</option>
                </select>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Parqueadero *</label>
                <select name="Parqueadero" className="form-select" required defaultValue="No">
                  <option value="Privado">Privado</option>
                  <option value="Comun">Común</option>
                  <option value="No">No</option>
                </select>
              </div>

              <div style={{ ...styles.fieldGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Otras Zonas Comunes / Observación</label>
                <input 
                  type="text" 
                  name="Otra Zona común" 
                  className="form-control" 
                  placeholder="Ej. Turco, Salón Social (n/a si no aplica)" 
                  defaultValue="n/a"
                />
              </div>
            </div>

            <h3 style={styles.sectionDivider}>Comodidades del Inmueble y Unidad (Marcar las que apliquen)</h3>

            <div style={styles.checkboxGrid} className="checkbox-grid-responsive">
              {[
                { name: 'Sala', label: 'Sala' },
                { name: 'Sala comedor', label: 'Sala Comedor' },
                { name: 'Estudio', label: 'Estudio' },
                { name: 'Comedor', label: 'Comedor' },
                { name: 'Barra', label: 'Barra americana' },
                { name: 'Instalación de gas', label: 'Red de Gas' },
                { name: 'Calentador', label: 'Calentador' },
                { name: 'Balcon', label: 'Balcón' },
                { name: 'Cuarto Util', label: 'Cuarto Útil' },
                { name: 'Piscina', label: 'Piscina' },
                { name: 'Cancha', label: 'Canchas' },
                { name: 'Gimnasio', label: 'Gimnasio' }
              ].map(com => (
                <label key={com.name} style={styles.checkboxLabel}>
                  <input 
                    type="checkbox" 
                    name={com.name} 
                    style={styles.checkboxInput} 
                  />
                  <span>{com.label}</span>
                </label>
              ))}
            </div>

            <div style={styles.navigationRow}>
              <button 
                type="button" 
                onClick={() => setActiveTab('caracteristicas')} 
                style={styles.navBtnBack}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <button 
                type="button" 
                onClick={() => setActiveTab('propietario')} 
                style={styles.navBtnNext}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>

        {/* PESTAÑA 4: PROPIETARIO */}
          <div className="animate-fade-in" style={{ ...styles.tabContent, display: activeTab === 'propietario' ? 'flex' : 'none' }}>
            <div style={styles.fieldGrid} className="field-grid-responsive">
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Nombre del Propietario *</label>
                <input 
                  type="text" 
                  name="Nombre prop" 
                  className="form-control" 
                  placeholder="Ej. María Elena Restrepo" 
                  required 
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Teléfono del Propietario *</label>
                <input
                  type="tel"
                  name="Num Prop"
                  className="form-control"
                  placeholder="Ej. 3012345678"
                  required
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Email del Propietario *</label>
                <input
                  type="email"
                  name="Email prop"
                  className="form-control"
                  placeholder="Ej. propietario@correo.com"
                  required
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Comisión (Portero / Referidos)</label>
                <input 
                  type="text" 
                  name="Comision(portero)" 
                  className="form-control" 
                  placeholder="Ej. $100.000 COP al portero don Luis (n/a si no aplica)" 
                  defaultValue="n/a"
                />
              </div>

              <div style={{ ...styles.fieldGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Observaciones y Notas Internas</label>
                <textarea 
                  name="Observaciones" 
                  className="form-control" 
                  rows={3}
                  placeholder="Ej. El propietario prefiere contrato rápido..." 
                  defaultValue="n/a"
                  style={styles.textarea}
                />
              </div>
            </div>

            <div style={styles.navigationRow}>
              <button 
                type="button" 
                onClick={() => setActiveTab('comodidades')} 
                style={styles.navBtnBack}
              >
                <ChevronLeft size={16} /> Anterior
              </button>
              <button 
                type="button" 
                onClick={() => setActiveTab('fotos')} 
                style={styles.navBtnNext}
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>

        {/* PESTAÑA 5: FOTOS */}
          <div className="animate-fade-in" style={{ ...styles.tabContent, display: activeTab === 'fotos' ? 'flex' : 'none' }}>
            
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
              style={{
                ...styles.dragDropZone,
                borderColor: dragActive ? 'var(--primary)' : 'var(--border-color)',
                backgroundColor: dragActive ? 'rgba(0, 171, 216, 0.02)' : 'transparent'
              }}
            >
              <UploadCloud size={40} color={dragActive ? 'var(--primary)' : 'var(--text-muted)'} style={{ marginBottom: '1rem' }} />
              <p style={{ fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                Arrastra tus imágenes aquí o haz clic para buscarlas
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginBottom: 0 }}>
                Formatos válidos: JPG, PNG, WEBP. Límite: {MAX_FILE_SIZE_MB}MB por foto, {MAX_TOTAL_SIZE_MB}MB total.
              </p>
              <input 
                ref={fileInputRef}
                type="file" 
                multiple 
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* Listado de miniaturas */}
            {files.length > 0 && (
              <div style={styles.filesContainer}>
                <div style={styles.filesHeaderRow}>
                  <h4 style={styles.filesTitleLabel}>Fotos Seleccionadas ({files.length})</h4>
                  <span style={styles.totalWeight}>
                    Peso total: <strong>{(totalSizeCurrent / (1024 * 1024)).toFixed(2)} MB</strong> / {MAX_TOTAL_SIZE_MB}MB
                  </span>
                </div>
                
                <div style={styles.thumbnailsGrid}>
                  {files.map((file, index) => {
                    const imgUrl = URL.createObjectURL(file);
                    return (
                      <div key={`${file.name}-${index}`} style={styles.thumbnailCard}>
                        <img src={imgUrl} alt={file.name} style={styles.thumbnailImg} />
                        <div style={styles.thumbnailOverlay}>
                          <span style={styles.thumbnailSize}>{(file.size / 1024).toFixed(0)} KB</span>
                          <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); removeFile(index); }} 
                            style={styles.deleteThBtn}
                            title="Eliminar foto"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={styles.navigationRow}>
              <button 
                type="button" 
                disabled={isPending}
                onClick={() => setActiveTab('propietario')} 
                style={styles.navBtnBack}
              >
                <ChevronLeft size={16} /> Anterior
              </button>

              <button 
                type="submit" 
                disabled={isPending || files.length === 0} 
                style={{
                  ...styles.submitBtn,
                  ...((isPending || files.length === 0) ? styles.submitBtnDisabled : {})
                }}
              >
                {isPending ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div className="spinner-loader" style={styles.btnSpinner} />
                    <span>{uploadMsg || 'Enviando...'}</span>
                  </div>
                ) : (
                  <span>¡Disparar Captación a n8n!</span>
                )}
              </button>
            </div>
            
            {isPending && (
              <div style={styles.progressWrapper}>
                <div style={styles.progressBarBg}>
                  <div className="progress-bar-anim" style={styles.progressBarFill} />
                </div>
                <p style={styles.progressText}>
                  {uploadMsg || 'Procesando...'} Por favor, no cierres la ventana.
                </p>
              </div>
            )}

          </div>

      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  formContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  formTitleHeader: {
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '1rem',
  },
  formTitle: {
    fontSize: '1.4rem',
    fontWeight: '800',
    color: 'var(--text-primary)',
    margin: 0,
  },
  formSub: {
    fontSize: '0.87rem',
    color: 'var(--text-secondary)',
    margin: 0,
    marginTop: '0.25rem',
  },
  tabsNav: {
    display: 'flex',
    gap: '0.35rem',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '0.5rem',
    overflowX: 'auto',
    flexWrap: 'wrap',
  },
  tabBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.55rem 0.85rem',
    borderRadius: '8px',
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    whiteSpace: 'nowrap',
  },
  tabBtnActive: {
    backgroundColor: 'var(--primary-light)',
    color: 'var(--primary)',
    fontWeight: '700',
  },
  tabBtnText: {
    display: 'inline',
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    marginTop: '0.5rem',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1.25rem',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  requiredText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  navigationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '1.5rem',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '1.25rem',
  },
  navBtnNext: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: 'var(--primary)',
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  navBtnBack: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: '#ffffff',
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  sectionDivider: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
    marginTop: '1rem',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '0.5rem',
  },
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '0.85rem',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  checkboxInput: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: 'var(--primary)',
  },
  textarea: {
    resize: 'vertical',
  },
  toggleText: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  unidadReveal: {
    marginTop: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
  },
  dragDropZone: {
    border: '2px dashed var(--border-color)',
    borderRadius: '12px',
    padding: '3rem 2rem',
    textAlign: 'center',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'all var(--transition-fast)',
  },
  filesContainer: {
    marginTop: '1rem',
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '1.25rem',
    border: '1px solid var(--border-color)',
  },
  filesHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  filesTitleLabel: {
    fontSize: '0.88rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
    margin: 0,
  },
  totalWeight: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
  },
  thumbnailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: '0.85rem',
  },
  thumbnailCard: {
    position: 'relative',
    width: '100px',
    height: '100px',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbnailOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.2rem 0.4rem',
    color: '#ffffff',
    fontSize: '0.65rem',
  },
  thumbnailSize: {
    fontFamily: 'monospace',
  },
  deleteThBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    padding: '0.1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.65rem 1.5rem',
    borderRadius: '8px',
    fontSize: '0.87rem',
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: 'var(--primary)',
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  submitBtnDisabled: {
    backgroundColor: 'var(--text-muted)',
    cursor: 'not-allowed',
  },
  btnSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#ffffff',
    borderRadius: '50%',
  },
  progressWrapper: {
    marginTop: '1.5rem',
    textAlign: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: '6px',
    backgroundColor: 'rgba(0, 171, 216, 0.1)',
    borderRadius: '3px',
    overflow: 'hidden',
    marginBottom: '0.5rem',
  },
  progressBarFill: {
    height: '100%',
    width: '100%',
    backgroundColor: 'var(--primary)',
  },
  progressText: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  alertBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.85rem 1rem',
    borderRadius: '8px',
    border: '1px solid',
  },
  form: {
    display: 'block',
  },
  mobileProgressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    padding: '1rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
    marginBottom: '0.5rem',
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
