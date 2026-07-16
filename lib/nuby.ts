export interface NubyProperty {
  codigo: number | string;
  titulo: string;
  clase_id?: number | string;
  clase_inmueble?: string;
  tipo_servicio_id?: string;
  tipo_servicio?: string;
  asesor_id?: string;
  asesor?: string;
  direccion: string;
  valor_arriendo1?: number;
  valor_arriendo2?: number;
  valor_venta1?: number;
  valor_venta2?: number;
  observaciones?: string;
  estado: number;
  estado_texto?: string;
  // Ubicación: la ciudad real viene en `municipio` (NO existe `ciudad`).
  municipio?: string;
  barrio?: string;
  area?: string;            // metros cuadrados como string, ej. "52.00"
  estrato_texto?: string;   // "Dos", "Tres", "Cuatro"...
  edificio_unidad?: string | null; // campo de unidad del ERP (vacío en esta instancia)
  // Habitaciones/baños NO son top-level: viven en `caracteristicas[]` como
  // { descripcion: "Nº De Habitaciones" | "Nº De Baños", valor: "3" }. "-1" = sin dato.
  caracteristicas?: Array<{ descripcion?: string; valor?: string; [k: string]: any }>;
  [key: string]: any;
}

export interface NubyConfig {
  instancia: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Obtiene las credenciales de Nuby/Arrendasoft desde las variables de entorno o parámetros.
 */
export function getNubyConfig(overrides?: Partial<NubyConfig>): NubyConfig {
  const rawInstancia = overrides?.instancia || process.env.NUBY_API_INSTANCIA || 'invosadia.arrendasoft.co';
  // Limpiar http://, https:// y barras diagonales finales
  const cleanInstancia = rawInstancia.replace(/^(https?:\/\/)?/, '').replace(/\/$/, '');
  
  return {
    instancia: cleanInstancia,
    clientId: overrides?.clientId || process.env.NUBY_CLIENT_ID || '',
    clientSecret: overrides?.clientSecret || process.env.NUBY_CLIENT_SECRET || '',
  };
}

/**
 * Autentica con la API de Nuby/Arrendasoft para obtener un JWT temporal (válido por 1 hora).
 *
 * OJO: la ruta difiere de la documentación oficial de Nuby. En los despliegues
 * *.arrendasoft.co (como el nuestro) el login vive en /auth/login y recibe
 * {username, password}; la ruta documentada /login con {client_id, client_secret}
 * devuelve 405 ahí. Probamos primero la que funciona en producción y dejamos la
 * documentada como respaldo por si la instancia migra al dominio nuby.app.
 */
export async function obtenerTokenJWT(config: NubyConfig): Promise<string> {
  const { instancia, clientId, clientSecret } = config;

  if (!instancia) {
    throw new Error('La dirección de la instancia de Arrendasoft/Nuby no está configurada.');
  }

  // Si no se proporcionaron credenciales, se advierte y no se intenta autenticar (podría ser público)
  if (!clientId || !clientSecret) {
    console.warn('Advertencia: Faltan NUBY_CLIENT_ID o NUBY_CLIENT_SECRET. Se intentará acceder públicamente sin token.');
    return '';
  }

  const intentos = [
    {
      url: `https://${instancia}/service/v2/public/auth/login`,
      body: { username: clientId, password: clientSecret },
    },
    {
      url: `https://${instancia}/service/v2/public/login`,
      body: { client_id: clientId, client_secret: clientSecret },
    },
  ];

  const errores: string[] = [];

  for (const intento of intentos) {
    try {
      const res = await fetch(intento.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(intento.body),
        cache: 'no-store',
      });

      if (!res.ok) {
        const errorText = await res.text();
        errores.push(`${intento.url} → ${res.status}: ${errorText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      // El campo también varía por despliegue: `token` en arrendasoft.co, `jwt` en la doc oficial.
      const token = data.token || data.jwt || data.access_token;
      if (token) return token;

      errores.push(`${intento.url} → 200 pero sin campo token/jwt en la respuesta`);
    } catch (error: any) {
      errores.push(`${intento.url} → ${error.message}`);
    }
  }

  const mensaje = `No se pudo autenticar con Nuby/Arrendasoft:\n${errores.join('\n')}`;
  console.error(mensaje);
  throw new Error(mensaje);
}

/**
 * Obtiene el listado de propiedades desde Arrendasoft/Nuby.
 * Soporta de forma resiliente tanto el endpoint oficial documentado (/properties/list)
 * como el endpoint del ejemplo real (/properties).
 */
export async function fetchPropiedadesNuby(
  config: NubyConfig,
  token?: string,
  page: number = 1,
  pageSize: number = 50
): Promise<NubyProperty[]> {
  const { instancia } = config;

  // Usaremos el endpoint que demostró funcionar en producción en el ejemplo real
  // pero mantendremos la opción de consultar /properties/list con fallback
  const endpoints = [
    `https://${instancia}/service/v2/public/properties`,
    `https://${instancia}/service/v2/public/properties/list`
  ];

  let lastError: any = null;

  for (const url of endpoints) {
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
        page_size: pageSize.toString(),
      });

      const fullUrl = `${url}?${queryParams.toString()}`;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log(`Consultando API de Nuby: ${fullUrl}`);
      
      const res = await fetch(fullUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
        next: { revalidate: 0 }
      });

      if (!res.ok) {
        throw new Error(`Endpoint ${url} devolvió estatus ${res.status}`);
      }

      const rawData = await res.json();
      
      // Desencapsular de forma resiliente
      if (Array.isArray(rawData)) {
        return rawData;
      }
      
      if (rawData && typeof rawData === 'object') {
        if (Array.isArray(rawData.body)) {
          return rawData.body;
        }
        if (Array.isArray(rawData.data)) {
          return rawData.data;
        }
        if (Array.isArray(rawData.properties)) {
          return rawData.properties;
        }
      }

      console.warn(`La respuesta de ${url} no tiene formato de arreglo conocido:`, rawData);
    } catch (err: any) {
      console.warn(`Falla al consultar endpoint ${url}:`, err.message);
      lastError = err;
    }
  }

  // Si fallan ambos, arrojamos el último error o devolvemos un arreglo vacío
  throw lastError || new Error('No se pudo conectar a ninguno de los endpoints de propiedades de Nuby.');
}

