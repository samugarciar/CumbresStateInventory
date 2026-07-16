This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Asesor BI — "Cumbre" (/inteligencia)

Sección de inteligencia comercial integrada en la plataforma (solo admins).
Es un agente LangGraph (`createReactAgent`) con Claude (`claude-opus-4-8` vía
`@langchain/anthropic`) y dos herramientas de solo lectura:

- **consultar_base_datos** — SQL `SELECT` sobre la base de la app con el rol
  `bi_reader` ([lib/bi/db.ts](lib/bi/db.ts)): citas, agenda, solicitudes,
  inventario, captaciones, tareas.
- **consultar_erp** — API pública de Nuby/Arrendasoft
  ([lib/bi/erp.ts](lib/bi/erp.ts)): propiedades, contratos, **facturas/cartera**,
  asesores y auxiliar contable. Los endpoints de escritura del ERP no se exponen.

Piezas: prompt del sistema en [lib/bi/prompt.ts](lib/bi/prompt.ts) (esquema,
reglas de fuentes y formato del brief diario), route handler con streaming
NDJSON en [app/api/inteligencia/route.ts](app/api/inteligencia/route.ts),
chat en [app/(dashboard)/inteligencia/](<app/(dashboard)/inteligencia/>).

### Setup

1. **Migración** (antes de desplegar, como siempre): ejecutar
   [supabase/migrations/2026-07-15_bi_reader.sql](supabase/migrations/2026-07-15_bi_reader.sql)
   en el SQL Editor de Supabase, cambiando la contraseña del rol `bi_reader`.
   No toca los grants del agente n8n (`anon`).
2. **Variables de entorno** (Vercel y `.env.local`):

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   # Session pooler de Supabase con el rol bi_reader:
   BI_DATABASE_URL=postgresql://bi_reader.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
   # (NUBY_API_INSTANCIA / NUBY_CLIENT_ID / NUBY_CLIENT_SECRET ya existen para el sync)

   # Opcional — trazas en LangSmith:
   LANGSMITH_TRACING=true
   LANGSMITH_API_KEY=lsv2_...
   LANGSMITH_PROJECT=cumbres-bi
   ```

3. El route handler declara `maxDuration = 300`; en Vercel requiere Fluid
   Compute (activo por defecto en proyectos nuevos) o plan Pro.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
