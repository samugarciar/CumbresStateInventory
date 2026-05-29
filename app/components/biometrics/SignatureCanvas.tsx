'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Trash2, Check, PenTool } from 'lucide-react';

interface SignatureCanvasProps {
  title: string;
  subtitle: string;
  onSave: (base64Image: string) => void;
  onBack?: () => void;
}

export default function SignatureCanvas({ title, subtitle, onSave, onBack }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Ajustar resolución del canvas para High-DPI / Retina Displays
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#0f172a'; // Slate 900 para firma elegante y legible
    }
    setIsEmpty(true);
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    // Si es evento táctil
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    }
    
    // Si es evento de mouse
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setIsEmpty(false);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Reiniciar configuraciones después de borrar
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#0f172a';

    setIsEmpty(true);
  };

  const confirmSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || isEmpty) return;

    // Obtener la firma como imagen Base64 (PNG)
    const base64Png = canvas.toDataURL('image/png');
    onSave(base64Png);
  };

  return (
    <div style={styles.container} className="animate-scale-up" ref={containerRef}>
      <header style={styles.header}>
        <div style={styles.badgeRow}>
          <span className="badge badge-info" style={styles.badge}>
            <PenTool size={11} style={{ marginRight: '3px' }} /> PASO 1: FIRMA DIGITAL
          </span>
        </div>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>{subtitle}</p>
      </header>

      {/* Caja contenedora del Canvas */}
      <div style={styles.canvasContainer}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          style={styles.canvas}
        />
        {isEmpty && (
          <div style={styles.placeholder}>
            <PenTool size={36} color="var(--text-muted)" style={{ marginBottom: '0.75rem', opacity: 0.5 }} />
            <span>Dibuja tu firma táctil en este recuadro</span>
          </div>
        )}
      </div>

      {/* Botones de acción inferiores */}
      <footer style={styles.footer}>
        {onBack && (
          <button onClick={onBack} className="btn btn-secondary" style={styles.btnAction}>
            Volver
          </button>
        )}
        
        <button 
          onClick={clear} 
          className="btn btn-secondary" 
          style={{ ...styles.btnAction, color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
          disabled={isEmpty}
        >
          <Trash2 size={16} />
          Limpiar
        </button>

        <button 
          onClick={confirmSignature} 
          className="btn btn-primary" 
          style={{ 
            ...styles.btnAction, 
            opacity: isEmpty ? 0.6 : 1,
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            backgroundColor: isEmpty ? 'var(--text-muted)' : 'var(--primary)' 
          }}
          disabled={isEmpty}
        >
          <Check size={16} />
          Confirmar Firma
        </button>
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
  canvasContainer: {
    position: 'relative',
    width: '100%',
    height: '280px',
    backgroundColor: '#ffffff', // Lienzo blanco premium tipo papel
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
    overflow: 'hidden',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'crosshair',
    touchAction: 'none', // SÚPER CRÍTICO: Previene scroll y zoom táctil mientras dibuja
  },
  placeholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    fontWeight: '500',
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
