'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Camera, RefreshCw, Check, ShieldAlert, AlertCircle } from 'lucide-react';

interface FaceCaptureProps {
  title: string;
  subtitle: string;
  onSave: (base64Image: string) => void;
  onBack?: () => void;
}

export default function FaceCapture({ title, subtitle, onSave, onBack }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [flash, setFlash] = useState(false);
  const [acceptedConsent, setAcceptedConsent] = useState(false);

  // Iniciar flujo de video
  const startCamera = async () => {
    try {
      if (streamRef.current) {
        stopCamera();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 640 },
          facingMode: 'user' // Cámara frontal
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setPermissionGranted(true);
    } catch (err: any) {
      console.error('[FaceCapture] Error al acceder a la cámara frontal:', err);
      setPermissionGranted(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (acceptedConsent) {
      startCamera();
    }
    return () => stopCamera();
  }, [acceptedConsent]);

  // Manejar cuenta regresiva de 3 segundos
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      captureSnapshot();
      setCountdown(null);
      setIsCounting(false);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  const startCountdown = () => {
    if (isCounting) return;
    setIsCounting(true);
    setCountdown(3);
  };

  const captureSnapshot = () => {
    const video = videoRef.current;
    if (!video) return;

    // Efecto visual de flash de cámara
    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    const canvas = document.createElement('canvas');
    // Forzar proporción 1:1 cuadrada para la selfie
    const size = Math.min(video.videoWidth, video.videoHeight) || 480;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Recortar al centro para obtener un cuadrado perfecto
      const sx = (video.videoWidth - size) / 2;
      const sy = (video.videoHeight - size) / 2;
      
      // Espejar la imagen para que coincida con el preview (comportamiento natural de selfie)
      ctx.translate(size, 0);
      ctx.scale(-1, 1);

      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // Calidad optimizada de JPG
      setCapturedImage(dataUrl);
      stopCamera();
    }
  };

  const resetCapture = () => {
    setCapturedImage(null);
    startCamera();
  };

  const confirmSelfie = () => {
    if (capturedImage) {
      onSave(capturedImage);
    }
  };

  // 1. Pantalla de Consentimiento Habeas Data (Protección de Datos)
  if (!acceptedConsent) {
    return (
      <div style={styles.container} className="animate-scale-up">
        <header style={styles.header}>
          <div style={styles.badgeRow}>
            <span className="badge badge-warning" style={styles.badge}>
              Seguridad & Privacidad
            </span>
          </div>
          <h2 style={styles.title}>Tratamiento de Datos Biométricos</h2>
          <p style={styles.subtitle}>Cumplimiento con Ley de Protección de Datos Personales (Habeas Data)</p>
        </header>

        <div style={styles.consentCard} className="glass-card">
          <ShieldAlert size={40} color="var(--warning)" style={{ marginBottom: '1rem' }} />
          <p style={styles.consentText}>
            Para garantizar la validez legal del acta de entrega, Cumbres Inmobiliaria recopilará una fotografía facial de seguridad en vivo (selfie) y una firma digital.
          </p>
          <p style={styles.consentText}>
            Esta información se tratará de manera estrictamente confidencial, se almacenará en servidores seguros protegidos por cifrado y se utilizará de forma exclusiva para fines de verificación del inventario del inmueble en caso de disputas. No será cedida a terceros.
          </p>
          <p style={styles.consentTextSmall}>
            Al presionar "Aceptar y Habilitar Cámara", otorgas tu consentimiento expreso para la toma y almacenamiento temporal de esta prueba de identidad biométrica.
          </p>
        </div>

        <footer style={styles.footer}>
          {onBack && (
            <button onClick={onBack} className="btn btn-secondary" style={styles.btnAction}>
              Cancelar
            </button>
          )}
          <button 
            onClick={() => setAcceptedConsent(true)} 
            className="btn btn-primary" 
            style={{ ...styles.btnAction, backgroundColor: 'var(--primary)' }}
          >
            Aceptar y Habilitar Cámara
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div style={styles.container} className="animate-scale-up">
      {flash && <div style={styles.flashOverlay} />}

      <header style={styles.header}>
        <div style={styles.badgeRow}>
          <span className="badge badge-info" style={styles.badge}>
            PASO 2: BIOMETRÍA FACIAL
          </span>
        </div>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>{subtitle}</p>
      </header>

      {/* Visor de Cámara / Visualización de Selfie */}
      <div style={styles.cameraBox}>
        {capturedImage ? (
          // Vista previa de captura realizada
          <div style={styles.circlePreviewContainer}>
            <img src={capturedImage} alt="Selfie Capturada" style={styles.previewImg} />
            <div style={styles.previewSuccessIndicator}>✓ CAPTURA REALIZADA</div>
          </div>
        ) : permissionGranted === false ? (
          // Mensaje de error de permisos de cámara
          <div style={styles.errorBox} className="glass-card">
            <AlertCircle size={36} color="var(--danger)" style={{ marginBottom: '0.75rem' }} />
            <span style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Cámara no disponible</span>
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 1.4 }}>
              No pudimos acceder a tu cámara frontal. Asegúrate de conceder permisos de cámara en tu navegador o dispositivo móvil.
            </p>
            {/* Fallback de Pruebas: Cargar una foto de biblioteca o simular una */}
            <button 
              onClick={() => {
                // Simulación para propósitos de prueba locales
                console.log('[FaceCapture] Simulando captura de selfie por falta de cámara');
                setCapturedImage('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 100 100" fill="%2300abd8"><circle cx="50" cy="50" r="40" fill="opacity-10"/><circle cx="50" cy="40" r="18"/><path d="M20 80c0-15 15-20 30-20s30 5 30 20z"/></svg>');
              }}
              className="btn btn-outline"
              style={{ marginTop: '1rem', fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderColor: 'var(--primary)', color: 'var(--primary)' }}
            >
              Usar Captura Simulada (Modo Pruebas)
            </button>
          </div>
        ) : (
          // Live Video feed en máscara circular
          <div style={styles.circleMask}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={styles.video}
            />
            {/* Cuenta Regresiva Visual */}
            {countdown !== null && (
              <div style={styles.countdownContainer}>
                <span style={styles.countdownNumber} key={countdown}>{countdown}</span>
              </div>
            )}
            
            {/* Superposición circular de guía */}
            <div style={styles.guideCircle} />
          </div>
        )}
      </div>

      {/* Botones de acción inferiores */}
      <footer style={styles.footer}>
        {capturedImage ? (
          // Botones cuando ya se tomó la foto
          <>
            <button onClick={resetCapture} className="btn btn-secondary" style={styles.btnAction}>
              <RefreshCw size={16} />
              Repetir Foto
            </button>
            <button onClick={confirmSelfie} className="btn btn-primary" style={styles.btnAction}>
              <Check size={16} />
              Confirmar Selfie
            </button>
          </>
        ) : (
          // Botones antes de tomar la foto
          <>
            {onBack && (
              <button onClick={onBack} className="btn btn-secondary" style={styles.btnAction} disabled={isCounting}>
                Volver
              </button>
            )}
            <button 
              onClick={startCountdown} 
              className="btn btn-primary" 
              style={{ 
                ...styles.btnAction, 
                backgroundColor: isCounting ? 'var(--text-muted)' : 'var(--primary)' 
              }}
              disabled={isCounting || permissionGranted === false}
            >
              <Camera size={18} />
              {isCounting ? 'Preparando...' : 'Tomar Selfie'}
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
  consentCard: {
    padding: '1.5rem',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.85rem',
  },
  consentText: {
    fontSize: '0.85rem',
    color: '#ffffff',
    lineHeight: '1.5',
    textAlign: 'justify',
  },
  consentTextSmall: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: '1.4',
    textAlign: 'center',
    marginTop: '0.25rem',
  },
  cameraBox: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '310px',
  },
  circleMask: {
    position: 'relative',
    width: '280px',
    height: '280px',
    borderRadius: '50%',
    overflow: 'hidden',
    border: '4px solid #8b5cf6', // Color violeta biométrico
    boxShadow: '0 8px 32px rgba(139, 92, 246, 0.4), inset 0 0 20px rgba(0,0,0,0.5)',
    backgroundColor: '#0f172a',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)', // Espejo interactivo natural
  },
  guideCircle: {
    position: 'absolute',
    inset: '15px',
    border: '2px dashed rgba(255, 255, 255, 0.3)',
    borderRadius: '50%',
    pointerEvents: 'none',
  },
  circlePreviewContainer: {
    position: 'relative',
    width: '280px',
    height: '280px',
    borderRadius: '50%',
    overflow: 'hidden',
    border: '4px solid #00abd8', // Cyan cuando está ok
    boxShadow: '0 8px 32px rgba(0, 171, 216, 0.4)',
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewSuccessIndicator: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'var(--primary)',
    color: '#ffffff',
    fontSize: '0.7rem',
    fontWeight: '800',
    padding: '4px 10px',
    borderRadius: '20px',
    letterSpacing: '1px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
  },
  countdownContainer: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontSize: '5.5rem',
    fontWeight: '900',
    color: '#ffffff',
    animation: 'scaleIn 0.8s ease-out infinite',
  },
  errorBox: {
    width: '280px',
    padding: '1.5rem',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: '16px',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#ffffff',
  },
  flashOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#ffffff',
    zIndex: 10000,
    pointerEvents: 'none',
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
