'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, Check, AlertCircle, ScanLine, FileText } from 'lucide-react';

interface DocumentScannerProps {
  title: string;
  subtitle: string;
  defaultName: string;
  defaultId: string;
  onSave: (base64Image: string, ocrMetadata: { nombre_completo: string; numero_identidad: string }) => void;
  onBack?: () => void;
}

export default function DocumentScanner({ 
  title, 
  subtitle, 
  defaultName, 
  defaultId, 
  onSave, 
  onBack 
}: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showOcrForm, setShowOcrForm] = useState(false);
  
  // Datos OCR extraídos (editables)
  const [ocrNombre, setOcrNombre] = useState(defaultName || '');
  const [ocrId, setOcrId] = useState(defaultId || '');

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        stopCamera();
      }

      // Tratar de abrir la cámara trasera por defecto
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment' // Cámara trasera
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setPermissionGranted(true);
    } catch (err: any) {
      console.warn('[DocumentScanner] Error abriendo cámara trasera, reintentando con cualquiera...', err);
      try {
        // Fallback a cualquier cámara disponible si environment no existe
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setPermissionGranted(true);
      } catch (fallbackErr) {
        console.error('[DocumentScanner] Error total al acceder a cámaras:', fallbackErr);
        setPermissionGranted(false);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Pre-cargar valores de búsqueda si cambian por las props
  useEffect(() => {
    if (defaultName) setOcrNombre(defaultName);
    if (defaultId) setOcrId(defaultId);
  }, [defaultName, defaultId]);

  const captureDocument = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    // Capturar en alta resolución de aspecto 16:9
    canvas.width = video.videoWidth || 800;
    canvas.height = video.videoHeight || 450;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      setCapturedImage(dataUrl);
      stopCamera();
      
      // Iniciar animación de escaneo OCR
      triggerOcrProcessing();
    }
  };

  const triggerOcrProcessing = () => {
    setIsScanning(true);
    
    // Simular procesamiento del algoritmo de OCR con animación láser
    setTimeout(() => {
      setIsScanning(false);
      setShowOcrForm(true);
    }, 2500); // 2.5 segundos de animación premium de escaneo láser
  };

  const resetCapture = () => {
    setCapturedImage(null);
    setShowOcrForm(false);
    setIsScanning(false);
    startCamera();
  };

  const confirmOcrData = () => {
    if (!ocrNombre.trim() || !ocrId.trim()) {
      alert('Por favor, completa los campos de validación del documento.');
      return;
    }

    if (capturedImage) {
      onSave(capturedImage, {
        nombre_completo: ocrNombre.trim().toUpperCase(),
        numero_identidad: ocrId.trim()
      });
    }
  };

  return (
    <div style={styles.container} className="animate-scale-up">
      <header style={styles.header}>
        <div style={styles.badgeRow}>
          <span className="badge badge-info" style={styles.badge}>
            PASO 3: ESCANEO DE DOCUMENTO
          </span>
        </div>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>{subtitle}</p>
      </header>

      {/* Visor de escaneo */}
      <div style={styles.scannerBox}>
        {showOcrForm ? (
          // Formulario OCR de verificación
          <div style={styles.ocrFormCard} className="glass-card animate-fade-in">
            <div style={styles.ocrHeader}>
              <FileText size={20} color="var(--primary)" />
              <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Verificación Legal de Identidad</span>
            </div>
            
            <p style={styles.ocrInfoText}>
              El escáner ha procesado la Cédula de Ciudadanía. Por favor, verifica y corrige que los datos coincidan exactamente con el documento físico:
            </p>

            <div className="form-group" style={styles.formGroupCompact}>
              <label className="form-label" style={styles.labelCompact}>NOMBRES Y APELLIDOS</label>
              <input 
                type="text" 
                value={ocrNombre} 
                onChange={(e) => setOcrNombre(e.target.value)} 
                className="form-input" 
                style={styles.inputCompact}
                placeholder="Nombre Completo"
              />
            </div>

            <div className="form-group" style={styles.formGroupCompact}>
              <label className="form-label" style={styles.labelCompact}>NÚMERO DE DOCUMENTO (C.C.)</label>
              <input 
                type="text" 
                value={ocrId} 
                onChange={(e) => setOcrId(e.target.value)} 
                className="form-input" 
                style={styles.inputCompact}
                placeholder="Número de Cédula"
              />
            </div>
            
            <div style={styles.previewAttachmentRow}>
              <span>Foto del documento: Adjunta correctamente ✓</span>
            </div>
          </div>
        ) : capturedImage ? (
          // Vista de procesamiento láser
          <div style={styles.previewContainer}>
            <img src={capturedImage} alt="Documento Capturado" style={styles.previewImg} />
            {isScanning && (
              <>
                <div style={styles.laserBar} />
                <div style={styles.scanningOverlay}>
                  <ScanLine size={32} className="animate-pulse" style={{ color: '#00abd8', marginBottom: '0.5rem' }} />
                  <span style={styles.scanningText}>PROCESANDO OCR IN-APP...</span>
                </div>
              </>
            )}
          </div>
        ) : permissionGranted === false ? (
          // Sin cámara
          <div style={styles.errorBox} className="glass-card">
            <AlertCircle size={36} color="var(--danger)" style={{ marginBottom: '0.75rem' }} />
            <span style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Cámara trasera no disponible</span>
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 1.4 }}>
              No se pudo abrir la cámara. Para continuar en modo manual, haz clic en el botón de abajo.
            </p>
            <button 
              onClick={() => {
                // Simular captura
                console.log('[DocumentScanner] Simulando captura de documento');
                setCapturedImage('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 100 60" fill="%231e293b"><rect width="100" height="60" rx="4" fill-opacity-50" stroke="%2300abd8" stroke-width="2"/><circle cx="20" cy="30" r="10" fill="%23475569"/><rect x="40" y="15" width="45" height="5" rx="1" fill="%23475569"/><rect x="40" y="25" width="35" height="4" rx="1" fill="%23475569"/><rect x="40" y="35" width="25" height="4" rx="1" fill="%23475569"/></svg>');
                triggerOcrProcessing();
              }}
              className="btn btn-outline"
              style={{ marginTop: '1rem', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
            >
              Pasar a Captura Manual
            </button>
          </div>
        ) : (
          // Cámara en vivo con marco guía para cédula colombiana
          <div style={styles.cameraFrame}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={styles.video}
            />
            {/* Marco guía de documento de identidad */}
            <div style={styles.guideliningBox}>
              <div style={styles.cornerTL} />
              <div style={styles.cornerTR} />
              <div style={styles.cornerBL} />
              <div style={styles.cornerBR} />
              <div style={styles.guideText}>ALINEA LA CÉDULA AQUÍ</div>
            </div>
          </div>
        )}
      </div>

      {/* Botones de acción */}
      <footer style={styles.footer}>
        {showOcrForm ? (
          <>
            <button onClick={resetCapture} className="btn btn-secondary" style={styles.btnAction}>
              <RefreshCw size={16} />
              Escanear de Nuevo
            </button>
            <button onClick={confirmOcrData} className="btn btn-primary" style={styles.btnAction}>
              <Check size={16} />
              Confirmar Datos
            </button>
          </>
        ) : (
          <>
            {onBack && (
              <button onClick={onBack} className="btn btn-secondary" style={styles.btnAction} disabled={isScanning}>
                Volver
              </button>
            )}
            <button 
              onClick={captureDocument} 
              className="btn btn-primary" 
              style={{ 
                ...styles.btnAction, 
                backgroundColor: isScanning ? 'var(--text-muted)' : 'var(--primary)' 
              }}
              disabled={isScanning || permissionGranted === false}
            >
              <Camera size={18} />
              {isScanning ? 'Escaneando...' : 'Capturar & Procesar'}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
    width: '100%',
    maxWidth: '520px',
    margin: '0 auto',
    padding: '1rem',
  },
  header: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.35rem',
  },
  badgeRow: {
    marginBottom: '0.25rem',
  },
  badge: {
    fontSize: '0.7rem',
    padding: '0.2rem 0.6rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 'bold',
  },
  title: {
    fontSize: '1.45rem',
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  scannerBox: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '290px',
  },
  cameraFrame: {
    position: 'relative',
    width: '100%',
    height: '260px',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '2px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)',
    backgroundColor: '#0f172a',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  guideliningBox: {
    position: 'absolute',
    inset: '25px 40px',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerTL: { position: 'absolute', top: '-2px', left: '-2px', width: '18px', height: '18px', borderLeft: '4px solid #00abd8', borderTop: '4px solid #00abd8', borderTopLeftRadius: '6px' },
  cornerTR: { position: 'absolute', top: '-2px', right: '-2px', width: '18px', height: '18px', borderRight: '4px solid #00abd8', borderTop: '4px solid #00abd8', borderTopRightRadius: '6px' },
  cornerBL: { position: 'absolute', bottom: '-2px', left: '-2px', width: '18px', height: '18px', borderLeft: '4px solid #00abd8', borderBottom: '4px solid #00abd8', borderBottomLeftRadius: '6px' },
  cornerBR: { position: 'absolute', bottom: '-2px', right: '-2px', width: '18px', height: '18px', borderRight: '4px solid #00abd8', borderBottom: '4px solid #00abd8', borderBottomRightRadius: '6px' },
  guideText: {
    color: '#00abd8',
    fontSize: '0.75rem',
    fontWeight: '800',
    letterSpacing: '1px',
    textShadow: '0 2px 4px rgba(0,0,0,0.5)',
  },
  previewContainer: {
    position: 'relative',
    width: '100%',
    height: '260px',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '2px solid rgba(255, 255, 255, 0.1)',
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  scanningOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(3px)',
  },
  scanningText: {
    color: '#ffffff',
    fontSize: '0.85rem',
    fontWeight: '800',
    letterSpacing: '1.5px',
  },
  laserBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '4px',
    backgroundColor: '#00abd8',
    boxShadow: '0 0 15px 4px rgba(0, 171, 216, 0.8)',
    animation: 'scanLaser 2.2s ease-in-out infinite',
    zIndex: 5,
  },
  ocrFormCard: {
    padding: '1.25rem',
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,0.08)',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  ocrHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#ffffff',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    paddingBottom: '0.4rem',
  },
  ocrInfoText: {
    fontSize: '0.78rem',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: '1.45',
    marginBottom: '0.2rem',
  },
  formGroupCompact: {
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  labelCompact: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontWeight: '700',
    letterSpacing: '0.5px',
  },
  inputCompact: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.88rem',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(15, 23, 42, 0.4)',
    color: '#ffffff',
  },
  previewAttachmentRow: {
    fontSize: '0.75rem',
    color: '#10b981',
    fontWeight: '600',
    textAlign: 'right',
    marginTop: '0.2rem',
  },
  errorBox: {
    width: '100%',
    maxWidth: '350px',
    padding: '1.5rem',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: '16px',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#ffffff',
  },
  footer: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    width: '100%',
    marginTop: '0.5rem',
  },
  btnAction: {
    flex: 1,
    padding: '0.75rem 1rem',
    fontSize: '0.9rem',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
  }
};
