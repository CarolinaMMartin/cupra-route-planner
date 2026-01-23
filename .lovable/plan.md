

# Plan: Filtros con Opción de Valores Nulos + Filtro de Dirección

## Resumen

Agregar en los desplegables de Provincia, Vendedor Principal y un **nuevo filtro de Dirección** la opción de filtrar por campos con valor nulo/vacío.

---

## Cambios Específicos

### 1. Agregar Estado para Nuevo Filtro

```typescript
// Línea ~40, agregar:
const [selectedDireccion, setSelectedDireccion] = useState<string>("all");
```

### 2. Crear Lista de Direcciones Únicas

```typescript
// Después de vendedores (~línea 132), agregar:
const direcciones = useMemo(() => {
  const direccionesMap = new Map<string, string>();
  clientesData.forEach(cliente => {
    if (cliente.direccion_principal) {
      const key = normalize(cliente.direccion_principal);
      if (!direccionesMap.has(key)) {
        direccionesMap.set(key, cliente.direccion_principal);
      }
    }
  });
  return Array.from(direccionesMap.values()).sort();
}, [clientesData]);
```

### 3. Actualizar Lógica de Filtrado

**Antes (líneas 135-148):**
```typescript
const matchProvincia = selectedProvincia === "all" || 
  normalize(cliente.provincia_principal) === normalize(selectedProvincia);
const matchVendedor = selectedVendedor === "all" || 
  cliente.vendedor_principal === selectedVendedor;
```

**Después:**
```typescript
// Provincia: "all" = todos, "__null__" = solo nulos, otro = ese valor
const matchProvincia = selectedProvincia === "all" ||
  (selectedProvincia === "__null__" && !cliente.provincia_principal) ||
  (selectedProvincia !== "__null__" && normalize(cliente.provincia_principal) === normalize(selectedProvincia));

// Vendedor: misma lógica
const matchVendedor = selectedVendedor === "all" ||
  (selectedVendedor === "__null__" && !cliente.vendedor_principal) ||
  (selectedVendedor !== "__null__" && cliente.vendedor_principal === selectedVendedor);

// Dirección: nuevo filtro
const matchDireccion = selectedDireccion === "all" ||
  (selectedDireccion === "__null__" && !cliente.direccion_principal) ||
  (selectedDireccion !== "__null__" && normalize(cliente.direccion_principal) === normalize(selectedDireccion));

return matchProvincia && matchVendedor && matchDireccion && matchSearch;
```

### 4. Actualizar UI de Filtros

**Select de Provincia (agregar opción nulos después de "Todas"):**
```tsx
<SelectItem value="all">Todas</SelectItem>
<SelectItem value="__null__">— Sin provincia —</SelectItem>
{provincias.map(p => (
  <SelectItem key={p} value={p}>{p}</SelectItem>
))}
```

**Select de Vendedor (agregar opción nulos):**
```tsx
<SelectItem value="all">Todos</SelectItem>
<SelectItem value="__null__">— Sin asignar —</SelectItem>
{vendedores.map(v => (
  <SelectItem key={v} value={v}>{v}</SelectItem>
))}
```

**Nuevo Select de Dirección (agregar en el grid):**
```tsx
<div className="space-y-2">
  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
    Dirección
  </label>
  <Select value={selectedDireccion} onValueChange={setSelectedDireccion}>
    <SelectTrigger className="bg-background/50">
      <SelectValue placeholder="Todas" />
    </SelectTrigger>
    <SelectContent className="bg-popover z-50">
      <SelectItem value="all">Todas</SelectItem>
      <SelectItem value="__null__">— Sin dirección —</SelectItem>
      {direcciones.map(d => (
        <SelectItem key={d} value={d}>{d}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

### 5. Actualizar Grid Layout

Cambiar de 4 columnas a 5 para acomodar el nuevo filtro:
```tsx
<div className="grid grid-cols-1 md:grid-cols-5 gap-4">
```

### 6. Actualizar Limpiar Filtros

```typescript
const handleClearFilters = () => {
  setSelectedProvincia("all");
  setSelectedVendedor("all");
  setSelectedDireccion("all"); // Agregar
  setSearchTerm("");
};
```

---

## Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/ClientesEdicion.tsx` | Agregar filtro dirección + opciones nulos en todos los selects |

---

## Resultado Final en UI

| Filtro | Opciones |
|--------|----------|
| Provincia | Todas / — Sin provincia — / [provincias...] |
| Vendedor Principal | Todos / — Sin asignar — / [vendedores...] |
| Dirección | Todas / — Sin dirección — / [direcciones...] |

---

## Nota Técnica

Se usa el valor `"__null__"` como placeholder para filtrar nulos, siguiendo el mismo patrón establecido en `EditClienteSheet.tsx` para evitar errores con Radix Select.

