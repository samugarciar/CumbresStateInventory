'use server';

import { createClient } from '@/lib/supabase/server';
import type { NubyConfig } from '@/lib/nuby';
import { ejecutarSincronizacionNuby, type SyncResult } from '@/lib/sync-nuby';

export type { SyncResult } from '@/lib/sync-nuby';

/**
 * Server Action para sincronizar inmuebles de Arrendasoft/Nuby con la base de datos local.
 * Este proceso es seguro y se ejecuta completamente del lado del servidor.
 */
export async function sincronizarInmuebles(overrides?: Partial<NubyConfig>): Promise<SyncResult> {
  const supabase = await createClient();

  // 1. Obtener sesión de usuario logueado
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      message: 'Sesión de usuario no válida.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  // 2. Obtener perfil para verificar rol de administrador e inmobiliaria_id
  const { data: profile, error: profileErr } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return {
      success: false,
      message: 'No se pudo verificar el perfil del usuario.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  // Restringir sincronización solo a administradores por motivos de RLS y control de asignaciones
  if (profile.rol !== 'admin') {
    return {
      success: false,
      message: 'Permiso denegado. Solo los administradores pueden realizar la sincronización con el ERP.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  return ejecutarSincronizacionNuby(supabase, profile.inmobiliaria_id, overrides);
}
