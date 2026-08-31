-- =====================================================================
-- MIGRACIÓN: resolver_inmuebles_por_texto — código del ERP y palabras de ruido
-- Fecha: 2026-08-28   (v2 — corrige la primera versión de este mismo archivo)
--
-- ⚠️ SI YA CORRISTE LA v1 DE ESTE ARCHIVO: vuelve a correrlo. La v1 escribía
-- sobre la firma de UN argumento —la de junio, que 2026-07-09 ya había
-- reemplazado— y por lo tanto (a) dejaba una función huérfana conviviendo con
-- la buena, lo que hacía que PostgREST respondiera 300 Multiple Choices al
-- llamar la RPC por HTTP, y (b) no cambiaba nada en producción, porque TODOS
-- los llamadores usan la forma de dos argumentos. Este archivo borra la
-- huérfana y aplica los cambios donde corresponde.
--
-- POR QUÉ
-- Este resolver es la fuente única del matching por texto: lo usan
-- consultar_disponibilidad_por_texto, agendar_cita_por_texto,
-- solicitar_apertura_agenda y (desde el 26/ago) obtener_fotos. Cuando falla,
-- el cliente no consigue cita.
--
-- Caso real del 28/ago (Luis Casallas, Luna del Valle): el agente tenía la
-- franja real (hoy 14:30-15:00, asesora GISELA ORTIZ) y los datos del cliente,
-- y aun así no quedó cita. Llamó a solicitar_apertura_de_agenda con el texto
-- "Luna del Valle piso 5", que no resuelve. El salvavidas de esa RPC
-- (ya_disponible → "no pidas apertura, agenda directo") NO alcanzó a actuar
-- porque se evalúa DESPUÉS de resolver el inmueble. En 2 semanas: 8 de 301
-- conversaciones tenían franja disponible, pidieron apertura y no agendaron;
-- el salvavidas solo actuó 2 veces.
--
-- DOS HUECOS QUE SE CIERRAN
--
-- 1) "piso" no era ruido. El resolver exige que TODOS los tokens aparezcan en
--    titulo+direccion+unidad+barrio+ciudad, y "piso" no está en ninguno.
--    Igual pasaba con torre, bloque, interior, edificio, urbanización.
--
-- 2) El código del ERP no se buscaba, y encima se borraba. `arrendasoft_id` no
--    estaba en el haystack, así que un código nunca matcheaba; por eso en
--    agosto se agregó un candado en TypeScript que quitaba los códigos de 5+
--    dígitos del texto. Pero cuando el código es lo ÚNICO que distingue un
--    apartamento de otro, borrarlo vuelve el texto ambiguo:
--    "Villas del Sol 2026198" → "Villas del Sol" → 3 candidatos → se rechaza.
--    Eso fue 16 de los 53 fallos de resolución de las últimas 2 semanas.
--
-- POR QUÉ EL CÓDIGO SE COMPARA EXACTO Y NO COMO SUBCADENA
-- Meter arrendasoft_id dentro del texto concatenado habría creado falsos
-- positivos: el nº de apto "510" aparece DENTRO del código "2025106". Por eso
-- un token de 5+ dígitos se compara por igualdad contra arrendasoft_id, y
-- cualquier otro token sigue buscándose como subcadena. Verificado sobre los
-- 79 disponibles con "unidad + nº de apto": 0 regresiones.
--
-- SEGUNDA PASADA
-- Si el texto completo no da nada y traía un código, se reintenta sin él. Así
-- un código viejo o inexistente sigue cayendo al nombre del edificio, que es
-- lo que hacía el candado de TypeScript — que queda libre para retirarse.
--
-- PRECIO EFECTIVO
-- Devuelve COALESCE(precio_oferta, precio), igual que el resto del sistema
-- desde 2026-08-28_precio_oferta.sql, y ordena por ese mismo valor.
--
-- Firma, columnas y orden idénticos a 2026-07-09: ningún llamador cambia.
-- Idempotente.
-- =====================================================================

-- Huérfana que dejó la v1 de este archivo (firma de junio). Sin esto, PostgREST
-- no sabe cuál de las dos elegir y responde 300 al llamar la RPC por HTTP.
DROP FUNCTION IF EXISTS public.resolver_inmuebles_por_texto(TEXT);

