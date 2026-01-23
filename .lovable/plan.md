

# Plan: Vista "Editar Datos de Clientes"

## Resumen Ejecutivo

Crear una nueva página `/clientes-edicion` accesible desde el Dashboard de Consultas, orientada exclusivamente a la edición manual de datos comerciales y de contacto, sin afectar métricas automáticas ni lógica de sincronización geográfica.

---

## Arquitectura de Componentes

```text
┌──────────────────────────────────────────────────────────────────┐
│                     ClientesDashboard.tsx                        │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐ │
│  │ [Editar Datos]  │───>│ navigate('/clientes-edicion')       │ │
│  │    Button       │    │                                     │ │
│  └─────────────────┘    └─────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                   ClientesEdicion.tsx (NUEVA)                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Header: "Editar Datos de Clientes" + [Volver Dashboard]  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Filtros: Búsqueda + Provincia + Ciudad + Vendedor        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   ClientesTable.tsx                       │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ Razón Social │ CUIT │ Vendedor │ Teléfonos │ Edit  │  │   │
│  │  ├────────────────────────────────────────────────────┤  │   │
│  │  │ Cliente 1    │ ...  │ ...      │ ...       │ [✎]   │  │   │
│  │  │ Cliente 2    │ ...  │ ...      │ ...       │ [✎]   │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Click [Editar]
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              EditClienteSheet.tsx (Panel lateral)                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ IDENTIFICACIÓN (solo lectura)                             │   │
│  │ • Razón Social: "Vinoteca XYZ"                           │   │
│  │ • CUIT/DNI: "30-12345678-9"                              │   │
│  │ • Client ID: "CLI-001"                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ EDITABLE                                                  │   │
│  │ • Teléfonos: [input array editable]                      │   │
│  │ • Emails: [input array editable]                         │   │
│  │ • Vendedor Principal: [select con vendedores]            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ AUTOMATIZACIÓN (bloqueado, visual diferenciado)          │   │
│  │ • Requiere Visita: ✓ (disabled)                          │   │
│  │ • Excluir Recomendaciones: ✗ (disabled)                  │   │
│  │ • Motivo Exclusión: — (disabled)                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ UBICACIÓN (solo lectura, fase posterior)                  │   │
│  │ • Provincia: "Ciudad Autónoma de Buenos Aires"           │   │
│  │ • Ciudad: "Buenos Aires"                                 │   │
│  │ • Barrio: "Palermo"                                      │   │
│  │ • Dirección: "Av. Libertador 1234"                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            [Cancelar]            [Guardar Cambios]        │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Categorización de Campos

| Categoría | Campos | Comportamiento |
|-----------|--------|----------------|
| **A) Identificación** | `razon_social`, `cuit_dni`, `client_id`, `fantasia` | Solo lectura (texto gris) |
| **B) Editables** | `telefonos` (array), `emails` (array), `vendedor_principal` | Inputs activos |
| **C) Automatización** | `requiere_visita`, `excluir_recomendaciones`, `motivo_exclusion` | Disabled + badge "Automático" |
| **D) Ubicación** | `provincia_principal`, `ciudad_principal`, `barrio_principal`, `direccion_principal` | Solo lectura (fase posterior) |
| **E) Métricas/Scores** | `monto_total_historico`, `cantidad_ordenes`, `score_*`, `primera_compra`, etc. | No mostrar |

---

## Flujo de Edición

```text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   LECTURA   │───>│   EDICIÓN   │───>│ VALIDACIÓN  │───>│   GUARDADO  │
│             │    │             │    │             │    │             │
│ Ver tabla   │    │ Abrir Sheet │    │ Validar     │    │ UPDATE      │
│ completa    │    │ Modificar   │    │ campos      │    │ + Toast     │
│             │    │ campos      │    │ editables   │    │ + Refresh   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

**Detalles del flujo:**

1. **Lectura**: Usuario ve tabla paginada con clientes filtrados
2. **Edición**: Click en botón "Editar" abre Sheet lateral con datos del cliente
3. **Validación**: Al guardar, validar:
   - Emails con formato válido (si hay)
   - Teléfonos no vacíos si se agregan
   - Vendedor principal debe existir (si se selecciona)
4. **Guardado**: 
   - UPDATE solo campos editables
   - Toast de confirmación
   - Refrescar fila en tabla

---

## Archivos a Crear/Modificar

### Nuevos Archivos

| Archivo | Propósito |
|---------|-----------|
| `src/pages/ClientesEdicion.tsx` | Página principal con tabla y filtros |
| `src/components/clientes/ClientesEditTable.tsx` | Tabla con datos y botón editar |
| `src/components/clientes/EditClienteSheet.tsx` | Panel lateral de edición |

### Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/App.tsx` | Agregar ruta `/clientes-edicion` |
| `src/pages/ClientesDashboard.tsx` | Agregar botón "Editar Datos" en header |

---

## Detalle Técnico

### 1. Página Principal (`ClientesEdicion.tsx`)

```typescript
// Estructura del componente
const ClientesEdicion = () => {
  // Estado para filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvincia, setSelectedProvincia] = useState("all");
  const [selectedVendedor, setSelectedVendedor] = useState("all");
  
  // Estado para edición
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  
  // Fetch de clientes (solo campos necesarios para tabla + edición)
  const fetchClientes = async () => {
    const { data } = await supabase
      .from('clientes')
      .select(`
        client_id, razon_social, fantasia, cuit_dni,
        telefonos, emails, vendedor_principal,
        requiere_visita, excluir_recomendaciones, motivo_exclusion,
        provincia_principal, ciudad_principal, barrio_principal, direccion_principal
      `)
      .order('razon_social');
  };
  
  // Auth check: solo rol 'asignador'
};
```

