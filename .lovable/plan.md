
# Plan: Corregir KPIs, Resumen por Vendedor y Agregar Columna de Detalle

## Problemas Identificados

### 1. KPIs - Falta tarjeta "No Visitadas"
Actualmente solo hay 4 tarjetas: Total, Pendientes, Visitadas, Tasa. Falta una tarjeta específica para "No visitadas" (asignaciones cerradas pero sin visita real).

### 2. Resumen por Vendedor - No incluye "No visitado"
La tabla solo muestra: Asignadas, Pendientes, Visitadas. Falta columna para "No visitado" (cerradas sin visita efectiva).

### 3. Tabla Detalle - Falta info contextual junto a Tipo Cierre
El usuario quiere ver "Tipo de Interacción" o "Motivo No Visita" directamente en la tabla, no solo en el modal.

## Archivo a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/pages/SupervisionVendedores.tsx` | Agregar KPI, columna en resumen, columna en detalle |

## Cambios Técnicos

### 1. Actualizar Interface `VendedorStats` (linea 38-46)

Agregar campo para "no visitadas":

```typescript
interface VendedorStats {
  vendedor_id: string;
  nombre: string;
  email: string;
  total: number;
  pendientes: number;
  visitadas: number;
  noVisitadas: number;  // NUEVO
  tasa: number;
}
```

### 2. Actualizar Cálculo de Stats (linea 296-335)

Agregar conteo de "No visitado":

```typescript
statsMap.set(a.vendedor_id, {
  // ... campos existentes ...
  noVisitadas: 0,  // NUEVO
  // ...
});

if (a.estado === "Visitado") {
  const feedback = feedbacksMap.get(feedbackKey);
  if (feedback) {
    if (feedback.visita_realizada) {
      stats.visitadas++;
    } else {
      stats.noVisitadas++;  // Cambiar de pendientes a noVisitadas
    }
  } else {
    stats.visitadas++;
  }
} else {
  stats.pendientes++;
}
```

### 3. Actualizar KPIs Globales (linea 411-418)

Agregar cálculo de "No visitadas":

```typescript
const kpis = useMemo(() => {
  const total = vendedorStats.reduce((sum, v) => sum + v.total, 0);
  const pendientes = vendedorStats.reduce((sum, v) => sum + v.pendientes, 0);
  const visitadas = vendedorStats.reduce((sum, v) => sum + v.visitadas, 0);
  const noVisitadas = vendedorStats.reduce((sum, v) => sum + v.noVisitadas, 0);  // NUEVO
  const tasa = total > 0 ? (visitadas / total) * 100 : 0;
  return { total, pendientes, visitadas, noVisitadas, tasa };
}, [vendedorStats]);
```

### 4. Agregar Import de Icono (linea 6-15)

Agregar `XCircle` para la tarjeta de No visitadas:

```typescript
import { 
  ArrowLeft, Users, CheckCircle2, Clock, TrendingUp, Filter, RefreshCw, Eye,
  XCircle  // NUEVO
} from "lucide-react";
```

### 5. Agregar Tarjeta KPI "No Visitadas" (después de linea 631)

Nueva tarjeta entre "Visitadas" y "Tasa Cumplimiento":

```tsx
<Card className="matte-card">
  <CardContent className="pt-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">No Visitadas</p>
        <p className="text-3xl font-bold text-rose-500">{kpis.noVisitadas}</p>
      </div>
      <XCircle className="h-8 w-8 text-rose-500" />
    </div>
  </CardContent>
</Card>
```

### 6. Actualizar Grid de KPIs (linea 596)

Cambiar de 4 a 5 columnas:

```tsx
<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
```

### 7. Agregar Columna en Resumen por Vendedor (linea 656-692)

Agregar columna "No Visitadas":

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Vendedor</TableHead>
    <TableHead className="text-center">Asignadas</TableHead>
    <TableHead className="text-center">Pendientes</TableHead>
    <TableHead className="text-center">Visitadas</TableHead>
    <TableHead className="text-center">No Visitadas</TableHead>  {/* NUEVO */}
    <TableHead className="text-center">Tasa %</TableHead>
  </TableRow>
</TableHeader>

// Y en el body:
<TableCell className="text-center text-rose-500">{stat.noVisitadas}</TableCell>
```

### 8. Agregar Columna "Detalle Cierre" en Tabla de Detalle (linea 709-788)

Nueva columna después de "Tipo Cierre" que muestra Tipo de Interacción o Motivo:

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Cliente/Prospecto</TableHead>
    <TableHead>Vendedor</TableHead>
    <TableHead className="text-center">F. Asignación</TableHead>
    <TableHead className="text-center">F. Visita</TableHead>
    <TableHead className="text-center">Tipo Cierre</TableHead>
    <TableHead>Detalle</TableHead>  {/* NUEVO */}
    <TableHead className="text-center">Estado</TableHead>
    <TableHead className="text-center">Acciones</TableHead>
  </TableRow>
</TableHeader>

// Y en cada fila, después de Tipo Cierre:
<TableCell className="text-sm max-w-[200px]">
  {a.tipo_cierre === 'No visitado' ? (
    <span className="text-amber-600 truncate block" title={a.motivo_no_visita || undefined}>
      {a.motivo_no_visita || '-'}
    </span>
  ) : a.tipo_interaccion ? (
    <span className="text-muted-foreground truncate block" title={a.tipo_interaccion}>
      {a.tipo_interaccion}
    </span>
  ) : (
    <span className="text-muted-foreground text-xs">-</span>
  )}
</TableCell>
```

## Resultado Esperado

### Tarjetas KPI (5 en lugar de 4)
| Total | Pendientes | Visitadas | No Visitadas | Tasa |
|-------|------------|-----------|--------------|------|
| 150   | 50         | 80        | 20           | 53.3% |

### Resumen por Vendedor (6 columnas)
| Vendedor | Asignadas | Pendientes | Visitadas | No Visitadas | Tasa % |
|----------|-----------|------------|-----------|--------------|--------|
| Juan     | 50        | 15         | 30        | 5            | 60%    |

### Detalle de Asignaciones (8 columnas)
| Cliente | Vendedor | F.Asig | F.Visita | Tipo Cierre | Detalle | Estado | Acciones |
|---------|----------|--------|----------|-------------|---------|--------|----------|
| Acme    | Juan     | 01/01  | 02/01    | Online      | Llamada telefonica | check | Ver |
| Beta    | Juan     | 01/01  | 02/01    | No visitado | Cerrado permanentemente | check | Ver |

## Notas
- "Pendientes" = asignaciones sin cerrar (estado != Visitado)
- "No visitadas" = asignaciones cerradas pero con visita_realizada = false
- "Visitadas" = asignaciones cerradas con visita_realizada = true (incluye Online)
- La columna "Detalle" muestra el motivo de no visita (si es No visitado) o el tipo de interaccion (si es Visitado/Online)
