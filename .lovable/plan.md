

# Plan: Geocodificación de Clientes Existentes Sin Ubicación

## Análisis: ¿Se puede reutilizar el flujo de prospectos?

### Respuesta: **Sí, con adaptaciones menores**

El flujo actual de n8n + geocodificación está diseñado de forma modular y puede reutilizarse. Sin embargo, hay diferencias clave a considerar:

| Aspecto | Prospectos (actual) | Clientes (nuevo) |
|---------|---------------------|------------------|
| Destino datos | Tabla `prospectos` | Tabla `client_places` |
| Trigger | Creación manual desde UI | Acción sobre cliente existente |
| `place_id` | Generado: `manual-{uuid}` | Usar el de Google o generar manual |
| Sync con `clientes` | No aplica | **Requiere llamar `upsert-clientes`** |
| Datos de entrada | Nombre, dirección completa | Solo dirección (cliente ya existe) |

### Posibles inconvenientes identificados

1. **El webhook actual devuelve datos, pero NO inserta en `client_places`**
   - El flujo de prospectos usa el resultado localmente y guarda en `prospectos`
   - Para clientes: debemos insertar en `client_places` (vía Edge Function existente)

2. **Sincronización con tabla `clientes`**
   - Después de crear el `client_place`, hay que ejecutar la lógica de sync
   - Ya existe en `upsert-clientes`, pero ese flujo procesa lotes completos
   - **Solución**: Llamar al Edge Function `upsert-client-places` + refetch

3. **Trigger de sincronización automática**
   - Actualmente `upsert-clientes` sincroniza desde `client_places` al ejecutarse
   - Para cliente individual, hay que forzar una actualización puntual

---

## Arquitectura Propuesta

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        FLUJO COMPLETO                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [1] UI: Click "Agregar ubicación"                                  │
│       │                                                             │
│       ▼                                                             │
│  [2] geocodingService.ts → Webhook n8n (ya existe)                 │
│       │  • Payload: { direccion, ciudad, provincia }               │
│       │  • Response: { lat, lng, barrio, formatted_address, ... }  │
│       │                                                             │
│       ▼                                                             │
│  [3] Frontend: Construir objeto PlaceData                          │
│       │  • client_id (del cliente existente)                       │
│       │  • lat, lng (del geocoding)                                │
│       │  • barrio_principal, direccion_principal, etc.             │
│       │  • is_primary = true                                       │
│       │                                                             │
│       ▼                                                             │
│  [4] Llamar Edge Function: upsert-client-places (ya existe)        │
│       │  • Inserta registro en client_places                       │
│       │                                                             │
│       ▼                                                             │
│  [5] Sincronizar datos a tabla clientes                            │
│       │  • UPDATE clientes SET provincia_principal, barrio, etc.   │
│       │  • Usando datos del client_place recién creado             │
│       │                                                             │
│       ▼                                                             │
│  [6] Refetch + Toast confirmación                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cambios Requeridos

### 1. Detectar Clientes Sin `client_places`

**Archivo**: `src/pages/ClientesEdicion.tsx`

- Modificar la query para hacer LEFT JOIN con `client_places`
- Agregar campo `has_location: boolean` al tipo `ClienteEditable`

```sql
SELECT c.*, 
       CASE WHEN cp.client_id IS NOT NULL THEN true ELSE false END as has_location
FROM clientes c
LEFT JOIN client_places cp ON c.client_id = cp.client_id AND cp.is_primary = true
```

### 2. Agregar Filtro "Sin ubicación"

**Archivo**: `src/pages/ClientesEdicion.tsx`

- Nuevo filtro toggle o select: "Mostrar solo sin geocodificar"
- Estado: `showOnlyWithoutLocation: boolean`

### 3. Mostrar Estado Visual en Tabla

**Archivo**: `src/components/clientes/ClientesEditTable.tsx`

- Nueva columna o badge junto a Dirección
- Badge rojo: 📍 "Sin ubicación" (si `has_location === false`)
- Tooltip: "Este cliente no tiene coordenadas validadas"

### 4. Modificar Sheet de Edición

**Archivo**: `src/components/clientes/EditClienteSheet.tsx`

