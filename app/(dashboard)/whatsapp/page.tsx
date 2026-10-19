import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { esEmbudoConectable, requiereConfirmacionCorte } from '@/lib/whatsapp/registro-integrado';
import ConectarWhatsApp, { type EmbudoVista, type LineaVista } from './ConectarWhatsApp';

export const metadata: Metadata = {
  title: 'WhatsApp | Cumbres State Inventory',
};

/**
 * Donde la inmobiliaria conecta su WhatsApp al sistema.
 *
 * Cada embudo (comercial, administrativa, captación) tiene una línea, y
 * una línea entra por el registro integrado de Meta: la persona conecta
 * el número de la app del celular y sigue usándola (coexistencia). Las
 * líneas se ven también en el CRM («Líneas»), que enlaza aquí.
 */
export default async function PaginaWhatsApp({
  searchParams,
}: {
  searchParams: Promise<{ embudo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.profile) redirect('/login');
  // Conectar un número le da a la plataforma su token: solo admins, y el
  // revisor de Meta, que conecta en su inmobiliaria de demostración.
  if (user.profile.rol !== 'admin' && user.profile.rol !== 'revisor') redirect('/dashboard');
  const esRevisor = user.profile.rol === 'revisor';

  const { embudo: embudoPedido } = await searchParams;

  const supabase = await createClient();
  const crm = supabase.schema('crm');
  const [{ data: embudos }, { data: lineas }] = await Promise.all([
    crm.from('embudos').select('codigo, etiqueta, bot_atiende').eq('activo', true).order('orden'),
    crm
      .from('lineas')
      .select(
        'embudo, nombre, telefono_e164, modo, conectada_at, token_invalido_at, historial_solicitado_at, historial_progreso, historial_completado_at, historial_error_codigo, historial_error'
      )
      .eq('activa', true),
  ]);

  // El revisor no ve la comercial: su corte habla de la línea real de Cumbres
  // (número, Kommo y n8n). Solo le quedan los embudos que conecta sin corte.
  const embudosVisibles = ((embudos ?? []) as EmbudoVista[]).filter(
    (e) => !esRevisor || (esEmbudoConectable(e.codigo) && !requiereConfirmacionCorte(e.codigo))
  );

  return (
    <ConectarWhatsApp
      embudos={embudosVisibles}
      lineas={(lineas ?? []) as LineaVista[]}
      embudoPedido={embudoPedido ?? null}
      esRevisor={esRevisor}
    />
  );
}
