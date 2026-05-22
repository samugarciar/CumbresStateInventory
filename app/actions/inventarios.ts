'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function registrarInventario(inmuebleId: string, titulo: string, items: any) {
  if (!inmuebleId || !titulo || !items) {
    return { success: false, error: 'El inmueble, el título y los contenidos son obligatorios.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión de usuario no válida.' };

  const { error } = await supabase
    .from('inventarios')
    .insert({
      inmueble_id: inmuebleId,
      titulo,
      items,
      creado_por: user.id,
    });

  if (error) {
    return { success: false, error: `Error de base de datos: ${error.message}` };
  }

  revalidatePath('/inventarios');
  revalidatePath('/dashboard');
  return { success: true, message: 'El inventario ha sido guardado exitosamente.' };
}
