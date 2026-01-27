

# Plan: Restaurar Layout del Asignador en Desktop

## Problema Identificado

Los cambios responsive para el rol vendedor afectaron inadvertidamente el layout del rol asignador. En la imagen se ve que:
- Los botones de navegación están en una línea
- La info del usuario y "Salir" están en una segunda línea

Esto sucede porque en la línea 87 y 93 se agregaron clases `flex-wrap` y `gap-2` que afectan a AMBOS roles.

## Archivo a Modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/Index.tsx` | Restaurar layout de asignador, mantener responsive solo para vendedor |

## Cambios Específicos

### Línea 87 - Quitar flex-wrap del container principal del header

El `flex-wrap` está causando que todo el header se rompa en dos líneas.

```typescript
// Antes (actual - problemático)
<div className="flex flex-wrap justify-between items-center gap-2 py-3 md:py-5">

// Después (corrección)
<div className="flex justify-between items-center py-5">
```

### Línea 93 - Quitar flex-wrap del container de navegación

```typescript
// Antes (actual - problemático)  
<div className="flex items-center gap-2 md:gap-5 flex-wrap">

// Después (corrección)
<div className="flex items-center gap-5">
```

### Línea 143 - Restaurar separador visible siempre

```typescript
// Antes
<div className="h-8 w-px bg-border/50 hidden md:block" />

// Después
<div className="h-8 w-px bg-border/50" />
```

### Líneas 145-148 - Restaurar botón "Salir" completo

```typescript
// Antes
<Button variant="ghost" size="sm" onClick={handleLogout} className="flex items-center gap-2 text-muted-foreground hover:text-destructive transition-colors">
  <LogOut className="w-4 h-4" />
  <span className="hidden md:inline text-sm tracking-wide">Salir</span>
</Button>

// Después
<Button variant="ghost" size="sm" onClick={handleLogout} className="flex items-center gap-2 text-muted-foreground hover:text-destructive transition-colors">
  <LogOut className="w-4 h-4" />
  <span className="text-sm tracking-wide">Salir</span>
</Button>
```

### Líneas 116-133 - Mantener responsive SOLO para vendedor

Los cambios de navegación responsive (desktop vs mobile) deben permanecer SOLO dentro del bloque de vendedor, que ya están correctamente encapsulados con `hidden md:flex` y `md:hidden`.

### Línea 135 - Mantener info usuario visible siempre para asignador

La clase condicional ya está correcta: `${profile.rol === 'vendedor' ? 'hidden md:block' : ''}` - esto hace que se oculte solo para vendedor en mobile.

## Resultado Esperado

| Rol | Desktop | Mobile |
|-----|---------|--------|
| **Asignador** | Una sola línea con: Logo + 5 botones nav + User info + Salir | (no aplica cambios) |
| **Vendedor** | Una sola línea con: Logo + 2 botones nav + User info + Notif + Salir | Compacto: Logo + iconos + Notif + icono salir |

## Nota de Overflow

El `overflow-x-hidden` en la línea 84 del wrapper principal se mantiene como medida de seguridad general, ya que no afecta visualmente al asignador.

