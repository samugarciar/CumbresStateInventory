'use client';

import React, { useState } from 'react';
import { FileText, PenTool, CheckCircle2 } from 'lucide-react';
import ModalAsociarContrato from './ModalAsociarContrato';
import BiometricSignatureWizard from '@/app/components/biometrics/BiometricSignatureWizard';

interface InventarioActionsProps {
  inventarioId: string;
  hasPendingTasks: boolean;
  arrendasoftContratoId: string | null;
  contratoIdPropuesto: string | null;
  items?: any;
  asesorNombre?: string;
}

export default function InventarioActions({ 
  inventarioId, 
  hasPendingTasks, 
  arrendasoftContratoId, 
  contratoIdPropuesto,
  items = null,
  asesorNombre = 'Asesor Inmobiliario'
}: InventarioActionsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // 1. Validar si el inventario fue firmado BIOMÉTRICAMENTE
  const biometria = items?.biometria;
  const isBiometricamenteFirmado = !!biometria?.inquilino?.firma_url;

  // Extraer información por defecto de la base de datos
  const inquilinoNombre = items?.datos_generales?.inquilino?.nombre || 'Cliente Inquilino';
  const inquilinoId = items?.firmas?.arrendatario?.cc || '';

  // Si ya fue firmado biométricamente, mostramos el badge verde premium
  if (isBiometricamenteFirmado) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge badge-success" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.25)', padding: '0.4rem 0.75rem', fontWeight: 700 }}>
          <CheckCircle2 size={12} /> Firmado Biométricamente
        </span>
        
        {arrendasoftContratoId ? (
          <span className="badge badge-success" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <FileText size={12} /> Contrato: {arrendasoftContratoId}
          </span>
        ) : contratoIdPropuesto ? (
          <span className="badge badge-warning" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#fef08a', color: '#854d0e', border: '1px solid #eab308' }}>
            <FileText size={12} /> Asociación en revisión
          </span>
        ) : (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <FileText size={14} /> Asociar Contrato
          </button>
        )}

        {isModalOpen && (
          <ModalAsociarContrato 
            inventarioId={inventarioId} 
            onClose={() => setIsModalOpen(false)} 
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Botón de Firma digital en Persona In-App (Wizard) */}
      {!isBiometricamenteFirmado && (
        <button
          onClick={() => setIsWizardOpen(true)}
          className="btn animate-scale-up"
          style={{
            padding: '0.48rem 0.95rem',
            fontSize: '0.82rem',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #00abd8 100%)', // Degradado premium de violeta a cyan
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: '0 4px 10px rgba(139, 92, 246, 0.25)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <PenTool size={13} />
          Iniciar Firma en Persona
        </button>
      )}

      {/* Estado o Botón de Asociación de Contrato */}
      {arrendasoftContratoId ? (
        <span className="badge badge-success" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(0, 171, 216, 0.2)', backgroundColor: 'rgba(0, 171, 216, 0.1)', color: '#00abd8', fontWeight: 600 }}>
          <FileText size={12} /> Contrato: {arrendasoftContratoId}
        </span>
      ) : contratoIdPropuesto ? (
        <span className="badge badge-warning" style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#fef08a', color: '#854d0e', border: '1px solid #eab308', fontWeight: 600 }}>
          <FileText size={12} /> Asociación en revisión
        </span>
      ) : (
        <>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn btn-outline"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <FileText size={14} /> Asociar Contrato
          </button>

          {isModalOpen && (
            <ModalAsociarContrato 
              inventarioId={inventarioId} 
              onClose={() => setIsModalOpen(false)} 
            />
          )}
        </>
      )}

      {/* Wizard de Firma Biométrica */}
      {isWizardOpen && (
        <BiometricSignatureWizard
          inventarioId={inventarioId}
          asesorDefaultName={asesorNombre}
          asesorDefaultId="" // Se ingresará manualmente en el OCR
          inquilinoDefaultName={inquilinoNombre}
          inquilinoDefaultId={inquilinoId}
          onClose={() => setIsWizardOpen(false)}
        />
      )}
    </div>
  );
}