- En sección "Ubicación", agregar lógica condicional:
  - **Si tiene ubicación**: Mostrar datos solo lectura (actual)
  - **Si NO tiene ubicación**: Mostrar formulario simplificado + botón "Geocodificar"

### 5. Crear Formulario de Geocodificación de Cliente

**Nuevo componente**: `src/components/clientes/GeocodificarClienteForm.tsx`

Flujo del formulario:
1. Pre-llenar con datos existentes del cliente (dirección_principal si existe)
2. Campos: Dirección, Ciudad, Provincia (select)
3. Botón "Validar ubicación"
4. Llamar al mismo `geocodeAddress()` del servicio existente
5. Si OK: mostrar mapa preview + datos enriquecidos
6. Botón "Confirmar y guardar"
7. Llamar a `upsert-client-places` Edge Function
8. Actualizar tabla `clientes` con datos geográficos
9. Refetch y cerrar

### 6. Crear Función de Sincronización Puntual

**Archivo**: `src/pages/ClientesEdicion.tsx` (o nuevo hook)

```typescript
const syncClientGeography = async (clientId: string) => {
  // 1. Obtener el client_place recién creado
  const { data: place } = await supabase
    .from('client_places')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .single();
  
  if (!place) return;
  
  // 2. Actualizar clientes con los datos geográficos
  await supabase
    .from('clientes')
    .update({
      provincia_principal: place.provincia_principal,
      barrio_principal: place.barrio_principal,
      direccion_principal: place.direccion_principal,
      // todos_barrios se mantiene simple por ahora
    })
    .eq('client_id', clientId);
};
```

---

## Detalle de Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/ClientesEdicion.tsx` | Query con LEFT JOIN, nuevo filtro, función sync |
| `src/components/clientes/ClientesEditTable.tsx` | Badge/indicador visual de estado ubicación |
| `src/components/clientes/EditClienteSheet.tsx` | Lógica condicional para mostrar formulario geocodificación |
| **NUEVO** `src/components/clientes/GeocodificarClienteForm.tsx` | Formulario reutilizando `geocodingService.ts` |

---

## Reutilización de Código Existente

| Módulo | Uso |
|--------|-----|
| `geocodingService.ts` | **100% reutilizable** - misma función `geocodeAddress()` |
| `PROVINCIAS_ARGENTINA` | **100% reutilizable** - mismo select de provincias |
| `isValidArgentinaCoordinate()` | **100% reutilizable** - misma validación |
| Edge Function `upsert-client-places` | **100% reutilizable** - ya recibe el formato correcto |

---

## Validaciones Anti-Duplicados

1. **Antes de geocodificar**: Verificar que no exista ya un `client_place` para ese `client_id`
2. **En Edge Function**: UNIQUE constraint en (`client_id`, `lat`, `long`) previene duplicados exactos
3. **`is_primary`**: Siempre `true` para el primer lugar de un cliente

---

## UX Final Esperada

### En la tabla:
| Razón Social | Dirección | Estado |
|--------------|-----------|--------|
| BAR LA CUEVA | Av. Corrientes 1234 | ✅ |
| PARRILLA DON JOSE | — | 🔴 Sin ubicación |

### En el Sheet de edición:

**Cliente CON ubicación:**
```
┌─ Ubicación ─────────────────────────┐
│ 📍 Av. Corrientes 1234, Palermo     │
│    Ciudad Autónoma de Buenos Aires  │
│    (Solo lectura)                   │
└─────────────────────────────────────┘
```

**Cliente SIN ubicación:**
```
┌─ Ubicación ─────────────────────────┐
│ ⚠️ Este cliente no tiene ubicación  │
│    validada.                        │
│                                     │
│ [Agregar ubicación]                 │
└─────────────────────────────────────┘
```

---

## Conclusión

El flujo de geocodificación de prospectos **puede reutilizarse casi en su totalidad**. Los cambios son principalmente en la UI para:
1. Detectar y visualizar clientes sin ubicación
2. Ofrecer la acción de geocodificar
3. Insertar en `client_places` (en lugar de `prospectos`)
4. Sincronizar con tabla `clientes`

No se requieren cambios en n8n ni en el Edge Function `upsert-client-places`.

