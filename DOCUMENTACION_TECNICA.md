# CUPRA Smart Route Planner — Documentación Técnica

Versión del documento: 2026-08-07
Ámbito: aplicación completa (frontend, backend, base de datos, ETL, motor de IA, integraciones).

---

## 1. Visión general

El sistema es un **planificador inteligente de rutas comerciales** para la fuerza de ventas de vinos CUPRA en AMBA/Capital Federal. Resuelve tres problemas:

1. **Consolidar la información comercial** (cartera oficial de clientes + histórico de ventas + prospectos de Google Maps) en una única base geolocalizada.
2. **Decidir a quién visitar cada día**: un motor de recomendación híbrido (scoring geográfico determinístico + LLM) arma rutas densas y caminables de 8 puntos por vendedor.
3. **Cerrar el ciclo con el feedback del vendedor**, que vuelve al motor como insumo (exclusiones, negocios cerrados, interacciones).

### 1.1 Terminales

| Terminal | Usuario | Objetivo |
|---|---|---|
| **Asignador** (`app_role = 'asignador'`) | Jefe comercial / planner | Cargar datos (ETL), generar recomendaciones IA, asignar clientes por área o manualmente, supervisar ejecución diaria y KPIs. |
| **Vendedor** (`app_role = 'vendedor'`) | Vendedor de calle | Ver su ruta del día en mapa y kanban, hacer check-in/checkout, registrar feedback, cargar prospectos nuevos, autoasignarse clientes. |

---

## 2. Stack tecnológico

**Frontend**
- React 18 + TypeScript 5, bundler **Vite 5**
- **Tailwind CSS v3** + **shadcn/ui** (Radix primitives) — tokens semánticos en `src/index.css` y `tailwind.config.ts`
- **TanStack Query** (`@tanstack/react-query`) para fetching/caché
- **React Router v6** (`BrowserRouter`)
- **Google Maps JavaScript API** (carga dinámica del script; marcadores custom por vendedor)
- `sonner` + `toaster` para notificaciones, `lucide-react` para iconografía
- Parsing de Excel en cliente con **SheetJS (xlsx)** en `/carga-datos`

**Backend (Lovable Cloud / Supabase)**
- **PostgreSQL** con RLS, enums, triggers y funciones `SECURITY DEFINER`
- **Auth** (email/password, roles vía `profiles.rol`)
- **Edge Functions** en **Deno** (10 funciones, ver §6)
- **Lovable AI Gateway** (`https://ai.gateway.lovable.dev/v1/chat/completions`) con modelo `google/gemini-2.5-flash`, autenticado con `LOVABLE_API_KEY`

**Integraciones externas**
- **Google Maps Platform** vía conector administrado de Lovable: Maps JS, Geocoding y Places (búsqueda de prospectos)
- **Lovable** como entorno de publicación y pruebas, sincronizado desde GitHub, y como gateway de IA durante esta etapa

**Identidad visual** — *Dark Heritage Premium*: charcoal profundo `#0F0F12`, oro mate `#C6A46A`, títulos serif + UI sans. Sin azules.

---

## 3. Estructura del repositorio

```text
src/
  App.tsx                     Router + providers (QueryClient, Tooltip, Toasters)
  pages/
    Index.tsx                 Landing / router por rol → dashboard asignador o vendedor
    Auth.tsx                  Login / signup
    Profiles.tsx              ABM de usuarios (activar/desactivar, rol)
    CargaDatos.tsx            ETL UI: detección de tipo de archivo, parseo y envío por lotes
    ClientesDashboard.tsx     KPIs y exploración de cartera
    ClientesEdicion.tsx       Edición masiva / geocodificación puntual
    ProspectosDashboard.tsx   Prospectos Google Places, filtros y alta
    AreasManager.tsx          ABM de áreas (polígonos/barrios) y asignación de vendedores
    VendedorDashboard.tsx     Terminal del vendedor
    SupervisionVendedores.tsx Panel de control de ejecución diaria
  components/
    AssignorDashboard.tsx     Orquestador del flujo del asignador
    assignor/                 FilterPanel, ResultsMap/List, Kanban/Table Assignment,
                              ManualAssignment, TodayAssignments, AIInsightsCard, etc.
    vendedor/                 VendedorKanban, VendedorAssignmentsMap, AgregarProspectoForm,
                              AutoAsignarDialog, ActividadesPanel, NotificacionesPanel
    ui/                       shadcn/ui
  hooks/                      useNotificaciones, useRecommendationsStore, use-toast, use-mobile
  integrations/supabase/      client.ts + types.ts (autogenerados — no editar)
  services/geocodingService.ts
  lib/vendorColors.ts         Paleta determinística por vendedor (mapa/kanban)
supabase/
  functions/                  10 edge functions Deno
  migrations/                 ~90 migraciones SQL versionadas
  config.toml                 verify_jwt por función
```