/**
 * Traduce el tipo de inmueble de Nuby a la categoría de nuestro sistema
 */
export function mapearTipoInmueble(claseInmueble?: string): 'casa' | 'apartamento' | 'lote' | 'local' | 'bodega' | 'oficina' | 'otro' {
  if (!claseInmueble) return 'otro';
  
  const tipoNormalized = claseInmueble.toLowerCase().trim();
  
  if (tipoNormalized.includes('apartamento') || tipoNormalized.includes('apto') || tipoNormalized.includes('apartaestudio')) {
    return 'apartamento';
  }
  if (tipoNormalized.includes('casa')) {
    return 'casa';
  }
  if (tipoNormalized.includes('lote') || tipoNormalized.includes('terreno')) {
    return 'lote';
  }
  if (tipoNormalized.includes('local')) {
    return 'local';
  }
  if (tipoNormalized.includes('bodega')) {
    return 'bodega';
  }
  if (tipoNormalized.includes('oficina') || tipoNormalized.includes('consultorio')) {
    return 'oficina';
  }
  
  return 'otro';
}

export interface NubyContract {
  id?: number | string;
  propiedad_id: number | string;
  propiedad?: string;
  propietario?: string;
  propietarios_id?: string;
  inquilino?: string;
  inquilinos_id?: string;
  canon_total?: number;
  estado?: string;
  estado_id?: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  fecha_terminacion?: string;
  [key: string]: any;
}

/**
 * Obtiene el listado de contratos desde Arrendasoft/Nuby.
 */
export async function fetchContratosNuby(
  config: NubyConfig,
  token?: string,
  page: number = 1,
  pageSize: number = 1000
): Promise<NubyContract[]> {
  const { instancia } = config;
  const url = `https://${instancia}/service/v2/public/contracts/list`;

  try {
    const queryParams = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });

    const fullUrl = `${url}?${queryParams.toString()}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`Consultando Contratos de Nuby: ${fullUrl}`);
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      next: { revalidate: 0 }
    });

    if (!res.ok) {
      throw new Error(`Endpoint de contratos devolvió estatus ${res.status}`);
    }

    const rawData = await res.json();

    // Desencapsular de forma resiliente
    if (Array.isArray(rawData)) {
      return rawData;
    }
    
    if (rawData && typeof rawData === 'object') {
      if (Array.isArray(rawData.body)) {
        return rawData.body;
      }
      if (Array.isArray(rawData.data)) {
        return rawData.data;
      }
      if (Array.isArray(rawData.contracts)) {
        return rawData.contracts;
      }
    }

    console.warn('La respuesta de contratos no tiene formato de arreglo conocido:', rawData);
    return [];
  } catch (err: any) {
    console.warn('Falla al consultar endpoint de contratos:', err.message);
    return [];
  }
}
