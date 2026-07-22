// Diagnóstico (admin-only): devuelve los `available_filters` de la búsqueda de
// inmuebles de Mercado Libre, para descubrir los ids exactos de operación,
// tipo, "dueño directo" y ubicación y fijarlos en FILTROS_ML. Requiere que la
// inmobiliaria ya haya conectado Mercado Libre (hay token). Uso puntual:
//   GET /api/agentes/captaciones/explorar-filtros

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { explorarFiltros } from '@/lib/agente-captaciones/sources/mercadolibre';

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const filtros = await explorarFiltros(admin, user.profile.inmobiliaria_id);
    return NextResponse.json(filtros);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