### 3.1 Rutas de la SPA

| Ruta | Pantalla | Rol |
|---|---|---|
| `/` | Index (redirige según rol) | ambos |
| `/auth` | Login | público |
| `/profiles` | Gestión de usuarios | asignador |
| `/carga-datos` | ETL Excel | asignador |
| `/clientes-dashboard`, `/clientes-edicion` | Cartera | asignador |
| `/prospectos-dashboard` | Prospectos | asignador |
| `/areas` | Áreas y zonas | asignador |
| `/supervision-vendedores` | Supervisión | asignador |
| `/vendedor-dashboard` | Ruta del día | vendedor |
| `*` | NotFound | — |

---

## 4. Modelo de datos

### 4.1 Tablas núcleo

**`clientes`** — maestro comercial. PK `id (uuid)`, clave de negocio **`client_id (text)`** (ID oficial del maestro; usado por todas las FKs).
Campos por bloque:
- Identidad: `cuit_dni`, `razon_social`, `fantasia`, `canal`, `etiquetas[]`
- Métricas (derivadas de `ventas_cupra`): `primera_compra`, `ultima_compra`, `dias_desde_ultima_compra`, `cantidad_ordenes`, `monto_total_historico`, `ticket_promedio`, `participacion_mercado`
- Scoring: `categoria_recencia`, `categoria_volumen`, `score_recencia`, `score_volumen`, `score_comercial` (0–5)
- Geografía: `ciudad_principal`, `barrio_principal`, `direccion_principal`, `provincia_principal` + arrays `todas_ciudades[]`, `todos_barrios[]`, `todas_direcciones[]`
- Comercial: `vendedor_principal` (histórico de ventas), **`vendedor_actual`** (cartera oficial del maestro — manda), `todos_vendedores[]`, `requiere_visita`
- Control: `excluir_recomendaciones`, `motivo_exclusion`, `last_recommendation_at`, `ultima_visita`

**`client_places`** — geolocalización 1:N por cliente. `lat`/`long` (NOT NULL), `place_id`, `google_maps_link`, `is_primary`, `barrio_principal`, `comuna`, `provincia_principal`. **Fuente de verdad para renderizar mapas.**

**`ventas_cupra`** — hechos de venta a nivel línea de factura. `ticket`, `letra`, `fecha_emision`, `cuit_dni`, `codigo_producto`, `marca`, `cajas`, **`facturacion_ars`** (= "Precio Total Final", con IVA; negativo en notas de crédito), `vendedor`, geografía y contacto crudos. FK `client_id → clientes`.

**`import_batches` / `import_staging_rows`** — auditoría de cada carga y staging temporal de las filas originales. Registra archivo, SHA-256, hoja, usuario, versión ETL, resultado y estado. El staging se elimina al completar y se conserva 7 días ante un fallo para diagnóstico o recuperación.

**`prospectos`** — negocios de Google Places aún no clientes. PK de negocio `place_id`, `latitud`/`longitud`, `rating`, `total_ratings`, `tipo_principal`, `tipos[]`, `sirve_vinos`, `estado_negocio`, `es_cliente_cupra`, contacto (`telefono`, `email`, `instagram`, `website`).

**`profiles`** — 1:1 con `auth.users` (poblada por trigger `on_auth_user_created` → `handle_new_user()`). `user_id`, `nombre`, `email`, `rol (app_role)`, `activo`.

### 4.2 Operación diaria