CREATE OR REPLACE FUNCTION public.resolver_inmuebles_por_texto(
    p_texto TEXT,
    p_tipo_transaccion TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, titulo TEXT, direccion TEXT, unidad TEXT,
    tipo_transaccion TEXT, precio NUMERIC, habitaciones INTEGER, banos INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_norm    TEXT;
    v_tokens  TEXT[];
    v_sin_cod TEXT[];
    v_filas   INT;
    v_stop    TEXT[] := ARRAY[
        'del','las','los','una','con','sin','por','que',
        'apartamento','apto','casa','local','oficina','bodega','lote',
        'arriendo','venta','alquiler','inmueble','propiedad',
        -- Ruido que describe la ubicación pero no vive en ninguna columna:
        -- "Luna del Valle piso 5", "Torre 4 Vidanta", "unidad Mi Mundo".
        'piso','torre','bloque','interior','unidad','edificio',
        'urbanizacion','urb','conjunto','apartaestudio'
    ];
BEGIN
    IF trim(p_texto) IS NULL OR trim(p_texto) = '' THEN
        RETURN;
    END IF;

    v_norm := unaccent(lower(trim(p_texto)));

    SELECT ARRAY(
        SELECT t
        FROM unnest(regexp_split_to_array(v_norm, '\s+')) AS t
        WHERE length(t) >= 3
          AND NOT (t = ANY(v_stop))
    ) INTO v_tokens;

    -- Si todo era ruido, caer al texto completo normalizado
    IF array_length(v_tokens, 1) IS NULL THEN
        v_tokens := ARRAY[ v_norm ];
    END IF;

    -- 1ª pasada: TODOS los tokens. Un token de 5+ dígitos es un código del ERP
    -- y se compara exacto contra arrendasoft_id; el resto, como subcadena.
    RETURN QUERY
    SELECT i.id, i.titulo, i.direccion, i.unidad, i.tipo_transaccion,
           COALESCE(i.precio_oferta, i.precio), i.habitaciones, i.banos
    FROM inmuebles i
    WHERE i.estado = 'disponible'
      AND (p_tipo_transaccion IS NULL OR i.tipo_transaccion = p_tipo_transaccion)
      AND (
          SELECT bool_and(
              unaccent(lower(
                  COALESCE(i.titulo,    '') || ' ' ||
                  COALESCE(i.direccion, '') || ' ' ||
                  COALESCE(i.unidad,    '') || ' ' ||
                  COALESCE(i.barrio,    '') || ' ' ||
                  COALESCE(i.ciudad,    '')
              )) ILIKE '%' || tok || '%'
              OR (tok ~ '^\d{5,}$' AND tok = i.arrendasoft_id::text)
          )
          FROM unnest(v_tokens) AS tok
      )
    ORDER BY COALESCE(i.precio_oferta, i.precio), i.titulo;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas > 0 THEN
        RETURN;
    END IF;

    -- 2ª pasada: sin los códigos del ERP (código viejo, de otra inmobiliaria o
    -- inventado por el modelo). Solo corre si había alguno y queda algo útil.
    SELECT ARRAY(
        SELECT t FROM unnest(v_tokens) AS t WHERE t !~ '^\d{5,}$'
    ) INTO v_sin_cod;

    IF array_length(v_sin_cod, 1) IS NULL OR v_sin_cod = v_tokens THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT i.id, i.titulo, i.direccion, i.unidad, i.tipo_transaccion,
           COALESCE(i.precio_oferta, i.precio), i.habitaciones, i.banos
    FROM inmuebles i
    WHERE i.estado = 'disponible'
      AND (p_tipo_transaccion IS NULL OR i.tipo_transaccion = p_tipo_transaccion)
      AND (
          SELECT bool_and(
              unaccent(lower(
                  COALESCE(i.titulo,    '') || ' ' ||
                  COALESCE(i.direccion, '') || ' ' ||
                  COALESCE(i.unidad,    '') || ' ' ||
                  COALESCE(i.barrio,    '') || ' ' ||
                  COALESCE(i.ciudad,    '')
              )) ILIKE '%' || tok || '%'
          )
          FROM unnest(v_sin_cod) AS tok
      )
    ORDER BY COALESCE(i.precio_oferta, i.precio), i.titulo;
END;
$$;
