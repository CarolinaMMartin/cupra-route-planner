

# Plan: Mostrar Detalle de Vendedores y Barrios en Selector de Áreas

## Resumen

Cambiar la descripción genérica "(X vendedores, Y barrios)" por los nombres reales de vendedores y barrios asignados al área.

---

## Cambio Específico

### Archivo: `src/components/assignor/FilterPanel.tsx`

**Línea 318-321 (actual):**
```tsx
{areas.map((area) => (
  <SelectItem key={area.id} value={area.id}>
    {area.nombre} ({area.vendedores.length} vendedores, {area.barrios.length} barrios)
  </SelectItem>
))}
```

**Propuesta nueva:**
```tsx
{areas.map((area) => {
  // Obtener nombres de vendedores del área
  const nombresVendedores = vendedores
    .filter(v => area.vendedores.includes(v.id))
    .map(v => v.nombre.split(' ')[0]); // Solo primer nombre para brevedad
  
  // Truncar si hay muchos
  const vendedoresDisplay = nombresVendedores.length > 3
    ? `${nombresVendedores.slice(0, 3).join(', ')}...`
    : nombresVendedores.join(', ');
  
  const barriosDisplay = area.barrios.length > 3
    ? `${area.barrios.slice(0, 3).join(', ')}...`
    : area.barrios.join(', ');

  return (
    <SelectItem key={area.id} value={area.id}>
      {area.nombre} • {vendedoresDisplay || 'Sin vendedores'} | {barriosDisplay || 'Sin barrios'}
    </SelectItem>
  );
})}
```

---

## Ejemplo Visual

**Antes:**
```
CABA Norte (3 vendedores, 5 barrios)
```

**Después:**
```
CABA Norte • Martín, Ana, Carlos | Palermo, Recoleta, Belgrano...
```

---

## Consideraciones

- Se usa solo el primer nombre de cada vendedor para mantener brevedad
- Si hay más de 3 elementos, se muestran los primeros 3 con "..."
- El separador `•` diferencia el nombre del área del contenido
- El separador `|` diferencia vendedores de barrios

