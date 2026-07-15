'use client';

import { useState } from 'react';
import { Camera, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhotosGalleryProps {
  imagenes: string[] | any;
  /** 'bar' = botón plano para la barra de acciones de la tarjeta feed */
  variant?: 'default' | 'bar';
}

export default function PhotosGallery({ imagenes, variant = 'default' }: PhotosGalleryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Sanitizar entrada de imagenes
  let imageList: string[] = [];
  if (Array.isArray(imagenes)) {
    imageList = imagenes.map(img => typeof img === 'string' ? img : img?.imagen).filter(Boolean);
  }

  if (imageList.length === 0) {
    if (variant === 'bar') {
      return (
        <span style={{ ...styles.barBtn, color: 'var(--text-muted)', cursor: 'default' }}>
          <Camera size={14} />
          Sin fotos
        </span>
      );
    }
    return null;
  }

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === 0 ? imageList.length - 1 : prev - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === imageList.length - 1 ? 0 : prev + 1));
  };

  return (
    <>
      {variant === 'bar' ? (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(true);
          }}
          style={styles.barBtn}
          title="Ver galería de fotos"
        >
          <Camera size={14} color="var(--primary)" />
          Fotos ({imageList.length})
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(true);
          }}
          className="btn btn-secondary"
          style={styles.photosBtn}
        >
          <Camera size={14} color="var(--primary)" />
          Fotos ({imageList.length})
        </button>
      )}

      {isOpen && (
        <div 
          onClick={() => setIsOpen(false)} 
          style={styles.overlay}
          className="animate-fade-in"
        >
          <div 
            onClick={(e) => e.stopPropagation()} 
            style={styles.modal}
            className="glass-container animate-fade-in"
          >
            {/* Cabecera */}
            <div style={styles.header}>
              <span style={styles.title}>Galería de Fotos</span>
              <button 
                onClick={() => setIsOpen(false)} 
                style={styles.closeBtn}
                title="Cerrar"
              >
                <X size={18} color="var(--text-primary)" />
              </button>
            </div>

            {/* Contenedor del Carrusel */}
            <div style={styles.carouselContainer}>
              <img 
                src={imageList[currentIndex]} 
                alt={`Foto ${currentIndex + 1}`} 
                style={styles.image}
              />

              {/* Botón Anterior */}
              {imageList.length > 1 && (
                <button 
                  onClick={handlePrev} 
                  style={styles.navBtnLeft}
                  title="Anterior"
                >
                  <ChevronLeft size={24} color="var(--primary)" />
                </button>
              )}

              {/* Botón Siguiente */}
              {imageList.length > 1 && (
                <button 
                  onClick={handleNext} 
                  style={styles.navBtnRight}
                  title="Siguiente"
                >
                  <ChevronRight size={24} color="var(--primary)" />
                </button>
              )}

              {/* Indicador de Posición */}
              <div style={styles.indicator}>
                {currentIndex + 1} / {imageList.length}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  photosBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.4rem 0.85rem',
    fontSize: '0.8rem',
  },
  barBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.35rem',
    padding: '0.6rem 0.5rem',
    fontSize: '0.78rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(8px)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
  },
  modal: {
    maxWidth: '900px',
    width: '100%',
    backgroundColor: 'var(--bg-primary)',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.25rem',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s',
  },
  carouselContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16/10',
    backgroundColor: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  navBtnLeft: {
    position: 'absolute',
    left: '1rem',
    width: '45px',
    height: '45px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    backdropFilter: 'blur(4px)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
    boxShadow: 'var(--shadow-md)',
  },
  navBtnRight: {
    position: 'absolute',
    right: '1rem',
    width: '45px',
    height: '45px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    backdropFilter: 'blur(4px)',
    border: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
    boxShadow: 'var(--shadow-md)',
  },
  indicator: {
    position: 'absolute',
    bottom: '1rem',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    backdropFilter: 'blur(4px)',
    color: '#ffffff',
    padding: '0.35rem 0.85rem',
    borderRadius: '50px',
    fontSize: '0.8rem',
    fontWeight: '700',
  },
};