- **`asignaciones_vendedores_clientes`** — asignación de un cliente **o** prospecto a un vendedor. `vendedor_id → profiles.user_id`, `client_id` **xor** `prospecto_place_id`, `es_prospecto`, `estado (enum estado_asignacion: Asignado | Por visitar | Visitado)`, `origen_asignacion` (`ia` | `manual` | `autoasignacion` | `area`), `visited_at`.
- **`cliente_feedbacks`** — insumo crítico del vendedor. `feedback`, `visita_realizada`, `motivo_no_visita`, `tipo_interaccion`, `actualizar_etiqueta_wa`, referencia a cliente o prospecto. **Nunca se borra ni se sobreescribe con los ETL de Excel** (tabla independiente del pipeline de carga).
- **`recomendaciones_ia`** — salida del motor: snapshot del cliente/prospecto + `justificacion`, `ai_reasoning`, `factores_ia (jsonb)`, `score_geografico`, `priority_score`, `vendedor_recomendado_id`, `request_id` (agrupa una corrida), `es_prospecto`.
- **`notificaciones`** — avisos al vendedor, ligados a `asignacion_id`.
- **`activaciones`**, **`visitas`** — registro de acciones en calle y check-in/checkout con `geolocalizacion (jsonb)`.
- **`asignaciones_manuales_audit`** — auditoría inmutable (sin UPDATE/DELETE) de reasignaciones manuales: vendedor anterior, nuevo, cliente, usuario que ejecutó.
- **`areas`**, **`areas_places`**, **`areas_vendedores`**, **`places`** — zonificación por barrio/comuna y su vinculación a vendedores.
- **`sucursales`** — puntos de venta múltiples de un mismo cliente.

### 4.3 Enums, funciones y triggers

Enums: `app_role` (`asignador`, `vendedor`), `estado_asignacion` (`Asignado`, `Por visitar`, `Visitado`).

Funciones (todas `SECURITY DEFINER` salvo indicación, con `search_path = public`):
- `handle_new_user()` — trigger AFTER INSERT en `auth.users`: crea el profile con rol de metadata (default `vendedor`) y `activo = true`.
- `get_user_role(_user_id uuid) → app_role`.
- `get_vendedor_barrios_top(vendedor_user_id, top_n)` — top barrios por facturación del vendedor (join `ventas_cupra` + `client_places` + `profiles` con `unaccent`).
- `clean_old_recommendations()` — purga `recomendaciones_ia` con más de 7 días.
- `set_updated_at()` / `update_updated_at_column()` — triggers BEFORE UPDATE en `areas`, `clientes`, `client_places`, `prospectos`, `sucursales`.

### 4.4 Seguridad

- RLS activo en las tablas de operación (`clientes`, `client_places`, `prospectos`, `asignaciones_*`, `cliente_feedbacks`, `recomendaciones_ia`, `notificaciones`, `activaciones`).
- Patrón general: el vendedor sólo ve/edita filas donde `vendedor_id = auth.uid()`; el asignador tiene acceso ampliado vía chequeo de rol.
- Roles almacenados en `profiles.rol` y consultados por funciones `SECURITY DEFINER` para evitar recursión en políticas.
- Las edge functions con `verify_jwt = false` (ver `supabase/config.toml`) validan sesión/permiso en código y usan `SUPABASE_SERVICE_ROLE_KEY` para escrituras masivas.

---

## 5. Pipeline de datos (ETL)

Entrada: dos Excel independientes que envía la distribuidora.

### 5.1 Maestro de clientes → `process-clientes-maestro`

1. `/carga-datos` detecta el tipo de archivo por cabeceras (busca la fila de encabezado entre las primeras 15 filas), recorre todas las hojas y calcula la huella SHA-256 del archivo.
2. Normaliza CUIT (incluye corrección de notación científica de Excel), razón social (trim + uppercase + espacios simples) y geografía (`normalizarGeografia`: mapeo de ciudad/partido a barrio/comuna de CABA y GBA).
3. Resuelve el `client_id`: match por CUIT → match por nombre normalizado → alta nueva con el `Id` oficial del maestro.
4. Escribe **fuente de verdad de cartera**: `vendedor_actual`, contacto, categorías/etiquetas.
5. Clientes sin ventas se marcan `SIN_COMPRAS` (existen en cartera pero no en `ventas_cupra`).
6. Coordenadas oficiales del maestro (`Latitud`/`Longitud`) se cargan en `client_places` como `is_primary`.
7. Cada ejecución queda registrada como lote; sólo usuarios con rol `asignador` pueden iniciar el proceso.

