
# Plan: Agregar botón "Modificar asignaciones" al Empty State

## Problema

Actualmente, cuando no hay asignaciones de hoy (empty state), el componente `TodayAssignments` solo muestra:
- Título "Asignaciones de hoy"
- Descripción "No hay asignaciones realizadas hoy"

El botón **"Modificar asignaciones"** no aparece en este caso, lo cual es incorrecto porque:
1. Es el único acceso del asignador al histórico de asignaciones
2. El empty state solo indica ausencia de asignaciones **hoy**, no ausencia de datos históricos
3. El asignador debería poder acceder siempre a esta funcionalidad

## Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/components/assignor/TodayAssignments.tsx` | Agregar botón al empty state (líneas 270-281) |

## Cambio Específico

### Líneas 270-281 - Agregar botón al empty state

```tsx
// Antes (actual)
if (assignments.length === 0) {
  return (
    <Card className="shadow-medium">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-accent" />
          Asignaciones de hoy
        </CardTitle>
        <CardDescription>No hay asignaciones realizadas hoy</CardDescription>
      </CardHeader>
    </Card>
  );
}

// Después (con botón)
if (assignments.length === 0) {
  return (
    <Card className="shadow-medium">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-accent" />
              Asignaciones de hoy
            </CardTitle>
            <CardDescription>No hay asignaciones realizadas hoy</CardDescription>
          </div>
          {onEditAssignments && (
            <Button onClick={onEditAssignments} variant="outline" className="gap-2">
              <Edit className="w-4 h-4" />
              Modificar asignaciones
            </Button>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
```

## Resultado Esperado

| Estado | Antes | Después |
|--------|-------|---------|
| **Sin asignaciones hoy** | Solo título y descripción | Título, descripción + botón "Modificar asignaciones" |
| **Con asignaciones hoy** | Todos los botones (mapa, modificar, borrar) | Sin cambios |

## Consistencia Visual

El layout del empty state usará la misma estructura `flex items-center justify-between` que usa el header cuando hay asignaciones (línea 287), manteniendo consistencia en la posición del botón.
