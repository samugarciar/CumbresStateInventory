import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cumbres State Inventory | Gestión Inmobiliaria Premium',
  description: 'Plataforma profesional para la gestión de inmuebles, inventarios detallados y control de asesores comerciales.',
  keywords: 'inmobiliaria, inventarios, inmuebles, gestión inmobiliaria, cumbres, asesores',
  authors: [{ name: 'Cumbres Inmobiliaria' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <meta name="theme-color" content="#0b0f19" />
      </head>
      <body>{children}</body>
    </html>
  );
}
