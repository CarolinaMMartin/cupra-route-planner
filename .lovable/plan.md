
# Plan Mejorado: Rediseño Mobile de "Mis Clientes Asignados"

## Incorporación del Feedback Técnico

He revisado el código y acepto los 4 puntos del feedback. El plan ahora incluye:

1. **Layout 100% CSS responsive** (sin depender del hook para layout)
2. **Eliminar estilos de scroll interno** en mobile
3. **Reusar la función real de update** (no solo abrir dialog)
4. **Renderizado condicional simple** en lugar de TabsContent dual

---

## Archivo a Modificar

| Archivo | Cambios |
|---------|---------|
| `src/components/vendedor/VendedorKanban.tsx` | Layout responsive, acciones compactas, lista mobile con estado local, menú contextual |

---

## Cambios Detallados

### 1. Estado Local para Tab Activo (más eficiente que TabsContent)

Agregar estado simple para controlar qué lista mostrar en mobile:

```typescript
const [mobileActiveTab, setMobileActiveTab] = useState<'Por visitar' | 'Visitado'>('Por visitar');
```

Esto evita renderizar ambas listas y problemas de hydration.

### 2. Wrapper Principal: Eliminar Overflow Horizontal

Línea 935 actual:
```typescript
<div className="space-y-4">
```

Cambiar a:
```typescript
<div className="space-y-4 overflow-x-hidden">
```

### 3. Header Responsive (Líneas 936-981)

El header actual tiene 4 botones en línea que desbordan en mobile.

**Nuevo layout:**

```typescript
<div className="flex flex-col gap-4">
  {/* Título */}
  <div>
    <h2 className="text-xl md:text-2xl font-bold">Mis Clientes Asignados</h2>
    <p className="text-sm text-muted-foreground">
      {viewMode === 'kanban' 
        ? 'Toca un cliente para ver detalles'
        : 'Visualiza la ubicación de tus clientes'}
    </p>
  </div>
  
  {/* Acciones - responsive */}
  <div className="flex flex-wrap items-center gap-2">
    {/* Botón primario siempre visible */}
    <Button
      variant="default"
      onClick={() => setShowAgregarProspecto(true)}
      size="sm"
      className="gap-2"
    >
      <Plus className="w-4 h-4" />
      <span className="hidden sm:inline">Agregar Prospecto</span>
      <span className="sm:hidden">Prospecto</span>
    </Button>
    
    {/* Toggle Kanban/Mapa - siempre visible (importante para operación) */}
    <div className="flex items-center border rounded-md">
      <Button
        variant={viewMode === 'kanban' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setViewMode('kanban')}
        className="rounded-r-none"
      >
        <Columns className="w-4 h-4" />
      </Button>
      <Button
        variant={viewMode === 'map' ? 'default' : 'ghost'}
        size="sm"
        onClick={() => setViewMode('map')}
        className="rounded-l-none"
      >
        <MapIcon className="w-4 h-4" />
      </Button>
    </div>
    
    {/* Desktop: Auto-asignar visible */}
    <Button
      variant="outline"
      onClick={() => setShowAutoAsignar(true)}
      size="sm"
      className="gap-2 hidden md:flex"
    >
      <UserPlus className="w-4 h-4" />
      Auto-asignar
    </Button>
    
    {/* Mobile: Auto-asignar en menú overflow */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setShowAutoAsignar(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Auto-asignar cliente
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</div>
```

### 4. Vista Kanban Responsive (Líneas 984-1009)

**Problema actual:** `DroppableColumn` tiene `min-h-[400px] max-h-[600px] overflow-y-auto` (línea 905) que genera scroll interno.

**Solución:**

```typescript
{viewMode === 'kanban' ? (
  <>
    {/* DESKTOP: Kanban con drag & drop (md+) */}
    <div className="hidden md:block">
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-2 gap-4">
          <DroppableColumn id="Por visitar" title="Por visitar" clientes={assignments['Por visitar']} />
          <DroppableColumn id="Visitado" title="Visitado" clientes={assignments['Visitado']} />
        </div>
        <DragOverlay>
          {activeCliente ? <ClientCard cliente={activeCliente} /> : null}
        </DragOverlay>
      </DndContext>
    </div>

    {/* MOBILE: Tabs + Lista simple (<md) */}
    <div className="md:hidden">
      {/* Segmented control para cambiar estado */}
      <div className="flex border rounded-lg p-1 bg-muted mb-4">
        <button
          onClick={() => setMobileActiveTab('Por visitar')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            mobileActiveTab === 'Por visitar' 
              ? 'bg-background shadow-sm' 
              : 'text-muted-foreground'
          }`}
        >
          Por visitar ({assignments['Por visitar'].length})
        </button>
        <button
          onClick={() => setMobileActiveTab('Visitado')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            mobileActiveTab === 'Visitado' 
              ? 'bg-background shadow-sm' 
              : 'text-muted-foreground'
          }`}
        >
          Visitado ({assignments['Visitado'].length})
        </button>
      </div>
      
      {/* Lista - solo renderiza la activa */}
      <div className="space-y-3">
        {assignments[mobileActiveTab].length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            {mobileActiveTab === 'Por visitar' 
              ? 'Sin clientes por visitar' 
              : 'Sin visitas completadas'}
          </p>
        ) : (
          assignments[mobileActiveTab].map(cliente => (
            <MobileClientCard 
              key={cliente.id} 
              cliente={cliente}
              onInfoClick={() => handleCardClick(cliente)}
              onMarkVisited={mobileActiveTab === 'Por visitar' 
                ? () => handleMobileMarkVisited(cliente) 
                : undefined}
            />
          ))
        )}
      </div>
    </div>
  </>
) : (
  <VendedorAssignmentsMap assignments={assignments} />
)}
```

