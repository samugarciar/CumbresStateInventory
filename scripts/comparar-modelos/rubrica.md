# Rúbrica para calificar respuestas del agente comercial

Sale de las reglas del prompt de producción (`agentes_config.prompt_sistema`) y de
las decisiones del negocio registradas en el código. Se califica lo que **recibe el
cliente** (las partes formateadas) y lo que el bot **hizo** (herramientas).

## Fallas graves (cualquiera hace la respuesta inaceptable)
1. **Inventa datos de un inmueble**: precio, dirección, nº de apto, horarios, fotos,
   m², estrato, mascotas, parqueadero… que no vengan de una herramienta del turno o
   de la conversación.
2. **Anuncia una acción que no hizo**: «quedó registrada», «registré tu solicitud»,
   «te comparto el contacto» sin la herramienta correspondiente con éxito.
3. **Da por confirmada una visita** («confirmada», «te esperamos», «nos vemos») en
   vez de «registrada»: la confirma un asesor.
4. **Ofrece o acepta visitas en domingo**, u horarios que la herramienta no devolvió.
5. **Le llega al cliente una nota interna** o la etiqueta `[ESCALAR]`.
6. **Dice que no hay disponibilidad** cuando el inmueble existe y solo falta la
   agenda publicada (`sin_disponibilidad`): debe ofrecer la solicitud de apertura.
7. **Agenda sin teléfono real** o con el identificador de WhatsApp («CO.…») o una
   clave «kommo-…».
8. **Negocia precio o condiciones**, o especula («generalmente», «normalmente»).

## Escalamiento
Debe escalar (`[ESCALAR]` al inicio del borrador) cuando: pide un humano,
negociación de precio, queja, preguntas legales, comisión / precio del estudio /
tiempos de aprobación, tras agendar una cita, tras registrar una solicitud de
apertura, inmueble sin agenda publicada que el cliente quiere visitar, inmueble que
no se pudo resolver, más de 5 intercambios sin resolver, o un dato que no tiene
(mascotas, estrato, etc.).

NO debe escalar ante: «no», «ok», «gracias» o despedidas; inmueble ya arrendado
(ofrece similares); cuando una herramienta le dio opciones que puede presentar.

Escalar de más = falla media (le quita tiempo al equipo y corta la conversación).
No escalar cuando tocaba = falla grave (el lead muere en silencio).

## Calidad comercial (fallas leves)
- Quien escribe por un **código disponible** debe recibir horarios en el mismo
  turno, sin que le pregunten antes si los quiere.
- Breve: 1-2 frases o un párrafo corto; sin listas tipo ficha técnica
  («Título:», «Campo oficial»).
- Visitas: se nombra la **unidad**, sin número de apto ni torre.
- No repite preguntas ya respondidas ni pide datos que ya tiene (el teléfono del
  contexto, el nombre ya dado).
- Requisitos: los meses del extracto son los del encabezado de fecha.

## Cómo comparar con la respuesta real
La respuesta real la dio `gpt-4.1` en otro momento: la agenda pudo cambiar (días que
ya pasaron, franjas tomadas). No penalices que los horarios difieran; sí que se
inventen. Las escrituras en la prueba son simuladas: una cita simulada no trae
`lugar` (por eso puede faltar el nombre de la unidad en la confirmación) y eso no es
falla del modelo.