### 2. Tabla de Clientes (`ClientesEditTable.tsx`)

**Columnas visibles:**
- Razón Social / Fantasía
- CUIT/DNI
- Vendedor Principal
- Teléfonos (resumido)
- Provincia
- Acción (botón Editar)

**Características:**
- Paginación local (50 por página)
- Ordenamiento por razón social
- Hover state en filas
- Botón "Editar" con ícono lápiz

### 3. Panel de Edición (`EditClienteSheet.tsx`)

**Props:**
```typescript
interface EditClienteSheetProps {
  cliente: Cliente;
  open: boolean;
  onClose: () => void;
  onSave: (updatedCliente: Partial<Cliente>) => Promise<void>;
}
```

**Campos editables con validación:**
- `telefonos`: Array de strings, permite agregar/quitar
- `emails`: Array de strings, validación de formato email
- `vendedor_principal`: Select con lista de vendedores existentes

**Campos bloqueados (visual diferenciado):**
```typescript
// Sección "Automatización" con estilo disabled
<div className="bg-muted/50 rounded-lg p-4 border border-dashed">
  <div className="flex items-center gap-2 mb-2">
    <Badge variant="outline">Automático</Badge>
  </div>
  <Checkbox checked={cliente.requiere_visita} disabled />
  <Checkbox checked={cliente.excluir_recomendaciones} disabled />
  {/* etc */}
</div>
```

### 4. Mutation de Guardado

```typescript
const handleSave = async (changes: Partial<Cliente>) => {
  // SOLO permitir estos campos
  const allowedFields = ['telefonos', 'emails', 'vendedor_principal'];
  const sanitizedChanges = Object.fromEntries(
    Object.entries(changes).filter(([key]) => allowedFields.includes(key))
  );
  
  const { error } = await supabase
    .from('clientes')
    .update(sanitizedChanges)
    .eq('client_id', cliente.client_id);
    
  if (!error) {
    toast({ title: "Guardado", description: "Datos actualizados correctamente" });
    onClose();
    refetch();
  }
};
```

---

## Seguridad: Protección de Campos Automáticos

### En Frontend (defensa en profundidad)

1. **Campos no editables no se incluyen en el estado del formulario**
2. **Sanitización explícita antes de enviar**: solo `telefonos`, `emails`, `vendedor_principal`
3. **Componentes disabled con visual diferenciado**

### En Backend (RLS existente)

La tabla `clientes` ya tiene RLS con política:
- `SELECT`: Usuarios autenticados pueden ver
- `ALL` (INSERT/UPDATE/DELETE): Solo service role

Esto significa que los usuarios **no pueden hacer UPDATE directamente desde el cliente**.

### Solución: Agregar política UPDATE para asignadores

```sql
-- Nueva política RLS para permitir edición de campos específicos
CREATE POLICY "Asignadores pueden editar contacto de clientes"
ON clientes
FOR UPDATE
TO authenticated
USING (get_user_role(auth.uid()) = 'asignador')
WITH CHECK (
  get_user_role(auth.uid()) = 'asignador'
);
```

**Nota importante**: Esta política permite UPDATE de cualquier campo. La restricción de campos editables se mantiene en el frontend. Si se requiere mayor seguridad, se puede crear una función RPC que solo acepte los campos permitidos.

---

## Flujo de Datos Resumido

```text
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│                 │         │                 │         │                 │
│   Frontend      │  fetch  │   Supabase      │  sync   │   client_places │
│   (edición)     │◄───────►│   (clientes)    │◄────────│   (geografía)   │
│                 │  update │                 │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        │                           │
        │                           │
        │  Solo edita:              │  NO se tocan:
        │  • telefonos              │  • provincia_principal
        │  • emails                 │  • barrio_principal
        │  • vendedor_principal     │  • direccion_principal
        │                           │  • requiere_visita
        │                           │  • excluir_recomendaciones
        │                           │  • motivo_exclusion
        │                           │  • métricas/scores
```

---

## Secuencia de Implementación

1. **Crear componentes base**
   - `ClientesEdicion.tsx` (página con auth check)
   - `ClientesEditTable.tsx` (tabla con filtros)
   - `EditClienteSheet.tsx` (panel de edición)

2. **Agregar ruta en App.tsx**
   - `/clientes-edicion` apuntando a `ClientesEdicion`

3. **Agregar botón en Dashboard**
   - En header de `ClientesDashboard.tsx`, junto a "Supervisión"

4. **Crear política RLS** (si es necesario)
   - Permitir UPDATE a rol `asignador`

5. **Testing**
   - Verificar que solo campos permitidos se editan
   - Verificar que campos automáticos no cambian
   - Verificar que ubicación no se modifica

---

## Verificación Final

| Criterio | Cómo verificar |
|----------|----------------|
| Solo campos editables se modifican | Inspeccionar payload en Network tab |
| Campos automáticos visualmente bloqueados | UI muestra disabled + badge |
| Ubicación no editable | Campos sin inputs, solo texto |
| Métricas no visibles | No aparecen en panel de edición |
| Solo asignadores acceden | Redirect a `/` si rol != asignador |

