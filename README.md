# CUPRA Route Planner

Aplicación para organizar visitas comerciales de una distribuidora de vinos.
Combina cartera propia, reactivación de clientes y prospectos cercanos, con
revisión y asignación humana antes de generar la jornada del vendedor.

## Planificación

El objetivo es ocho visitas por vendedor: cinco clientes activos, dos para
reactivar y un potencial. El asignador puede priorizar estados comerciales y
filtrar por rubro. Las sustituciones y ampliaciones de zona se explican en el
resultado. El radio máximo de búsqueda es 15 km; si faltan destinos elegibles,
se informa la cantidad disponible.

El motor decide mediante reglas explícitas. La IA redacta explicaciones y
puede fallar sin impedir la planificación. Los estados se calculan con la
fecha actual de Argentina: activo hasta 30 días, inactivo hasta 90, perdido
por encima de 90 y potencial sin compras registradas.

## Desarrollo y validación

Requiere Node.js 24 y npm.

```bash
npm ci
npm run dev
npm run check
```

`check` ejecuta la verificación de tipos, las pruebas del motor, las pruebas
transaccionales de PostgreSQL y la compilación de producción. No necesita
credenciales ni datos reales. La configuración pública de desarrollo puede
copiarse de `.env.example`; nunca incluir credenciales de servidor en variables `VITE_*`.

## Estructura

- `supabase/functions/generate-recommendations/`: reglas, candidatos, composición y planificación.
- `supabase/functions/_shared/estado-comercial.ts`: criterio comercial compartido con la interfaz.
- `src/lib/asignaciones.ts`: acceso único al guardado transaccional de visitas.
- `src/components/assignor/`: recomendaciones, asignación manual, mapa y calendario.
- `tests/asignaciones-db.test.mjs`: integridad del guardado y migraciones.

## Publicación

El entorno existente usa [Lovable](https://lovable.dev/projects/4edb6182-f643-40b4-b2af-197de983701b)
y Supabase. Seguir [DESPLIEGUE.md](./DESPLIEGUE.md): migraciones y funciones primero,
frontend después. El detalle de esta revisión está en [REVISION_CLAUDE.md](./REVISION_CLAUDE.md).
