import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refrescar el token del usuario y verificar sesión
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  
  // Proteger rutas del panel y recursos
  const isDashboard = pathname.startsWith('/dashboard') || 
                      pathname.startsWith('/inmuebles') || 
                      pathname.startsWith('/inventarios');
                      
  const isAuth = pathname.startsWith('/login') || 
                 pathname.startsWith('/registro-inmobiliaria');

  if (isDashboard && !user) {
    const url = new URL('/login', request.url);
    // Conservar la URL original para redirigir después de loguearse
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isAuth && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirigir la raíz al login o dashboard
  if (pathname === '/') {
    if (user) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    } else {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf)$).*)',
  ],
};
