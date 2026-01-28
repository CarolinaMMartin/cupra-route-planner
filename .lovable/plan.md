
# Plan: Mejorar KPIs y Acceso a Feedback en Panel de Supervisión

## Resumen Ejecutivo

El Panel de Supervisión necesita ajustes en dos áreas clave:
1. **KPIs incorrectos**: Actualmente cuentan "Visitado" como estado, pero deberían contar según el tipo de cierre del feedback
2. **Sin acceso al feedback**: La tabla de detalle no muestra el tipo de cierre ni permite ver el feedback registrado

## Análisis del Problema

### Estado Actual

| Componente | Problema |
|------------|----------|
| **KPI Visitadas** | Cuenta solo estado = "Visitado", sin distinguir tipo de cierre |
| **KPI Pendientes** | Cuenta estados != "Visitado" |
| **Tasa Cumplimiento** | Incluye "No visitado" como visitado |
| **Tabla Detalle** | No muestra tipo de cierre ni permite ver el feedback |

### Modelo de Datos Existente

La tabla `cliente_feedbacks` ya contiene los campos necesarios:
- `visita_realizada` (boolean): true = Visitado/Online, false = No visitado
- `tipo_interaccion`: Contiene "[Online]" si fue contacto digital
- `motivo_no_visita`: Razón cuando visita_realizada = false
- `feedback`: Comentario del vendedor
- `actualizar_etiqueta_wa`: Etiqueta WhatsApp asignada

## Archivo a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/pages/SupervisionVendedores.tsx` | KPIs, fetch data, tabla detalle, modal de feedback |

## Cambios Técnicos Detallados

### 1. Extender Interface `AsignacionDetalle` (línea ~39)

Agregar campos para el feedback:

```typescript
interface AsignacionDetalle {
  // ... campos existentes ...
  // Nuevos campos para feedback
  tipo_cierre: 'Visitado' | 'Online' | 'No visitado' | null;
  tipo_interaccion: string | null;
  motivo_no_visita: string | null;
  feedback_texto: string | null;
  actualizar_etiqueta_wa: string | null;
  feedback_fecha: string | null;
}
```

### 2. Modificar `fetchData()` - Agregar Query de Feedbacks (línea ~152)

Después de obtener asignaciones, prospectos y clientes, agregar query para feedbacks:

```typescript
// Obtener feedbacks de las asignaciones visitadas
const asignacionesConFeedback = asignacionesData?.filter(a => a.estado === 'Visitado') || [];
const feedbackClientIds = asignacionesConFeedback
  .filter(a => a.client_id).map(a => a.client_id);
const feedbackProspectoIds = asignacionesConFeedback
  .filter(a => a.prospecto_place_id).map(a => a.prospecto_place_id);

const feedbacksRes = await supabase
  .from('cliente_feedbacks')
  .select('client_id, prospecto_place_id, vendedor_id, visita_realizada, tipo_interaccion, motivo_no_visita, feedback, actualizar_etiqueta_wa, created_at')
  .or(`client_id.in.(${feedbackClientIds.join(',')}),prospecto_place_id.in.(${feedbackProspectoIds.join(',')})`)
  .order('created_at', { ascending: false });
```

### 3. Modificar Cálculo de Stats por Vendedor (línea ~219)

Cambiar la lógica para usar tipo de cierre del feedback:

```typescript
asignacionesData?.forEach(a => {
  // ... código existente para inicializar stats ...
  
  const stats = statsMap.get(a.vendedor_id)!;
  stats.total++;
  
  if (a.estado === "Visitado") {
    // Buscar feedback para determinar tipo de cierre
    const feedback = feedbacksMap.get(getFeedbackKey(a));
    if (feedback) {
      const esOnline = feedback.tipo_interaccion?.startsWith('[Online]');
      if (feedback.visita_realizada) {
        // Visitado o Online = cuenta como visitada
        stats.visitadas++;
      } else {
        // No visitado = cuenta como pendiente
        stats.pendientes++;
      }
    } else {
      // Sin feedback pero estado Visitado (edge case)
      stats.visitadas++;
    }
  } else {
    stats.pendientes++;
  }
});
```

### 4. Mapear Tipo de Cierre en Detalle de Asignaciones (línea ~255)

Al mapear cada asignación, determinar el tipo de cierre:

```typescript
const detalleAsignaciones = asignacionesData?.map(a => {
  // ... código existente ...
  
  // Determinar tipo de cierre basado en feedback
  const feedback = feedbacksMap.get(getFeedbackKey(a));
  let tipoCierre: 'Visitado' | 'Online' | 'No visitado' | null = null;
  
  if (feedback) {
    if (!feedback.visita_realizada) {
      tipoCierre = 'No visitado';
    } else if (feedback.tipo_interaccion?.startsWith('[Online]')) {
      tipoCierre = 'Online';
    } else {
      tipoCierre = 'Visitado';
    }
  }
  
  return {
    // ... campos existentes ...
    tipo_cierre: tipoCierre,
    tipo_interaccion: feedback?.tipo_interaccion?.replace('[Online] ', '') || null,
    motivo_no_visita: feedback?.motivo_no_visita || null,
    feedback_texto: feedback?.feedback || null,
    actualizar_etiqueta_wa: feedback?.actualizar_etiqueta_wa || null,
    feedback_fecha: feedback?.created_at || null,
  };
});
```