### 5.2 Informe de ventas → `process-ventas-excel`

1. Deduplicación por clave compuesta (ticket + letra + fecha + producto + cliente) para permitir recargas idempotentes.
2. **Notas de crédito**: montos negativos aceptados y netean el histórico.
3. **No pisa** `vendedor_actual` del maestro; el vendedor del informe alimenta `vendedor_principal` / `todos_vendedores[]`.
4. Lee `Latitud`/`Longitud` del informe y las persiste en `client_places`.
5. Recalcula métricas agregadas del cliente (`monto_total_historico`, `cantidad_ordenes`, `ticket_promedio`, recencia, scores y categorías).
6. Valida y prepara todo el archivo antes de tocar el histórico. `commit_ventas_import()` realiza el reemplazo/merge y la inserción en una única transacción PostgreSQL: ante cualquier error se revierte el lote y se conservan las ventas anteriores.
7. Las notas de crédito se cruzan primero con las ventas del archivo y luego con el maestro persistido, para incluir clientes sin ventas positivas en el período.

**Identidad de cliente en ventas:** la columna `ID` del informe de ventas pertenece a ese informe y no coincide con el `Id` oficial del maestro, por lo que nunca se usa como `client_id`. La resolución es: `Número Externo` sólo si ya existe → CUIT único → razón social/fantasía normalizada → CUIT como ID estable para un alta nueva. Si un CUIT está duplicado y el nombre no permite desambiguar, la fila se rechaza y queda reportada en el lote.

### 5.3 Geocodificación → `geocode-clients`

- **Forward**: clientes con dirección y sin coordenadas → Geocoding API.
- **Reverse**: clientes con coordenadas y sin barrio → completa `barrio_principal`, `comuna`, `provincia_principal` desde los `address_components` de Google.
- Usa la key administrada del conector de Google Maps; procesa en lotes con control de rate limit.

### 5.4 Endpoints de upsert directos

`upsert-clientes`, `upsert-ventas-cupra`, `upsert-client-places`, `upsert-prospectos`: recepción por lotes en JSON, validación y `upsert` por clave de negocio. Quedan disponibles como API para integraciones autorizadas; la pantalla `/carga-datos` utiliza los ETL especializados anteriores.

---

## 6. Edge Functions

| Función | Disparo | Responsabilidad |
|---|---|---|
| `generate-recommendations` | Asignador (UI) | Motor híbrido de recomendación (§7). |
| `process-clientes-maestro` | `/carga-datos` | Ingesta del maestro de cartera. |
| `process-ventas-excel` | `/carga-datos` | Ingesta del informe de ventas y recálculo de métricas. |
| `geocode-clients` | Asignador / batch | Geocodificación directa e inversa. |
| `upsert-clientes` / `upsert-ventas-cupra` / `upsert-client-places` / `upsert-prospectos` | API/lotes | Upserts idempotentes. |
| `check-pending-assignments` | Programada / UI | Detecta asignaciones vencidas o sin visitar y genera notificaciones. |
| `cleanup-visited-assignments` | Programada (diaria, UTC-3) | Cierra/archiva asignaciones visitadas del día anterior. |

CORS habilitado en todas; `verify_jwt = false` con validación en código.

---

## 7. Motor de recomendación (`generate-recommendations`)

Objetivo invariable: **8 recomendaciones por vendedor**, geográficamente densas y caminables.

### 7.1 Anclaje geográfico

