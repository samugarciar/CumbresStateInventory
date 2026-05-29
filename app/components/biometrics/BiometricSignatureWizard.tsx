'use client';

import React, { useState } from 'react';
import { ShieldCheck, UserCheck, Smartphone, RefreshCw, X, Loader2 } from 'lucide-react';
import SignatureCanvas from './SignatureCanvas';
import FaceCapture from './FaceCapture';
import DocumentScanner from './DocumentScanner';
import { guardarFirmaBiometrica } from '@/app/actions/biometria';

interface BiometricSignatureWizardProps {
  inventarioId: string;
  asesorDefaultName: string;
  asesorDefaultId: string;
  inquilinoDefaultName: string;
  inquilinoDefaultId: string;
  onClose: () => void;
}

type Step = 
  | 'welcome'
  | 'asesor_firma'
  | 'asesor_selfie'
  | 'asesor_cedula'
  | 'transition'
  | 'inquilino_firma'
  | 'inquilino_selfie'
  | 'inquilino_cedula'
  | 'submitting'
  | 'success';

export default function BiometricSignatureWizard({
  inventarioId,
  asesorDefaultName,
  asesorDefaultId,
  inquilinoDefaultName,
  inquilinoDefaultId,
  onClose
}: BiometricSignatureWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [error, setError] = useState<string | null>(null);

  // Datos capturados
  const [asesorData, setAsesorData] = useState({
    firma: '',
    selfie: '',
    cedula: '',
    ocr: { nombre_completo: asesorDefaultName || '', numero_identidad: asesorDefaultId || '' }
  });

  const [inquilinoData, setInquilinoData] = useState({
    firma: '',
    selfie: '',
    cedula: '',
    ocr: { nombre_completo: inquilinoDefaultName || '', numero_identidad: inquilinoDefaultId || '' }
  });

  // Finalizar y enviar datos a Supabase
  const submitBiometrics = async (finalInquilinoCedula: string, finalInquilinoOcr: typeof inquilinoData.ocr) => {
    setCurrentStep('submitting');
    setError(null);

    const payload = {
      asesor: {
        firma: asesorData.firma,
        selfie: asesorData.selfie,
        cedula: asesorData.cedula,
        ocr_metadata: asesorData.ocr
      },
      inquilino: {
        firma: inquilinoData.firma,
        selfie: inquilinoData.selfie,
        cedula: finalInquilinoCedula,
        ocr_metadata: finalInquilinoOcr
      }
    };

    try {
      const response = await guardarFirmaBiometrica(inventarioId, payload);
      if (response.success) {
        setCurrentStep('success');
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 2200);
      } else {
        setError(response.error || 'Ocurrió un error al procesar las firmas.');
        setCurrentStep('inquilino_cedula');
      }
    } catch (err: any) {
      console.error('[BiometricWizard] Error al guardar firmas:', err);
      setError(err.message || 'Excepción del servidor al procesar.');
      setCurrentStep('inquilino_cedula');
    }
  };

  return (
    <div style={styles.fullscreenOverlay} className="animate-fade-in">
      {/* Botón de cierre para cancelar el flujo */}
      {currentStep !== 'submitting' && currentStep !== 'success' && (
        <button onClick={onClose} style={styles.closeBtn} title="Cancelar Firma">
          <X size={20} />
        </button>
      )}

      <div style={styles.wizardCard}>
        {/* Barra de progreso global del Wizard */}
        {currentStep !== 'welcome' && currentStep !== 'submitting' && currentStep !== 'success' && (
          <div style={styles.stepIndicatorRow}>
            <div style={styles.partyIndicator}>
              <span style={{ 
                ...styles.partyText, 
                color: currentStep.startsWith('asesor') ? 'var(--primary)' : 'rgba(255,255,255,0.4)' 
              }}>
                1. ASESOR
              </span>
              <div style={{ 
                ...styles.partyLine, 
                backgroundColor: currentStep.startsWith('asesor') ? 'var(--primary)' : 'rgba(255,255,255,0.15)' 
              }} />
            </div>
            <div style={styles.partyIndicator}>
              <span style={{ 
                ...styles.partyText, 
                color: currentStep.startsWith('inquilino') ? '#8b5cf6' : 'rgba(255,255,255,0.4)' 
              }}>
                2. INQUILINO / CLIENTE
              </span>
              <div style={{ 
                ...styles.partyLine, 
                backgroundColor: currentStep.startsWith('inquilino') ? '#8b5cf6' : 'rgba(255,255,255,0.15)' 
              }} />
            </div>
          </div>
        )}

        {/* Visualización de error */}
        {error && (
          <div className="badge badge-danger animate-fade-in" style={{ padding: '0.75rem', width: '100%', marginBottom: '1rem', borderRadius: '8px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* ==============================================
            PASO 0: PANTALLA DE BIENVENIDA
            ============================================== */}
        {currentStep === 'welcome' && (
          <div style={styles.centerContent} className="animate-scale-up">
            <ShieldCheck size={56} color="var(--primary)" style={{ marginBottom: '1rem', filter: 'drop-shadow(0 0 10px rgba(0, 171, 216, 0.4))' }} />
            <h2 style={styles.mainTitle}>Firma Biométrica In-App</h2>
            <p style={styles.mainSubtitle}>
              Comenzaremos un proceso seguro y estructurado para registrar la validez legal del acta directamente en este dispositivo físico.
            </p>
            <div style={styles.infoCard} className="glass-card">
              <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#ffffff', display: 'block', marginBottom: '0.5rem' }}>Pruebas a recolectar (Para ambas partes):</span>
              <ul style={styles.infoList}>
                <li>✍ Firma táctil digitalizada sobre pantalla.</li>
                <li>📸 Fotografía facial en vivo (selfie de seguridad).</li>
                <li>🪪 Escaneo frontal de Cédula de Ciudadanía.</li>
              </ul>
            </div>
            <button 
              onClick={() => setCurrentStep('asesor_firma')} 
              className="btn btn-primary animate-pulse" 
              style={styles.startBtn}
            >
              Iniciar Firma en Persona
            </button>
          </div>
        )}

        {/* ==============================================
            PASOS SECUENCIA ASESOR
            ============================================== */}
        {currentStep === 'asesor_firma' && (
          <SignatureCanvas
            title="Firma del Asesor Inmobiliario"
            subtitle="Dibuja tu firma sobre el recuadro blanco."
            onSave={(img) => {
              setAsesorData(prev => ({ ...prev, firma: img }));
              setCurrentStep('asesor_selfie');
            }}
          />
        )}

        {currentStep === 'asesor_selfie' && (
          <FaceCapture
            title="Selfie del Asesor"
            subtitle="Centra tu rostro en el círculo y toma la fotografía."
            onSave={(img) => {
              setAsesorData(prev => ({ ...prev, selfie: img }));
              setCurrentStep('asesor_cedula');
            }}
            onBack={() => setCurrentStep('asesor_firma')}
          />
        )}

        {currentStep === 'asesor_cedula' && (
          <DocumentScanner
            title="Cédula del Asesor"
            subtitle="Encuadra la parte frontal de tu documento de identidad."
            defaultName={asesorData.ocr.nombre_completo || asesorDefaultName}
            defaultId={asesorData.ocr.numero_identidad || asesorDefaultId}
            onSave={(img, ocr) => {
              setAsesorData(prev => ({ ...prev, cedula: img, ocr }));
              setCurrentStep('transition');
            }}
            onBack={() => setCurrentStep('asesor_selfie')}
          />
        )}

        {/* ==============================================
            PASO INTERMEDIO: TRANSICIÓN DE DISPOSITIVO
            ============================================== */}
        {currentStep === 'transition' && (
          <div style={styles.centerContent} className="animate-scale-up">
            <Smartphone size={58} color="#8b5cf6" style={{ marginBottom: '1.25rem', animation: 'bounce 2s infinite' }} />
            <h2 style={styles.mainTitle}>Turno del Inquilino</h2>
            <p style={styles.mainSubtitle}>
              Las pruebas del asesor se guardaron con éxito. Por favor, **entrega este dispositivo móvil al inquilino / cliente** para que continúe su secuencia de firma.
            </p>
            <div style={styles.transitionAlertCard}>
              <UserCheck size={20} color="#8b5cf6" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', color: '#ffffff', lineHeight: 1.4 }}>
                Estimado Cliente: A continuación, el sistema te guiará en la recolección de tu firma, selfie y foto de documento de identidad.
              </span>
            </div>
            <button 
              onClick={() => setCurrentStep('inquilino_firma')} 
              className="btn btn-primary" 
              style={{ ...styles.startBtn, backgroundColor: '#8b5cf6', boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)' }}
            >
              Soy el Inquilino: Iniciar Firma ➔
            </button>
          </div>
        )}

        {/* ==============================================
            PASOS SECUENCIA INQUILINO
            ============================================== */}
        {currentStep === 'inquilino_firma' && (
          <SignatureCanvas
            title="Firma del Inquilino / Cliente"
            subtitle="Por favor, dibuja tu firma táctil sobre el lienzo blanco."
            onSave={(img) => {
              setInquilinoData(prev => ({ ...prev, firma: img }));
              setCurrentStep('inquilino_selfie');
            }}
            onBack={() => setCurrentStep('transition')}
          />
        )}

        {currentStep === 'inquilino_selfie' && (
          <FaceCapture
            title="Selfie del Inquilino"
            subtitle="Centra tu rostro dentro del círculo para la selfie biométrica."
            onSave={(img) => {
              setInquilinoData(prev => ({ ...prev, selfie: img }));
              setCurrentStep('inquilino_cedula');
            }}
            onBack={() => setCurrentStep('inquilino_firma')}
          />
        )}

        {currentStep === 'inquilino_cedula' && (
          <DocumentScanner
            title="Cédula del Inquilino"
            subtitle="Encuadra la parte frontal de tu documento sobre el recuadro."
            defaultName={inquilinoData.ocr.nombre_completo || inquilinoDefaultName}
            defaultId={inquilinoData.ocr.numero_identidad || inquilinoDefaultId}
            onSave={(img, ocr) => {
              setInquilinoData(prev => ({ ...prev, cedula: img, ocr }));
              submitBiometrics(img, ocr);
            }}
            onBack={() => setCurrentStep('inquilino_selfie')}
          />
        )}

        {/* ==============================================
            PASO SUBMITTING: ESPERA / CARGA ESMERILADA
            ============================================== */}
        {currentStep === 'submitting' && (
          <div style={styles.centerContent} className="animate-fade-in">
            <Loader2 size={52} className="animate-spin" color="var(--primary)" style={{ marginBottom: '1.25rem' }} />
            <h3 style={styles.loadingTitle}>Consolidando Acta Biométrica</h3>
            <p style={styles.loadingSubtitle}>
              Cifrando firmas, empaquetando selfies y escaneos de identidad. Subiendo evidencias a Supabase Storage y actualizando el inventario...
            </p>
          </div>
        )}

        {/* ==============================================
            PASO SUCCESS: FINALIZADO CON ÉXITO
            ============================================== */}
        {currentStep === 'success' && (
          <div style={styles.centerContent} className="animate-scale-up">
            <div style={styles.successIndicatorCircle}>
              <ShieldCheck size={42} color="#ffffff" />
            </div>
            <h3 style={{ ...styles.loadingTitle, color: '#10b981', marginTop: '1rem' }}>¡Firma Registrada Exitosamente!</h3>
            <p style={styles.loadingSubtitle}>
              El inventario de entrega y sus tareas operativas han sido marcados como **Completados** de forma biométrica in-app. Refrescando datos...
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  fullscreenOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.93)', // Fondo oscuro denso para aislar
    backdropFilter: 'blur(14px) saturate(180%)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    overflowY: 'auto',
  },
  closeBtn: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    zIndex: 10000,
  },
  wizardCard: {
    width: '100%',
    maxWidth: '560px',
    minHeight: '430px',
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderRadius: '24px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    padding: '1.75rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    position: 'relative',
    backdropFilter: 'blur(10px)',
  },
  stepIndicatorRow: {
    display: 'flex',
    gap: '1rem',
    width: '100%',
    marginBottom: '1.25rem',
  },
  partyIndicator: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  partyText: {
    fontSize: '0.68rem',
    fontWeight: '800',
    letterSpacing: '0.5px',
    transition: 'color 0.2s',
  },
  partyLine: {
    height: '3px',
    borderRadius: '2px',
    width: '100%',
    transition: 'background-color 0.3s',
  },
  centerContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '1rem',
  },
  mainTitle: {
    fontSize: '1.65rem',
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: '0.5rem',
  },
  mainSubtitle: {
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.7)',
    lineHeight: '1.5',
    marginBottom: '1.5rem',
  },
  infoCard: {
    padding: '1rem 1.25rem',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    textAlign: 'left',
    width: '100%',
    marginBottom: '1.5rem',
  },
  infoList: {
    listStyleType: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    fontSize: '0.82rem',
    color: 'rgba(255,255,255,0.8)',
  },
  startBtn: {
    padding: '0.8rem 1.75rem',
    fontSize: '0.98rem',
    borderRadius: '12px',
    boxShadow: '0 4px 15px rgba(0, 171, 216, 0.4)',
    cursor: 'pointer',
    fontWeight: '700',
    width: '100%',
    maxWidth: '320px',
  },
  transitionAlertCard: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: '12px',
    textAlign: 'left',
    marginBottom: '1.75rem',
  },
  loadingTitle: {
    fontSize: '1.3rem',
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: '0.5rem',
  },
  loadingSubtitle: {
    fontSize: '0.85rem',
    color: 'rgba(255,255,255,0.65)',
    lineHeight: '1.55',
    maxWidth: '400px',
  },
  successIndicatorCircle: {
    width: '76px',
    height: '76px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 25px rgba(16, 185, 209, 0.6)',
  }
};
