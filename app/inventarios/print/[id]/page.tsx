import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { Printer, ArrowLeft, Home, Building2, Phone, Mail } from 'lucide-react';
import Link from 'next/link';

interface PrintInventarioPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function PrintInventarioPage({ params }: PrintInventarioPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Obtener el inventario por ID, uniendo con inmueble y usuario creador
  const { data: inv, error } = await supabase
    .from('inventarios')
    .select(`
      id,
      titulo,
      created_at,
      items,
      usuarios (nombre_completo),
      inmuebles (
        titulo,
        direccion,
        precio,
        tipo_inmueble,
        tipo_transaccion
      )
    `)
    .eq('id', id)
    .single();

  if (error || !inv) {
    notFound();
  }

  const { items } = inv as any;
  const inmueble = Array.isArray(inv.inmuebles) ? inv.inmuebles[0] : (inv.inmuebles as any);
  const usuario = Array.isArray(inv.usuarios) ? inv.usuarios[0] : (inv.usuarios as any);
  const datos = items?.datos_generales || {};
  const inquilino = datos.inquilino || {};
  const propietario = datos.propietario || {};
  const llaves = items?.control_llaves?.interiores || {};
  const ext = items?.exteriores || {};
  const observacionesGenerales = items?.observaciones_generales || '';
  const firmas = items?.firmas || {};

  return (
    <div style={styles.container}>
      {/* Estilos específicos de impresión */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
            padding: 0 !important;
          }
          .sheet {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            background: white !important;
          }
          tr {
            page-break-inside: avoid;
          }
        }
      `}} />

      {/* Barra de Acciones Superior */}
      <div className="no-print" style={styles.actionToolbar}>
        <div style={styles.toolbarInner}>
          <Link href="/inventarios" style={styles.backBtn}>
            <ArrowLeft size={16} />
            Volver a Inventarios
          </Link>
          <button 
            onClick={() => window.print()} 
            className="btn btn-primary" 
            style={styles.printBtn}
          >
            <Printer size={16} />
            Imprimir Acta (PDF)
          </button>
        </div>
      </div>

      {/* Hoja de Impresión */}
      <div className="sheet" style={styles.sheet}>
        {/* Encabezado */}
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.logoRow}>
              <Home size={34} color="#00abd8" />
              <div style={styles.logoTextContainer}>
                <span style={styles.logoTitle}>Cumbres</span>
                <span style={styles.logoSubtitle}>INMOBILIARIA</span>
              </div>
            </div>
            <div style={styles.headerContact}>
              <span><Phone size={10} style={{ marginRight: 2 }} /> 230 84 90 - 320 533 82 50</span>
              <span>Calle 50 No. 71-50 Estadio</span>
              <span><Mail size={10} style={{ marginRight: 2 }} /> arrendamientos.cumbres@gmail.com</span>
            </div>
          </div>
          <div style={styles.headerRight}>
            <h1 style={styles.headerDocTitle}>INVENTARIO DE ENTREGA VIVIENDAS</h1>
            <div style={styles.fichaGrid}>
              <div style={styles.fichaBox}>
                <span style={styles.fichaLabel}>FECHA INICIO CONTRATO</span>
                <span style={styles.fichaValue}>{datos.fecha_inicio_contrato || 'N/A'}</span>
              </div>
              <div style={styles.fichaBox}>
                <span style={styles.fichaLabel}>FECHA ELABORACIÓN INVENTARIO</span>
                <span style={styles.fichaValue}>{datos.fecha_elaboracion || 'N/A'}</span>
              </div>
              <div style={styles.fichaBox}>
                <span style={styles.fichaLabel}>FICHA No.</span>
                <span style={styles.fichaValue}>{datos.ficha_no || 'N/A'}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Información Básica */}
        <section style={styles.sectionInfo}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>DIRECCIÓN INMUEBLE:</span>
            <span style={styles.infoValue}>{inmueble?.direccion}</span>
          </div>
          <div style={styles.infoGrid3}>
            <div>
              <span style={styles.infoLabel}>INQUILINO:</span>
              <span style={styles.infoValue}>{inquilino.nombre || 'N/A'}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>TELÉFONO:</span>
              <span style={styles.infoValue}>{inquilino.telefono || inquilino.celular || 'N/A'}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>CORREO:</span>
              <span style={styles.infoValue}>{inquilino.email || 'N/A'}</span>
            </div>
          </div>
          <div style={styles.infoGrid3}>
            <div>
              <span style={styles.infoLabel}>PROPIETARIO:</span>
              <span style={styles.infoValue}>{propietario.nombre || 'N/A'}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>TELÉFONO:</span>
              <span style={styles.infoValue}>{propietario.telefono || propietario.celular || 'N/A'}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>ELABORADO POR:</span>
              <span style={styles.infoValue}>{usuario?.nombre_completo}</span>
            </div>
          </div>
        </section>

        {/* Control de Llaves */}
        <section style={styles.tableSection}>
          <h3 style={styles.tableSectionTitle}>CONTROL DE LLAVES</h3>
          <div style={styles.keysGrid}>
            <div style={styles.keyItem}><strong>Puerta Principal:</strong> {llaves.puerta_principal || '0'}</div>
            <div style={styles.keyItem}><strong>Alcoba Principal:</strong> {llaves.alcoba_principal || '0'}</div>
            <div style={styles.keyItem}><strong>Sencillas:</strong> {llaves.sencillas || '0'}</div>
            <div style={styles.keyItem}><strong>Seguridad:</strong> {llaves.seguridad || '0'}</div>
          </div>
        </section>

        {/* Listado de Zonas en Tablas Compactas */}
        {items?.secciones && Object.keys(items.secciones).map((seccionKey) => {
          const sec = items.secciones[seccionKey];
          if (!sec || !sec.items || Object.keys(sec.items).length === 0) return null;

          // Aplanar nombre de sección para impresión
          const label = seccionKey.replace('_', ' ').toUpperCase();

          return (
            <section key={seccionKey} style={styles.tableSection}>
              <h3 style={styles.tableSectionTitle}>{label}</h3>
              <table style={styles.printTable}>
                <thead>
                  <tr style={styles.printThRow}>
                    <th style={{ ...styles.printTh, width: '45%' }}>Elemento / Artículo</th>
                    <th style={{ ...styles.printTh, width: '15%', textAlign: 'center' }}>B</th>
                    <th style={{ ...styles.printTh, width: '15%', textAlign: 'center' }}>R</th>
                    <th style={{ ...styles.printTh, width: '15%', textAlign: 'center' }}>M</th>
                    <th style={{ ...styles.printTh, width: '25%' }}>Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(sec.items).map((itemKey) => {
                    const status = sec.items[itemKey]?.estado;
                    const obs = sec.items[itemKey]?.obs || '';
                    return (
                      <tr key={itemKey} style={styles.printTr}>
                        <td style={styles.printTdName}>{itemKey}</td>
                        <td style={{ ...styles.printTd, textAlign: 'center', fontWeight: 'bold' }}>{status === 'B' ? '✓' : ''}</td>
                        <td style={{ ...styles.printTd, textAlign: 'center', fontWeight: 'bold' }}>{status === 'R' ? '✓' : ''}</td>
                        <td style={{ ...styles.printTd, textAlign: 'center', fontWeight: 'bold' }}>{status === 'M' ? '✓' : ''}</td>
                        <td style={styles.printTd}>{obs}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {sec.observaciones && (
                <div style={styles.secObs}>
                  <strong>Observaciones Sección:</strong> {sec.observaciones}
                </div>
              )}
            </section>
          );
        })}

        {/* Observaciones Generales */}
        {observacionesGenerales && (
          <section style={styles.tableSection}>
            <h3 style={styles.tableSectionTitle}>OBSERVACIONES GENERALES</h3>
            <div style={styles.obsBox}>
              {observacionesGenerales}
            </div>
          </section>
        )}

        {/* Declaraciones Legales */}
        <section style={styles.legalSection}>
          <p style={styles.legalText}>
            DECLARO HABER RECIBIDO EL INMUEBLE DE ACUERDO CON EL INVENTARIO ANTERIOR, ME COMPROMETO A DEVOLVERLO EN LAS MISMAS CONDICIONES, SALVO EL DETERIORO NATURAL, Y A REPARAR O REEMBOLSAR EL VALOR DE LOS DAÑOS O FALTANTES QUE CAUSEN DURANTE EL TIEMPO QUE PERMANEZCA EL INMUEBLE EN MI PODER.
          </p>
        </section>

        {/* Firmas */}
        <footer style={styles.signaturesFooter}>
          <div style={styles.signatureBox}>
            <div style={styles.signatureLine} />
            <span style={styles.signatureName}>{firmas.arrendador?.nombre || 'Representante Cumbres'}</span>
            <span style={styles.signatureRole}>Por Arrendamientos Cumbres</span>
            <span style={styles.signatureRole}>C.C. {firmas.arrendador?.cc || ''}</span>
          </div>

          <div style={styles.signatureBox}>
            <div style={styles.signatureLine} />
            <span style={styles.signatureName}>{firmas.arrendatario?.nombre || 'Arrendatario'}</span>
            <span style={styles.signatureRole}>El Arrendatario</span>
            <span style={styles.signatureRole}>C.C. {firmas.arrendatario?.cc || ''}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1f2937',
    padding: '2.5rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  actionToolbar: {
    width: '100%',
    maxWidth: '850px',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '1rem 1.5rem',
    marginBottom: '2rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  toolbarInner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#ffffff',
    fontWeight: '600',
    fontSize: '0.9rem',
  },
  printBtn: {
    padding: '0.6rem 1.2rem',
    fontSize: '0.85rem',
  },
  sheet: {
    width: '100%',
    maxWidth: '850px',
    backgroundColor: '#ffffff',
    color: '#000000',
    padding: '3rem',
    boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
    borderRadius: '8px',
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    lineHeight: '1.4',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '2px solid #000000',
    paddingBottom: '1rem',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logoTextContainer: {
    display: 'flex',
    flexDirection: 'column',
  },
  logoTitle: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#00abd8',
    letterSpacing: '-1px',
    lineHeight: '1',
  },
  logoSubtitle: {
    fontSize: '8px',
    fontWeight: '700',
    color: '#000000',
    letterSpacing: '2px',
  },
  headerContact: {
    display: 'flex',
    flexDirection: 'column',
    fontSize: '9px',
    color: '#4b5563',
    gap: '2px',
  },
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.75rem',
  },
  headerDocTitle: {
    fontSize: '14px',
    fontWeight: '800',
    color: '#000000',
    letterSpacing: '0.5px',
  },
  fichaGrid: {
    display: 'flex',
    border: '1px solid #000000',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  fichaBox: {
    padding: '0.35rem 0.65rem',
    borderRight: '1px solid #000000',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '80px',
  },
  fichaLabel: {
    fontSize: '6px',
    fontWeight: 'bold',
    color: '#4b5563',
    marginBottom: '2px',
  },
  fichaValue: {
    fontSize: '10px',
    fontWeight: 'bold',
  },
  sectionInfo: {
    border: '1px solid #000000',
    padding: '0.75rem',
    borderRadius: '4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  infoRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  infoGrid3: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr 1fr',
    gap: '1rem',
  },
  infoLabel: {
    fontWeight: 'bold',
    marginRight: '4px',
  },
  infoValue: {
    borderBottom: '1px dotted #9ca3af',
  },
  tableSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    pageBreakInside: 'avoid',
  },
  tableSectionTitle: {
    fontSize: '10px',
    fontWeight: '800',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    padding: '0.25rem 0.5rem',
    borderRadius: '3px',
  },
  keysGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1rem',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
  },
  keyItem: {
    fontSize: '10px',
  },
  printTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '9px',
  },
  printThRow: {
    borderBottom: '1px solid #000000',
  },
  printTh: {
    padding: '0.35rem',
    textAlign: 'left',
    fontWeight: 'bold',
    color: '#000000',
  },
  printTr: {
    borderBottom: '1px solid #e5e7eb',
  },
  printTd: {
    padding: '0.25rem 0.35rem',
  },
  printTdName: {
    padding: '0.25rem 0.35rem',
    fontWeight: '500',
  },
  secObs: {
    fontSize: '8px',
    color: '#4b5563',
    fontStyle: 'italic',
    marginTop: '0.25rem',
  },
  obsBox: {
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    minHeight: '60px',
    fontSize: '10px',
  },
  legalSection: {
    padding: '0.25rem',
  },
  legalText: {
    fontSize: '8px',
    color: '#374151',
    lineHeight: '1.5',
    textAlign: 'justify',
  },
  signaturesFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '3rem',
    pageBreakInside: 'avoid',
  },
  signatureBox: {
    width: '45%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  signatureLine: {
    width: '100%',
    borderTop: '1px solid #000000',
    marginBottom: '0.5rem',
  },
  signatureName: {
    fontWeight: 'bold',
    fontSize: '10px',
  },
  signatureRole: {
    fontSize: '8px',
    color: '#4b5563',
  },
};
