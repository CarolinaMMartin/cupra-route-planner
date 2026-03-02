## Analisis UX/UI de la pagina principal del Asignador

### Problemas identificados

**1. Sobrecarga cognitiva en el FilterPanel**
La pantalla muestra simultaneamente 3 secciones numeradas (Area, Filtros de Seleccion, Instrucciones IA) mas la seccion de "Asignaciones de hoy" debajo. El usuario ve:

- Un selector de Area con texto muy largo y dificil de escanear
- Una grilla de checkboxes de vendedores siempre visible (ocupa mucho espacio vertical)
- Filtros geograficos (Provincia, Comuna, Barrio) que se confunden con los filtros del Area
- Instrucciones IA desplegables
- Todo esto ANTES de llegar a las asignaciones del dia

**2. Caminos redundantes y confusos**
Hay dos formas de generar recomendaciones:

- Seleccionar un Area → boton "Generar Recomendaciones con IA"
- Seleccionar vendedores + filtros geograficos manualmente → boton "Generar 8 Recomendaciones con IA"

Ambos hacen lo mismo pero el usuario no sabe cual usar. El Area ya incluye vendedores y barrios, pero los filtros manuales tambien permiten lo mismo, creando confusion.

**3. La seccion "Asignaciones de hoy" queda enterrada**
Es informacion clave (que se asigno hoy) pero aparece debajo de todo el panel de filtros, fuera de la vista inicial.

**4. Post-recomendaciones: doble filtrado**
Cuando se generan recomendaciones, aparece un `RecommendationFilters` con 6 filtros adicionales (3 de recomendaciones + 3 de Places) que duplican conceptos ya usados en el FilterPanel.

---

### Propuesta de rediseno

**Concepto: "Dos acciones claras, informacion a la vista"**

**A. Reorganizar la pagina en dos zonas con Tabs:**

```text
┌─────────────────────────────────────────────┐
│  Panel de Asignacion                        │
│  ┌──────────────┐ ┌──────────────────────┐  │
│  │ Nueva Ronda  │ │ Asignaciones de Hoy  │  │
│  └──────────────┘ └──────────────────────┘  │
│                                             │
│  [Contenido del tab activo]                 │
└─────────────────────────────────────────────┘
```

- **Tab "Nueva asignación"**: El flujo de generar recomendaciones
- **Tab "Asignaciones de Hoy"**: Lo que hoy ya existe (actualmente enterrado abajo)

Esto da visibilidad inmediata a las asignaciones del dia.

**B. Simplificar el flujo de "Nueva Ronda" con dos caminos claros:**

```text
┌─────────────────────────────────────────────┐
│  ¿Como queres generar recomendaciones?      │
│                                             │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │  📋 Por Area     │  │  🔍 Personalizado│  │
│  │  Usa un area     │  │  Elegí vendedores│  │
│  │  predefinida     │  │  y zonas manual  │  │
│  └─────────────────┘  └──────────────────┘  │
│                                             │
│  [Panel del modo seleccionado]              │
└─────────────────────────────────────────────┘
```

- **Por Area**: Solo muestra el selector de Area + boton Generar. Simple y directo.
- **Personalizado**: Muestra vendedores (colapsados por defecto, con resumen "5 de 8 seleccionados") + filtros geograficos en una fila compacta.
- Instrucciones IA: siempre colapsable al final de ambos modos.

**C. Vendedores: de grilla a MultiSelect o Collapsible**

En lugar de mostrar siempre la grilla de checkboxes (que puede tener 8+ vendedores ocupando media pantalla), usar:

- Un componente colapsable que muestre "Vendedores: 5 de 8 seleccionados" con un boton para expandir
- O un MultiSelect con badges como los filtros de Comuna/Barrio

**D. Eliminar el RecommendationFilters duplicado**

Los filtros post-recomendaciones (`RecommendationFilters.tsx`) tienen 6 selectores que confunden. Propuesta:

- Eliminar los filtros duplicados de "Places" (ya se filtraron antes de pedir)
- Dejar solo un buscador de texto + filtro por vendedor para refinar la lista de resultados

---

### Archivos a modificar


| Archivo                                             | Cambio                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/components/AssignorDashboard.tsx`              | Agregar Tabs (Nueva Ronda / Asignaciones de Hoy), reorganizar layout          |
| `src/components/assignor/FilterPanel.tsx`           | Refactorizar en dos modos (Area / Personalizado), colapsar vendedores         |
| `src/components/assignor/RecommendationFilters.tsx` | Simplificar: solo buscador + filtro vendedor                                  |
| `src/components/assignor/TodayAssignments.tsx`      | Adaptar para funcionar como contenido de tab (quitar Card wrapper redundante) |


### Detalle tecnico

- Usar `@radix-ui/react-tabs` (ya instalado) para las tabs principales
- Usar estado local para alternar entre modo "Area" y "Personalizado" con botones tipo toggle o radio cards
- Colapsar vendedores con `Collapsible` (ya usado en el componente)
- Mantener toda la logica de datos existente, solo reorganizar la presentacion