1. Se toma la cartera del vendedor (clientes afiliados por `vendedor_actual`/`vendedor_principal`/`todos_vendedores`, resueltos por nombre normalizado → `user_id` con `unaccent` + fuzzy).
2. `findDensestHotspot(points, 2km)`: se elige el punto con más vecinos en 2 km y se devuelve el **centroide de ese clúster** como ancla del día.
3. Filtros duros del asignador (provincia / ciudad / barrio) se aplican antes del scoring.
4. Radio: `HARD_RADIUS_KM = 1.5` → expansión a `2.0` → pasos `3.0` y `5.0` km si no se llega al cupo.
5. **Anti-solapamiento entre vendedores**: candidato a menos de **300 m** del ancla de otro vendedor recibe penalidad `-100`.

### 7.2 Scoring determinístico

Clientes (`scoreClients`):

```text
score_total = 0.50·score_geo + 0.25·score_vendedor + 0.15·score_comercial
            + 0.10·score_rotacion + penalidad_solapamiento
```
- `score_geo = max(0, 100 − distancia/radio·100)`
- `score_vendedor = 100` si el cliente es de su cartera, `0` si no
- `score_comercial = (score_comercial_db / 5)·100`
- `score_rotacion = min(100, días_desde_última_recomendación · 5)` (evita repetir)
- **Descarte duro** si hay feedback negativo ("no volver", "cerrado") o `excluir_recomendaciones`

Prospectos (`scoreProspects`) — la geografía domina:

```text
score_total = 0.70·score_geo + 0.15·score_comercial + 0.15·score_rotacion + penalidad
score_comercial = min(100, rating_google · 20)
```
Se ordenan por distancia ascendente: son el relleno natural del cupo.

Clasificación comercial (`classifyEstado` por `dias_desde_ultima_compra`): `ACTIVO ≤ 30`, `INACTIVO ≤ 90`, `PERDIDO > 90`, `POTENCIAL` para prospectos.

### 7.3 Capa LLM

- Modelo `google/gemini-2.5-flash` vía Lovable AI Gateway.
- El prompt (`buildSystemPrompt`, v10-balanced) recibe por vendedor el listado de candidatos ya scoreados, sus feedbacks recientes, estado comercial e instrucciones adicionales libres del asignador.
- El LLM **selecciona y justifica** dentro del set permitido; no puede inventar candidatos fuera del pool geográfico.

### 7.4 Garantía de cupo (`validateAndFill`)

Reglas de composición sobre la salida del LLM:
- Los prospectos completan la ruta sólo cuando no hay 8 clientes elegibles en la zona, salvo instrucciones explícitas del asignador
- `MAX_LOST = 4` clientes `PERDIDO` como máximo
- Al menos un caso de recuperación cuando existe
- Si faltan puntos: se completa por score con clientes y, agotados, con prospectos ampliando el radio (hasta 5 km y fallback amplio). **Un vendedor sin cartera ("modo conquista") recibe 8 prospectos** ordenados por proximidad al ancla de su zona/filtros y rating, ignorando el sesgo de cartera.
- Deduplicación semántica por solapamiento de tokens del nombre (`nameTokenOverlap`) para evitar la misma sucursal duplicada como cliente y prospecto.

Persistencia: cada corrida escribe en `recomendaciones_ia` con un `request_id` común y actualiza `last_recommendation_at` en clientes/prospectos recomendados.

---

## 8. Flujos funcionales

### 8.1 Asignador — generación y asignación

1. **Filtros** (`FilterPanel`): vendedores, provincia/ciudad/barrio, canal, etiquetas, instrucciones adicionales al modelo.
2. **Generar** → `generate-recommendations` → resultados en `useRecommendationsStore`.
3. **Revisión**: `ResultsMap` (marcadores coloreados por vendedor, `lib/vendorColors.ts`), `ResultsList`, `ClientDetailCard` con `AIInsightsCard` (justificación y factores).
4. **Asignación**: `KanbanAssignment` (drag & drop entre columnas de vendedor) o `TableAssignment` (edición tabular masiva).
5. **Modo por área**: se seleccionan áreas de `areas` y se distribuyen sus clientes entre los vendedores vinculados (`areas_vendedores`).
6. **Modo manual / "Personalizado"** (`ManualAssignment`): búsqueda libre en la base (clientes y prospectos) con filtros y sugerencias inteligentes (sin vendedor, baja frecuencia, no visitados hace X días), selección múltiple por checkbox, elección de vendedor y asignación en una sola acción. Cada reasignación deja registro en `asignaciones_manuales_audit`. Convive con el flujo automático sin interferirlo.
7. **Asignaciones de hoy** (`TodayAssignments` + `AssignorTodayAssignmentsMap`): estado en vivo, edición (`EditAssignmentsKanban` / `EditAssignmentsTable`) y reasignación.

