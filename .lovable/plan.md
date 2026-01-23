
Contexto y diagnóstico (qué está pasando y por qué ves “Palermo” y “PALERMO”)
- En la tabla clientes hoy conviven dos variantes:
  - clientes.barrio_principal = 'Palermo' (9 filas)
  - clientes.barrio_principal = 'PALERMO' (4 filas)
- El filtro del dashboard compara por igualdad exacta (case-sensitive). Resultado:
  - Si elegís “Palermo” ves 9
  - Si elegís “PALERMO” ves 4
- En client_places (que es donde está “la verdad” geográfica) el barrio primario aparece como “Palermo” en 12 clientes. O sea, el dashboard no está reflejando client_places, y además se contaminó con mayúsculas desde imports previos.
- Importante adicional: al menos 1 de esos 4 “PALERMO” en clientes NO coincide con su client_place primario (ej. un cliente tiene clientes='PALERMO' pero client_places primario='Villa Lugano'). Esto confirma que no alcanza con “normalizar mayúsculas”: hay que resincronizar desde client_places aunque clientes ya tenga un valor no nulo.

Objetivo (qué vamos a lograr)
1) Que clientes.barrio_principal refleje SIEMPRE el barrio del client_places primario cuando exista.
2) Que clientes.todos_barrios sea un array con TODOS los barrios asociados al cliente (distinct) desde client_places.
3) Evitar que vuelva a aparecer la divergencia: upsert-clientes debe sincronizar (y corregir) aunque barrio_principal no sea null.
4) Que el dashboard sea robusto: dedupe case-insensitive en opciones y comparación case-insensitive en filtros para que futuros datos “sucios” no rompan la UX.
5) Verificar: Palermo muestre el conteo esperado (12) y no existan variantes “PALERMO” en el selector.

Plan de implementación (backend + frontend)

Fase A — Backfill correctivo “source of truth = client_places”
A1) Backfill: actualizar clientes desde client_places primario cuando difiere (no solo cuando es NULL)
- Actualizar barrio_principal/direccion_principal/provincia_principal desde client_places cp.is_primary=true cuando:
  - clientes.barrio_principal IS NULL
  - o lower(trim(clientes.barrio_principal)) != lower(trim(cp.barrio_principal))
  - (y opcionalmente lo mismo para provincia/dirección si queremos máxima consistencia)
- Resultado: desaparece la bifurcación Palermo/PALERMO y además se corrigen casos “mal asignados” (ej. Palermo en clientes pero no en client_places, o viceversa).

A2) Backfill: recomputar clientes.todos_barrios desde TODOS los client_places (no solo si array está vacío)
- Recalcular todos_barrios como array_agg(distinct barrio_principal) filtrando nulls.
- Importante: hacerlo “siempre” para clientes que tengan client_places, porque hoy hay arrays poblados con valores viejos que no incluyen Palermo (caso PALERMO).

A3) Opcional (recomendado): normalización general de strings
- Si hay clientes sin client_places, podríamos normalizar barrio_principal a un formato consistente (por ejemplo Title Case) para evitar futuras duplicaciones en UI.
- Pero la prioridad es: cuando hay client_places, mandan los datos de client_places.

Fase B — Arreglar upsert-clientes para que mantenga sincronía y no reintroduzca “PALERMO”
Problema actual en tu diff
- El PASO 4 actual solo actualiza clientes si barrio_principal es NULL:
  - .is('barrio_principal', null)
- Eso impide corregir:
  - mayúsculas vs minúsculas
  - barrios equivocados que ya tenían un valor
  - arrays todos_barrios “viejos”
- Además, el PASO 3 sigue aceptando barrio_principal/todos_barrios del payload de n8n, lo cual puede recontaminar.

B1) Cambiar estrategia: sincronización geográfica bulk y correctiva (sin N+1 y sin “solo null”)
- Mantener el bulk fetch, pero en vez de loop+update condicional por null:
  - Hacer una actualización por cliente solo si difiere del primario (case-insensitive).
  - Y setear siempre todos_barrios basado en places (para clientes presentes en el import).
