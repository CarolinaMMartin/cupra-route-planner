

## Plan: Colapsar secciones en Supervisión de Vendedores

Reorganizar la página para que cada sección sea un Collapsible que se expande/colapsa con una flecha, manteniendo un layout minimalista.

### Estructura vertical (de arriba a abajo)

1. **Header** — sin cambios (titulo + logo)
2. **Filtros** — colapsable, abierto por defecto
3. **Indicadores** (KPIs) — colapsable, abierto por defecto
4. **Activaciones por Vendedor** — colapsable, cerrado por defecto
5. **Resumen por Vendedor** — colapsable, cerrado por defecto
6. **Detalle de Asignaciones** — colapsable, cerrado por defecto

### Implementación

- Usar el componente `Collapsible` de Radix ya disponible en el proyecto
- Cada sección se convierte en un `Collapsible` con un trigger estilizado como barra horizontal con:
  - Icono + titulo de la sección
  - Flecha `ChevronDown` que rota 180° cuando está abierto
- El contenido actual de cada `Card` se mueve al `CollapsibleContent`
- Se elimina el wrapper `Card` → `CardHeader` individual; el trigger del collapsible actúa como header
- Estados: `openFilters`, `openKpis`, `openActividades`, `openResumen`, `openDetalle` con `useState`

### Estilo del trigger

```text
┌──────────────────────────────────────────────────┐
│  🔍 Filtros                                   ▼  │
└──────────────────────────────────────────────────┘
```

Una barra `Card`-like con padding, fondo `matte-card`, hover sutil, y la flecha a la derecha. Al expandir, el contenido aparece debajo sin borde superior extra.

### Archivos a modificar

- `src/pages/SupervisionVendedores.tsx` — refactor de toda la sección de contenido para usar Collapsible en cada bloque

