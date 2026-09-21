-- =====================================================================
-- MIGRACIÓN: el canal propio de WhatsApp (Cloud API de Meta)
-- Fecha: 2026-09-21
--
-- POR QUÉ EXISTE
-- El número de WhatsApp está hoy dentro de Kommo, que actúa de BSP: los
-- mensajes entran por ahí, n8n los reenvía al agente y las respuestas
-- vuelven por el mismo camino. Samuel decidió el 17 sep sacarlo y hablar
-- con la Cloud API de Meta directamente.
--
-- Esta migración prepara `public` para recibir ese tráfico. El código que
-- la usa —el webhook y el emisor— llega en el mismo cambio, pero no puede
-- funcionar hasta que el número esté registrado en Meta.
--
-- LAS TRES COSAS QUE FALTABAN, Y LO QUE CADA UNA DESBLOQUEA
--
-- 1 · UN MENSAJE ESCRITO POR UNA PERSONA NO TIENE DÓNDE IR.
--     `rol` solo admite 'usuario' y 'agente'. Medido en el CRM: hay 7.819
--     mensajes salientes y TODOS son del bot, porque las respuestas de los
--     asesores se escriben en Kommo y no llegan aquí. Esa ceguera ya
--     bloqueó tres cosas: medir el ghosteo, saber si alguien atendió tras
--     escalar, y distinguir "el cliente calló" de "la charla se mudó".
--     Con 'asesor' el hueco se cierra solo, porque el trigger de
--     proyección del CRM lleva la fila a crm.actividades sin código nuevo.
--
-- 2 · EL IDENTIFICADOR DE MENSAJE DE META (`wamid`).
--     Sirve para dos cosas distintas y las dos hacen falta: Meta REINTENTA
--     los webhooks, así que sin él el mismo mensaje entraría dos veces; y
--     los acuses de entrega llegan después, referidos a ese id, así que es
--     la única forma de casar "entregado" con la fila que salió.
--
-- 3 · DE DÓNDE VINO EL LEAD.
--     Es el motivo de fondo para ir directo a Meta. Los anuncios de
--     click-to-WhatsApp mandan un objeto `referral` en el PRIMER mensaje
--     de la conversación, y solo ahí: no hay endpoint para preguntarlo
--     después. Hoy `contactos.origen` dice qué trigger creó la fila, no de
--     dónde viene la persona — Meta Ads, MercadoLibre y un referido entran
--     los tres como 'whatsapp'. Cada día de canal vivo sin estas columnas
--     son leads permanentemente sin atribución.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Que un asesor pueda hablar
--
-- Se amplía el CHECK en vez de añadir una columna `autor` aparte: `rol`
-- ya significa "quién habla" y tiene dos valores; el tercero es el que
-- faltaba. Una columna nueva obligaría a cambiar todas las lecturas.
-- ---------------------------------------------------------------------
ALTER TABLE public.agente_comercial_mensajes
  DROP CONSTRAINT IF EXISTS agente_comercial_mensajes_rol_check;

ALTER TABLE public.agente_comercial_mensajes
  ADD CONSTRAINT agente_comercial_mensajes_rol_check
    CHECK (rol IN ('usuario', 'agente', 'asesor'));

COMMENT ON COLUMN public.agente_comercial_mensajes.rol IS
  'Quién habla: usuario (el cliente), agente (el bot), asesor (una persona del equipo escribiendo desde el CRM).';

-- ---------------------------------------------------------------------
-- 2 · El identificador de Meta
--
-- Único y PARCIAL: los 16.742 mensajes del histórico entraron por Kommo y
-- no tienen wamid. Un único normal los haría chocar entre sí por NULL en
-- algunos motores; el parcial los deja fuera y solo vigila lo nuevo.
-- ---------------------------------------------------------------------
ALTER TABLE public.agente_comercial_mensajes
  ADD COLUMN IF NOT EXISTS wa_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS agente_comercial_mensajes_wamid
  ON public.agente_comercial_mensajes (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

COMMENT ON COLUMN public.agente_comercial_mensajes.wa_message_id IS
  'El id de Meta (wamid). Evita duplicar cuando Meta reintenta el webhook, y es lo que casa los acuses de entrega con la fila que salió.';

-- ---------------------------------------------------------------------
-- 3 · De dónde vino
--
-- Va en la CONVERSACIÓN y no en el mensaje porque describe el origen de
-- la relación, no de una frase suelta: llega una vez, en el primer
-- mensaje, y vale para todo lo que venga después.
--
-- Se guarda el objeto entero además de los dos campos que se consultan.
-- Meta añade campos con el tiempo y no vamos a migrar cada vez; y cuando
-- dentro de un año alguien pregunte "¿qué anuncio era ese?", la respuesta
-- estará en el jsonb aunque nadie hubiera previsto la pregunta.
-- ---------------------------------------------------------------------
ALTER TABLE public.agente_comercial_conversaciones
  ADD COLUMN IF NOT EXISTS referral_source_id text,
  ADD COLUMN IF NOT EXISTS referral_ctwa_clid text,
  ADD COLUMN IF NOT EXISTS referral jsonb;

CREATE INDEX IF NOT EXISTS agente_comercial_conversaciones_referral
  ON public.agente_comercial_conversaciones (referral_source_id)
  WHERE referral_source_id IS NOT NULL;

COMMENT ON COLUMN public.agente_comercial_conversaciones.referral_source_id IS
  'El identificador del anuncio de Meta que trajo a esta persona. Llega SOLO en el primer mensaje: si no se guarda ahí, no se recupera nunca.';

COMMENT ON COLUMN public.agente_comercial_conversaciones.referral_ctwa_clid IS
  'Click ID de click-to-WhatsApp. Es lo que permite cerrar el ciclo con el gasto de la campaña.';

-- ---------------------------------------------------------------------
-- 4 · Qué número es el nuestro
--
-- Meta identifica el número por `phone_number_id`, no por el número en sí.
-- Guardarlo aquí es lo que permitirá que una sola aplicación atienda a
-- varias inmobiliarias el día que haga falta, sin adivinar a quién
-- pertenece un mensaje entrante.
-- ---------------------------------------------------------------------
ALTER TABLE public.inmobiliarias
  ADD COLUMN IF NOT EXISTS wa_phone_number_id text;

CREATE UNIQUE INDEX IF NOT EXISTS inmobiliarias_wa_phone_number_id
  ON public.inmobiliarias (wa_phone_number_id)
  WHERE wa_phone_number_id IS NOT NULL;

COMMENT ON COLUMN public.inmobiliarias.wa_phone_number_id IS
  'El phone_number_id de la Cloud API de Meta. Es como llega identificado el número en cada webhook entrante.';
