-- =====================================================================
-- MIGRACIÓN: la cita sabe de qué lead de Kommo viene, y si de verdad se
-- confirmó
-- Fecha: 2026-10-02
--
-- EL FALLO
-- "Confirmar citas" manda las citas a n8n, y n8n busca al cliente en Kommo
-- POR TELÉFONO. Desde que WhatsApp deja escribir con un usuario (@) sin
-- mostrar el número, Kommo crea esos contactos SIN teléfono: la búsqueda no
-- los encuentra, n8n crea un lead nuevo sin el chat del cliente, y la cita
-- nunca se confirma en el lead verdadero. Medido el 2 oct en las últimas 15
-- tandas: 20 de 59 citas (34 %) terminaron así, todas reportadas como éxito.
--
-- LO QUE AÑADE
-- 1. kommo_lead_id / kommo_contact_id: el lead de la conversación que
--    agendó la cita. El agente ya lo recibe en cada mensaje; ahora lo deja
--    en la cita, y la confirmación lo usa directo, sin buscar por teléfono.
-- 2. confirmacion_error / confirmacion_fallida_at: hasta hoy la plataforma
--    marcaba "Confirmada" toda cita enviada, saliera o no. Ahora solo marca
--    las que n8n confirma, y deja escrito por qué falló cada una de las demás.
--
-- Columnas aparte de `estado`, igual que confirmada_at: el ciclo de vida de
-- la cita y el contrato del agente no cambian. anon ya tiene REVOKE ALL
-- sobre citas, así que nada de esto se le expone.
-- =====================================================================

ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS kommo_lead_id           text,
  ADD COLUMN IF NOT EXISTS kommo_contact_id        text,
  ADD COLUMN IF NOT EXISTS confirmacion_error      text,
  ADD COLUMN IF NOT EXISTS confirmacion_fallida_at timestamptz;

COMMENT ON COLUMN public.citas.kommo_lead_id IS
  'Lead de Kommo de la conversación que agendó la cita. La confirmación lo usa directo: buscar por teléfono falla con los contactos que escriben con usuario (@).';
COMMENT ON COLUMN public.citas.kommo_contact_id IS
  'Contacto de Kommo de la conversación que agendó la cita.';
COMMENT ON COLUMN public.citas.confirmacion_error IS
  'Por qué falló el último intento de confirmación, tal como lo devolvió n8n. NULL si se confirmó o nunca se intentó.';
COMMENT ON COLUMN public.citas.confirmacion_fallida_at IS
  'Cuándo falló el último intento de confirmación.';

-- ---------------------------------------------------------------------
-- Las citas pendientes que ya agendó el agente
--
-- El lead sale de la conversación que las creó: la cita aparece en el
-- registro de herramientas (herramientas_usadas) del mensaje del agente que
-- la agendó, también cuando el agente detectó que ya existía (ya_existia).
--
-- Solo las que todavía se pueden confirmar —agendadas, de hoy en adelante—.
-- En las viejas, el lead actual de la conversación puede no ser el que tenía
-- al agendar, y escribir un dato dudoso en el histórico es peor que dejarlo
-- vacío.
--
-- El id se saca con una expresión regular sobre el texto de `salida`, no con
-- un cast a jsonb: `salida` a veces es un objeto y a veces un texto con JSON
-- adentro, y el cast de un texto mal formado tumbaría la migración entera.
-- ---------------------------------------------------------------------
WITH llamadas AS (
  SELECT substring(
           h->>'salida'
           from '"cita_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"'
         ) AS cita_id,
         conv.kommo_lead_id,
         conv.kommo_contact_id,
         m.created_at
    FROM public.agente_comercial_mensajes m
    JOIN public.agente_comercial_conversaciones conv ON conv.id = m.conversacion_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(m.herramientas_usadas) = 'array'
           THEN m.herramientas_usadas
           ELSE '[]'::jsonb
      END) h
   WHERE m.rol = 'agente'
     AND h->>'nombre' = 'agendar_cita'
     AND conv.kommo_lead_id IS NOT NULL
), agendadas AS (
  -- Si la misma cita aparece en varios mensajes, manda el más reciente.
  SELECT DISTINCT ON (cita_id)
         cita_id::uuid AS cita_id, kommo_lead_id, kommo_contact_id
    FROM llamadas
   WHERE cita_id IS NOT NULL
   ORDER BY cita_id, created_at DESC
)
UPDATE public.citas c
   SET kommo_lead_id    = a.kommo_lead_id,
       kommo_contact_id = a.kommo_contact_id
  FROM agendadas a
 WHERE c.id = a.cita_id
   AND c.kommo_lead_id IS NULL
   AND c.estado = 'agendada'
   AND c.fecha >= (now() AT TIME ZONE 'America/Bogota')::date;

NOTIFY pgrst, 'reload schema';