- Ideal: una sola sentencia SQL “bulk” dentro de la function para:
  - primario por client_id
  - agregación de barrios por client_id
  - update clientes join subqueries
Esto reduce latencia y evita inconsistencias parciales.

B2) Evitar recontaminación desde el import
- En el PASO 3 (camposVentas) considerar remover barrio_principal / todos_barrios / direccion_principal / provincia_principal de “campos de ventas” si esos campos deben venir solo de client_places.
- Alternativa: dejarlos pero el PASO 4 los pisa siempre con client_places (más seguro y simple).

B3) Nota de higiene importante
- No se debe editar src/integrations/supabase/types.ts manualmente (es autogenerado). Si hubo cambios ahí, hay que revertirlos para evitar drift/errores de tipos.

Fase C — Robustecer el dashboard para que no “se rompa” con variaciones de casing
Aunque arreglemos la base, esto evita que vuelva el problema si entra data “sucia”.

C1) Dedupe case-insensitive en opciones del selector “Barrio”
- Al construir barrios (useMemo), en vez de Set<string> directo:
  - usar una clave canonical: key = normalize(barrio) = trim + toLowerCase + colapsar espacios
  - guardar un label canónico (preferir el de client_places/Title Case)
- Mostrar una sola opción “Palermo” aunque existan “PALERMO”, “palermo”, “ Palermo ”.

C2) Filtrado case-insensitive + fallback correcto
- Hoy matchBarrio usa (cliente.todos_barrios || []).includes(selectedBarrio) (case-sensitive) y no cae a barrio_principal si el array está null.
- Cambiar a:
  - barriosCliente = cliente.todos_barrios?.length ? cliente.todos_barrios : (cliente.barrio_principal ? [cliente.barrio_principal] : [])
  - matchBarrio = selectedBarrio === 'all' || barriosCliente.some(b => normalize(b) === normalize(selectedBarrio))
Esto elimina los falsos negativos.

C3) Bug adicional detectado (no de Palermo pero sí del panel)
- En ciudades useMemo hay un typo: cliente.ciudad_principa (falta “l”). Eso puede romper el filtro de ciudad y la generación de opciones.
- Corregir a cliente.ciudad_principal y aplicar el mismo patrón de fallback que en barrios.

Fase D — Verificación (criterios de aceptación)
D1) En base de datos
- No debe existir barrio_principal='PALERMO' en clientes (o al menos no debe aparecer como opción separada).
- Conteos esperados:
  - client_places primario Palermo = 12
  - clientes barrio_principal Palermo = 12 (si usamos client_places como source of truth; el que tiene Villa Lugano debe salir de Palermo)
- Para todos los clientes con client_places:
  - clientes.todos_barrios debe contener el barrio del primario
  - clientes.barrio_principal debe estar incluido en todos_barrios (consistencia)

D2) En UI (/clientes-dashboard)
- El selector muestra un solo “Palermo” (sin “PALERMO”).
- Al filtrar “Palermo” el badge “X clientes filtrados” debe mostrar 12.
- El topBarrios no debe tener duplicados “Palermo”/“PALERMO”.

Seguridad y rollback
- Los updates propuestos son determinísticos y reversibles (la “fuente” es client_places). Si algo sale raro, se puede rerun el sync o restaurar desde client_places.
- Recomendación: antes de ejecutar, guardar un snapshot lógico (export) de columnas afectadas (client_id, barrio_principal, provincia_principal, direccion_principal, todos_barrios) para rollback rápido.

Ejecución sugerida (orden)
1) Ejecutar backfill A1 + A2 (corrige el estado actual ya).
2) Refrescar dashboard y verificar Palermo (debe dar 12) y que no haya “PALERMO” como opción.
3) Implementar cambios en upsert-clientes (Fase B) para evitar que vuelva a romperse.
4) Implementar robustez en ClientesDashboard (Fase C) como “cinturón de seguridad”.