### 5. Componente MobileClientCard (Nuevo)

Agregar dentro del archivo, antes de `DroppableColumn`:

```typescript
const MobileClientCard = ({ 
  cliente, 
  onInfoClick,
  onMarkVisited,
}: { 
  cliente: ClienteAsignado; 
  onInfoClick: () => void;
  onMarkVisited?: () => void;
}) => {
  const esProspecto = cliente.etiquetas?.includes('Prospecto');
  const diasAbierto = cliente.created_at 
    ? Math.floor((Date.now() - new Date(cliente.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const mostrarAlertaPendiente = diasAbierto >= 2 && cliente.estado === 'Por visitar';
  
  return (
    <Card 
      id={`assignment-${cliente.id}`}
      className="p-3"
    >
      <div className="flex items-start gap-3">
        {/* Contenido clickeable para info */}
        <div 
          className="flex-1 min-w-0 cursor-pointer" 
          onClick={onInfoClick}
        >
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-sm truncate">{cliente.razon_social}</h4>
            {esProspecto && <Badge variant="secondary" className="text-xs shrink-0">NUEVO</Badge>}
          </div>
          
          {cliente.canal && esProspecto && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Building className="w-3 h-3 shrink-0" />
              <span className="truncate">{cliente.canal}</span>
            </p>
          )}
          
          {cliente.barrio_principal && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{cliente.barrio_principal}</span>
            </p>
          )}
          
          {cliente.telefonos?.[0] && (
            <a 
              href={`tel:${cliente.telefonos[0]}`}
              className="text-xs text-primary flex items-center gap-1 mt-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Phone className="w-3 h-3 shrink-0" />
              {cliente.telefonos[0]}
            </a>
          )}
          
          {mostrarAlertaPendiente && (
            <div className="flex items-center gap-1.5 mt-2 p-1.5 bg-amber-50 dark:bg-amber-950/30 rounded text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium">{diasAbierto} días sin cerrar</span>
            </div>
          )}
        </div>
        
        {/* Botón para marcar visitado (alternativa táctil al drag) */}
        {onMarkVisited && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onMarkVisited();
            }}
            className="shrink-0 h-8 px-3"
          >
            Marcar ✓
          </Button>
        )}
      </div>
    </Card>
  );
};
```

### 6. Handler para Marcar Visitado desde Mobile

Este es el punto clave del feedback: **reusar el flujo real**, no solo abrir dialog.

La función `handleDragEnd` (línea 397-401) ya hace exactamente esto cuando el destino es "Visitado":
```typescript
if (newEstado === 'Visitado') {
  setSelectedCliente(movedCliente);
  setShowFeedbackDialog(true);
  return;
}
```

Entonces, el handler mobile debe hacer lo mismo:

```typescript
const handleMobileMarkVisited = (cliente: ClienteAsignado) => {
  // Reutiliza exactamente el mismo flujo que el drag & drop
  setSelectedCliente(cliente);
  setShowFeedbackDialog(true);
};
```

Esto garantiza que:
- Se abre el dialog de feedback obligatorio
- Al guardar, ejecuta `handleSaveFeedback` que:
  - Inserta en `cliente_feedbacks`
  - Actualiza `estado: 'Visitado'` y `visited_at`
  - Actualiza la UI

### 7. Importaciones Adicionales

Agregar al inicio del archivo:

```typescript
import { MoreHorizontal, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

---

## Resumen de Decisiones Técnicas

| Feedback Recibido | Decisión Tomada |
|-------------------|-----------------|
| No depender de `useIsMobile` para layout | Layout 100% con clases Tailwind (`hidden md:block`, `md:hidden`) |
| Eliminar overflow interno en mobile | No se usa `DroppableColumn` en mobile; lista simple sin `max-h` ni `overflow-y-auto` |
| Botón debe llamar misma función que drag | `handleMobileMarkVisited` hace exactamente `setSelectedCliente + setShowFeedbackDialog` |
| TabsContent puede tener problemas | Uso estado local `mobileActiveTab` y renderizado condicional simple |
| Vista Mapa visible, no en menú | Toggle Kanban/Mapa siempre visible (importante para operación) |

---

## Validaciones Post-Implementación

1. Viewport iPhone 375px: sin scroll horizontal
2. Segmented control muestra counts correctos dinámicamente
3. Botón "Marcar ✓" abre dialog de feedback y completa el flujo
4. Al guardar feedback, la card se mueve a tab "Visitado"
5. Desktop sigue funcionando igual (drag & drop intacto)
6. No hay hydration mismatch (layout no depende de hook)