### 5. Agregar Estado para Modal de Feedback (después de línea ~66)

```typescript
const [feedbackModal, setFeedbackModal] = useState<AsignacionDetalle | null>(null);
```

### 6. Agregar Imports Necesarios (línea ~6)

```typescript
import { 
  // ... existentes ...
  Eye // Nuevo
} from "lucide-react";
```

### 7. Modificar Tabla de Detalle (línea ~574)

Agregar columna "Tipo Cierre" y botón "Ver feedback":

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Cliente/Prospecto</TableHead>
    <TableHead>Vendedor</TableHead>
    <TableHead className="text-center">F. Asignación</TableHead>
    <TableHead className="text-center">F. Visita</TableHead>
    <TableHead className="text-center">Tipo Cierre</TableHead>
    <TableHead className="text-center">Estado</TableHead>
    <TableHead className="text-center">Acciones</TableHead>
  </TableRow>
</TableHeader>
```

Y en cada fila:

```tsx
{/* Columna Tipo Cierre */}
<TableCell className="text-center">
  {a.tipo_cierre && (
    <Badge 
      variant={a.tipo_cierre === 'Visitado' ? 'default' : a.tipo_cierre === 'Online' ? 'secondary' : 'outline'}
      className={cn(
        a.tipo_cierre === 'Visitado' && 'bg-emerald-500/20 text-emerald-500',
        a.tipo_cierre === 'Online' && 'bg-blue-500/20 text-blue-500',
        a.tipo_cierre === 'No visitado' && 'bg-amber-500/20 text-amber-600'
      )}
    >
      {a.tipo_cierre}
    </Badge>
  )}
</TableCell>

{/* Columna Acciones */}
<TableCell className="text-center">
  {a.tipo_cierre && (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setFeedbackModal(a)}
      className="gap-1"
    >
      <Eye className="h-4 w-4" />
      Ver feedback
    </Button>
  )}
</TableCell>
```

### 8. Agregar Modal de Feedback (antes del cierre del return ~640)

```tsx
{/* Modal Ver Feedback */}
<Dialog open={!!feedbackModal} onOpenChange={() => setFeedbackModal(null)}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Detalle del Feedback</DialogTitle>
      <DialogDescription>
        {feedbackModal?.cliente_nombre}
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground uppercase">Tipo de Cierre</label>
          <p className="font-medium">{feedbackModal?.tipo_cierre || '-'}</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground uppercase">Vendedor</label>
          <p className="font-medium">{feedbackModal?.vendedor_nombre || '-'}</p>
        </div>
      </div>
      
      {feedbackModal?.tipo_interaccion && (
        <div>
          <label className="text-xs text-muted-foreground uppercase">Tipo de Interacción</label>
          <p className="font-medium">{feedbackModal.tipo_interaccion}</p>
        </div>
      )}
      
      {feedbackModal?.motivo_no_visita && (
        <div>
          <label className="text-xs text-muted-foreground uppercase">Motivo No Visita</label>
          <p className="font-medium text-amber-600">{feedbackModal.motivo_no_visita}</p>
        </div>
      )}
      
      {feedbackModal?.feedback_texto && (
        <div>
          <label className="text-xs text-muted-foreground uppercase">Comentario</label>
          <p className="text-sm bg-muted p-3 rounded-lg">{feedbackModal.feedback_texto}</p>
        </div>
      )}
      
      {feedbackModal?.actualizar_etiqueta_wa && (
        <div>
          <label className="text-xs text-muted-foreground uppercase">Etiqueta WhatsApp</label>
          <Badge variant="outline">{feedbackModal.actualizar_etiqueta_wa}</Badge>
        </div>
      )}
      
      {feedbackModal?.feedback_fecha && (
        <div className="text-xs text-muted-foreground text-right">
          Registrado: {formatDate(feedbackModal.feedback_fecha)}
        </div>
      )}
    </div>
  </DialogContent>
</Dialog>
```

### 9. Agregar Import para Dialog (línea ~4)

```typescript
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

## Resultado Esperado

### KPIs Corregidos

| KPI | Antes | Después |
|-----|-------|---------|
| **Total** | Todas las asignaciones | Sin cambios |
| **Visitadas** | estado = "Visitado" | visita_realizada = true (Visitado + Online) |
| **Pendientes** | estado != "Visitado" | estado != "Visitado" OR visita_realizada = false |
| **Tasa** | Visitadas / Total | (Visitadas + Online) / Total |

### Tabla de Detalle Mejorada

Nueva columna "Tipo Cierre" con badges de colores:
- **Verde**: Visitado (visita presencial)
- **Azul**: Online (contacto digital)
- **Ámbar**: No visitado (con motivo)

Nueva columna "Acciones" con botón "Ver feedback" que abre modal con:
- Tipo de cierre
- Vendedor
- Tipo de interacción (si aplica)
- Motivo de no visita (si aplica)
- Comentario
- Etiqueta WhatsApp (si aplica)
- Fecha del feedback

## Notas de Implementación

1. La query de feedbacks se ejecuta solo cuando hay asignaciones visitadas
2. Se usa un Map para lookup eficiente de feedbacks por client_id/prospecto_place_id
3. Los KPIs reflejan el resultado real del cierre, no solo el estado de la asignación
4. El modal es solo lectura, sin acciones de edición