### 8.2 Vendedor — ejecución

1. `VendedorDashboard` carga las asignaciones del día (`estado ∈ {Asignado, Por visitar}`).
2. `VendedorKanban`: columnas por estado, detalle del punto, teléfono, link a Google Maps, historial de compras y feedbacks previos.
3. **Check-in / checkout** con geolocalización → `visitas`; el estado pasa a `Visitado` y se sella `visited_at`.
4. **Feedback obligatorio** al cerrar: visita realizada sí/no, motivo, tipo de interacción, etiqueta WhatsApp → `cliente_feedbacks` (persistente entre cargas de Excel).
5. **Alta de prospectos** (`AgregarProspectoForm`): búsqueda en Google Places, verificación de duplicados contra `prospectos` y `clientes`, alta con coordenadas reales.
6. **Autoasignación** (`AutoAsignarDialog`): el vendedor suma puntos cercanos a su ruta dentro de su zona.
7. **Notificaciones** (`useNotificaciones` + `NotificacionesPanel`) por realtime/polling sobre `notificaciones`.

### 8.3 Supervisión

`SupervisionVendedores` agrega, por vendedor y por día: asignados vs. visitados, tasa de cumplimiento, feedbacks cargados, prospectos nuevos y facturación asociada (desde `ventas_cupra`).

---

## 9. Reglas de negocio transversales

- **Zona horaria**: toda operación diaria, corte de asignaciones y limpieza usa **UTC-3 (Argentina)**.
- **Fuente de verdad de facturación**: `ventas_cupra.facturacion_ars` (columna "Precio Total Final", IVA incluido).
- **Identidad de cliente**: `client_id` oficial; nombres normalizados a mayúsculas, sin acentos y espacios simples.
- **Cartera**: `vendedor_actual` (maestro) prevalece sobre `vendedor_principal` (ventas).
- **Feedback del vendedor es inmutable frente a los ETL**: ninguna carga de Excel toca `cliente_feedbacks`, `activaciones` ni `visitas`.
- **Mapas**: siempre se dibujan con coordenadas de `client_places` / `prospectos`, nunca con geocodificación al vuelo en render.
- **Rotación**: `last_recommendation_at` evita repetir el mismo punto en días consecutivos.

---

## 10. Configuración y variables de entorno

Frontend (`.env`, prefijo `VITE_`, valores publicables):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` (key administrada vigente; `VITE_GOOGLE_MAPS_API_KEY` queda como fallback legacy — **expirada**)

Backend (secrets, sólo accesibles en edge functions): `LOVABLE_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.

---

## 11. Operación y mantenimiento

**Orden de carga de datos** (importante):
1. Maestro de clientes → define cartera, IDs y vendedor oficial.
2. Informe de ventas → métricas y coordenadas del informe.
3. Geocodificación (`geocode-clients`) → completa barrios faltantes.

**Tareas periódicas**: `cleanup-visited-assignments` (diaria), `check-pending-assignments` (avisos), `clean_old_recommendations()` (purga a 7 días).

**Puntos de atención conocidos**
- Migraciones: ~90 archivos versionados en `supabase/migrations/`; cualquier cambio de esquema debe incluir `GRANT` + RLS en la misma migración.
- Antes de desplegar las versiones nuevas de los ETL debe aplicarse `20260807150000_import_batches_and_staging.sql`; las funciones dependen de las tablas de auditoría y de `commit_ventas_import()`.
- El staging de lotes fallidos vence a los 7 días. Ejecutar periódicamente `cleanup_expired_import_staging()` con `service_role` (se puede programar con Supabase Cron).
- `src/integrations/supabase/client.ts` y `types.ts` son autogenerados: no editar a mano.
- El motor de recomendación es sensible a la calidad de coordenadas: un cliente sin `client_places` no puede entrar en ninguna ruta.
