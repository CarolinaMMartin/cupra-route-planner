

# Plan: Ajuste Final de Scroll Interno en DroppableColumn

## Problema Identificado

Las clases de scroll interno en `DroppableColumn` (línea 1002) no tienen prefijos responsive:

```typescript
// Actual (línea 1002)
className={`space-y-2 min-h-[400px] max-h-[600px] overflow-y-auto transition-colors ${...}`}
```

Aunque el kanban completo está oculto en mobile con `hidden md:block`, las buenas prácticas indican que estas clases deberían tener prefijos `md:` como medida de seguridad adicional.

## Cambio Propuesto

**Archivo:** `src/components/vendedor/VendedorKanban.tsx`

**Línea 1002** - Agregar prefijos `md:` a las clases de altura y scroll:

```typescript
// Antes
className={`space-y-2 min-h-[400px] max-h-[600px] overflow-y-auto transition-colors ${
  isOver ? 'bg-accent/10' : ''
}`}

// Después
className={`space-y-2 md:min-h-[400px] md:max-h-[600px] md:overflow-y-auto transition-colors ${
  isOver ? 'bg-accent/10' : ''
}`}
```

## Justificación

1. **Defensivo**: Si por algún edge case el kanban se renderizara en mobile, no generará scroll interno
2. **Consistente**: Sigue el patrón de diseño responsive del resto del componente
3. **Sin impacto en desktop**: En `md:` y superiores, las clases se aplican igual que antes

## Checklist de Validación Post-Implementación

1. En 375px: no existe scroll horizontal
2. No hay scroll interno dentro de columnas/listas (solo scroll de página)
3. Se puede: abrir detalle, marcar "Visitado" (abre feedback, guarda, mueve card a Visitado)
4. Desktop no cambia: sigue 2 columnas con drag and drop y scroll interno

