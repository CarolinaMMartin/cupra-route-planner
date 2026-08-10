# CUPRA Smart Route Planner — Documentación Funcional y Comercial

Versión: 2026-08-07
Audiencia: dirección comercial, jefes de venta, asignadores, vendedores, equipo de datos.
Documento complementario de `DOCUMENTACION_TECNICA.md` (arquitectura y detalle de implementación).

---

## Índice

1. Resumen ejecutivo
2. El problema comercial que resuelve
3. Propuesta de valor y beneficios medibles
4. Conceptos y vocabulario del sistema
5. Roles y permisos
6. Mapa de funcionalidades
7. Lógica de negocio aplicada (reglas de fondo)
8. El motor de recomendación explicado en criollo
9. Funcionalidades paso a paso — Terminal Asignador
10. Funcionalidades paso a paso — Terminal Vendedor
11. Ciclo de vida de un punto de venta
12. Datos: de dónde salen y cómo se cargan
13. Indicadores y supervisión
14. Cómo se usa la plataforma (guía operativa diaria)
15. Preguntas frecuentes y resolución de problemas
16. Buenas prácticas y errores comunes
17. Glosario
18. Roadmap sugerido

---

## 1. Resumen ejecutivo

CUPRA Smart Route Planner es una plataforma web que **decide, asigna y controla las visitas comerciales diarias** de la fuerza de ventas de vinos CUPRA en CABA y AMBA.

Sustituye tres cosas que hoy en la mayoría de las distribuidoras se hacen a mano:

| Antes (manual) | Con la plataforma |
|---|---|
| El jefe arma rutas en una planilla mirando un Excel de ventas | Un motor híbrido (geografía + IA) propone 8 visitas por vendedor, densas y caminables |
| El vendedor decide sobre la marcha a quién visita | El vendedor abre su ruta del día en el celular, con mapa, teléfono y contexto de cada cliente |
| El feedback de calle se pierde en WhatsApp | Cada visita cierra con un feedback estructurado que retroalimenta al motor |

Tres números resumen el diseño del producto:

- **8** puntos por vendedor por día — cupo invariable, se garantiza siempre.
- **1,5 km** de radio inicial de trabajo: la ruta debe ser caminable.
- **300 m** de separación mínima entre las zonas de dos vendedores: nunca se pisan.

### 1.1 Para quién es

- **Distribuidoras y bodegas con fuerza de venta propia** en zona urbana densa.
- Carteras de entre 300 y 5.000 puntos de venta.
- Equipos de 3 a 30 vendedores.

### 1.2 Qué NO es

- No es un CRM completo (no gestiona oportunidades, cotizaciones ni facturación).
- No es un sistema de pedidos ni de logística de entrega.
- No reemplaza al ERP: **consume** su información de ventas vía Excel.

---

## 2. El problema comercial que resuelve

### 2.1 Los cuatro dolores

**a) El vendedor no sabe a quién visitar.**
La cartera es grande, la información está desactualizada y la decisión termina siendo "voy a los de siempre". Resultado: los clientes buenos se sobre-visitan y los dormidos se pierden.

**b) Las rutas son geográficamente absurdas.**
Sin una capa de mapa, un día típico incluye cruzar la ciudad tres veces. Cada cruce son 40 minutos que no son venta.

**c) Se pierden clientes por recencia, no por precio.**
Un cliente que dejó de comprar hace 95 días rara vez avisa. Nadie lo detecta hasta que aparece en el reporte trimestral, y ahí ya compró en otro lado.

**d) El territorio no crece.**
Los prospectos (bares, vinotecas, restaurantes que todavía no compran) no están en ningún sistema. La prospección depende de la iniciativa individual.

### 2.2 Cómo los ataca el producto

| Dolor | Mecanismo del sistema |
|---|---|
| No saber a quién visitar | Scoring comercial 0–5 + recencia + rotación → ranking diario automático |
| Rutas absurdas | Anclaje en el clúster más denso de la cartera del vendedor + radio 1,5 km |
| Pérdida por recencia | Clasificación ACTIVO / INACTIVO / PERDIDO y cupo obligatorio de recuperación |
| Territorio estancado | Google Places completa automáticamente los lugares que falten después de agotar la cartera interna |

---

## 3. Propuesta de valor y beneficios medibles

### 3.1 Beneficios por rol

**Para la dirección comercial**
- Visibilidad diaria: quién salió, a dónde fue, qué pasó en cada punto.
- Trazabilidad de decisiones: toda reasignación manual queda auditada.
- Cobertura de cartera medible: qué porcentaje de clientes fue tocado en los últimos 30/60/90 días.

**Para el jefe de ventas / asignador**
- De 2 horas de armado de rutas a **una corrida de 40 segundos**.
- Control fino: puede sobrescribir cualquier sugerencia de la IA antes de asignar.
- Detección temprana de clientes en riesgo sin abrir un Excel.

**Para el vendedor**
- Su día resuelto al abrir la app: 8 puntos ordenados, con dirección, teléfono, historial y link directo a Google Maps.
- Menos tiempo de traslado, más entrevistas por día.
- El feedback que carga vuelve como mejores rutas: deja de recibir clientes que él ya sabe que están cerrados.

### 3.2 KPIs que la plataforma mueve

| Indicador | Palanca del sistema |
|---|---|
| Visitas efectivas / día | Rutas densas (radio 1,5 km) |
| Tasa de cumplimiento de ruta | Kanban + check-in/checkout + supervisión en vivo |
| Clientes recuperados / mes | Cupo obligatorio de al menos un caso de recuperación por ruta |
| Nuevos puntos de venta abiertos | Prospectos incorporados sólo cuando la cartera interna no alcanza el cupo diario |
| % cartera sin visitar > 90 días | Score de rotación y sugerencias inteligentes |

---

## 4. Conceptos y vocabulario del sistema

| Concepto | Definición operativa |
|---|---|
| **Cliente** | Punto de venta que ya compró o figura en la cartera oficial del maestro. Tiene `client_id`. |
| **Prospecto** | Negocio detectado en Google Places que todavía no es cliente. Se identifica por `place_id`. |
| **Cartera** | Conjunto de clientes cuyo vendedor asignado (oficial) es un vendedor determinado. |
| **Ancla del día** | Punto geográfico alrededor del cual se arma la ruta: el centroide del clúster más denso de la cartera del vendedor. |
| **Ruta** | Los 8 puntos asignados a un vendedor para una fecha. |
| **Asignación** | Vínculo vendedor ↔ punto ↔ día, con estado (Asignado / Por visitar / Visitado). |
| **Recomendación** | Sugerencia del motor, todavía no asignada. Vive en una corrida (`request_id`). |
| **Feedback** | Reporte estructurado del vendedor al cerrar un punto. Dato permanente. |
| **Área** | Agrupación de barrios/comunas vinculada a uno o más vendedores. |
| **Activación** | Acción comercial de calle registrada (degustación, material POP, etc.). |
| **Modo conquista** | Situación de un vendedor sin cartera: recibe 8 prospectos. |

---

## 5. Roles y permisos

### 5.1 Asignador

Perfil del jefe comercial o planner. Puede:
- Cargar los Excel del ERP (maestro y ventas).
- Correr el motor de recomendación con filtros e instrucciones libres.
- Asignar y reasignar puntos a cualquier vendedor.
- Ver y editar toda la cartera, prospectos y áreas.
- Ver la supervisión de todos los vendedores.
- Dar de alta usuarios y cambiar roles.

### 5.2 Vendedor

Perfil de calle, uso mayoritariamente móvil. Puede:
- Ver **solo** sus asignaciones del día.
- Hacer check-in/checkout con geolocalización.
- Cargar feedback.
- Dar de alta prospectos nuevos.
- Autoasignarse puntos cercanos a su ruta.
- Ver sus notificaciones.

No puede: ver la cartera de otros vendedores, correr el motor, cargar Excel ni modificar áreas.

### 5.3 Principio de seguridad

Cada vendedor está aislado a nivel base de datos: aunque manipulara la aplicación, no puede leer filas de otro vendedor. El rol se guarda en una tabla propia y se valida del lado del servidor, nunca en el navegador.

---

## 6. Mapa de funcionalidades

```text
ASIGNADOR
├── Carga de datos (ETL Excel)
│   ├── Maestro de clientes
│   ├── Informe de ventas
│   └── Geocodificación (directa e inversa)
├── Nueva asignación
│   ├── Modo IA (filtros + instrucciones → 8 por vendedor)
│   ├── Modo Por área (áreas → vendedores vinculados)
│   └── Modo Personalizado / Manual (búsqueda libre → selección → vendedor)
├── Revisión de resultados
│   ├── Mapa con marcadores por vendedor
│   ├── Lista y ficha de cliente
│   └── Insights de IA (justificación y factores)
├── Asignaciones de hoy (estado en vivo, edición, reasignación)
├── Cartera
│   ├── Dashboard de clientes (KPIs)
│   └── Edición de clientes / geocodificación puntual
├── Prospectos (dashboard, filtros, alta)
├── Áreas (ABM y vinculación de vendedores)
├── Supervisión de vendedores
└── Usuarios y roles

VENDEDOR
├── Ruta del día (kanban + mapa)
├── Detalle del punto (historial, contacto, feedbacks previos)
├── Check-in / checkout geolocalizado
├── Feedback de visita
├── Alta de prospectos (Google Places)
├── Autoasignación de puntos cercanos
├── Actividades / activaciones
└── Notificaciones
```

---

## 7. Lógica de negocio aplicada (reglas de fondo)

Estas son las reglas que gobiernan el comportamiento del sistema. Son deliberadas, no accidentales.

### 7.1 Reglas de identidad y datos

**R1 — El maestro manda sobre las ventas.**
Si el maestro de clientes dice que el cliente es de Melanie y el informe de ventas dice que lo facturó Juan, el vendedor de cartera es Melanie. El de ventas queda registrado como histórico.
*Por qué:* la cartera es una decisión de gestión; la venta es un hecho pasado.

**R2 — Identidad de cliente por `client_id` oficial.**
El match se resuelve en cascada: CUIT → nombre normalizado (mayúsculas, sin acentos, espacios simples) → alta nueva con el ID del maestro.
*Por qué:* los Excel traen el mismo negocio escrito de cinco maneras distintas.

**R3 — Las recargas de Excel son idempotentes.**
Las ventas se deduplican por ticket + letra + fecha + producto + cliente. Podés volver a subir el mismo archivo sin duplicar nada.

**R4 — El feedback del vendedor es intocable.**
Ningún proceso de carga borra ni sobrescribe feedbacks, visitas ni activaciones. Están en tablas independientes del pipeline.
*Por qué:* es el único dato que nace en la calle y no se puede reconstruir.

**R5 — Sin coordenadas no hay ruta.**
Un cliente sin latitud/longitud no puede entrar en ninguna recomendación. Los mapas se dibujan siempre con coordenadas guardadas, nunca geocodificando al vuelo.

**R6 — Facturación con IVA.**
Todos los KPIs de facturación usan la columna "Precio Total Final" del informe. Las notas de crédito entran con monto negativo y netean el histórico.

**R7 — Zona horaria única: UTC-3 (Argentina).**
El corte del día, las asignaciones y las limpiezas automáticas usan siempre la hora local argentina.

### 7.2 Reglas de asignación

**R8 — Cupo fijo de 8 puntos por vendedor.**
Cada corrida entrega exactamente 8 puntos por vendedor. Si no puede completar el cupo, la corrida falla y no guarda una ruta parcial.

**R9 — Clientes internos antes que prospectos.**
Se consideran primero todos los clientes internos elegibles de la cartera dentro de la zona seleccionada. Sólo los lugares que falten para llegar a 8 se completan con prospectos.

**R10 — Reposición automática de prospectos.**
Si el repositorio operativo no alcanza para cubrir el déficit, el motor busca negocios en Google Places dentro de CABA, descarta duplicados y cerrados, incorpora candidatos al repositorio y completa la ruta.

**R11 — Al menos un caso de recuperación cuando existe.**
Si hay clientes inactivos recuperables en la zona, uno entra sí o sí.

**R12 — Anti-solapamiento entre vendedores: 300 m.**
Un candidato a menos de 300 m del ancla de otro vendedor recibe una penalidad fuerte en el score.
*Por qué:* dos vendedores en la misma cuadra es doble costo y mal mensaje al canal.

**R13 — Rotación: no se repite un punto al día siguiente.**
Cada punto recomendado marca la fecha; el score de rotación castiga las repeticiones cercanas.

**R14 — Modo conquista.**
Vendedor sin cartera → 8 prospectos ordenados por cercanía al centro de su zona/filtros y por rating de Google, ignorando el sesgo de cartera.

**R15 — Exclusiones duras.**
Un cliente marcado como excluido, o con feedback negativo del tipo "cerrado" / "no volver", queda fuera del pool. No se sugiere más.

### 7.3 Reglas de ejecución

**R16 — Toda visita cierra con feedback.**
No se puede marcar un punto como cerrado sin declarar si la visita se hizo y, si no, por qué.

**R17 — Check-in geolocalizado.**
La visita registra coordenadas y hora. Es evidencia, no control punitivo: sirve para validar cobertura real.

**R18 — Limpieza diaria automática.**
Las asignaciones visitadas del día anterior se cierran/archivan automáticamente. La ruta de hoy siempre arranca limpia.

**R19 — Auditoría inmutable de reasignaciones manuales.**
Cada cambio manual de vendedor registra quién, cuándo, de quién a quién. No se puede editar ni borrar.

**R20 — Las recomendaciones caducan a los 7 días.**
Una sugerencia vieja es ruido; se purga automáticamente.

---

## 8. El motor de recomendación explicado en criollo

El motor corre en cuatro etapas. Pensalo como un jefe de ventas que trabaja en 40 segundos.

### Etapa 1 — "¿Dónde trabaja hoy este vendedor?"

Toma todos los clientes de su cartera con coordenadas, busca **dónde están más apretados** (el punto con más vecinos en 2 km) y usa el centro de ese grupo como **ancla del día**. Después dibuja un círculo de 1,5 km.

Si el asignador puso filtros (provincia, ciudad, barrio), esos filtros se aplican antes: el ancla se busca solo dentro de lo permitido.

Si en 1,5 km no llega a 8 clientes internos, el círculo se abre a 2 km, después 3, después 5, y finalmente considera el resto de los clientes elegibles de la zona. Recién después se habilitan prospectos para cubrir el déficit.

### Etapa 2 — "¿Quién merece la visita?"

Cada candidato recibe una nota. Para clientes, el peso está repartido así:

| Factor | Peso | Qué mide |
|---|---|---|
| Geografía | 50% | Qué tan cerca está del ancla |
| Cartera | 25% | Si es cliente propio del vendedor |
| Valor comercial | 15% | Score 0–5 derivado de volumen y recencia |
| Rotación | 10% | Hace cuánto que no se lo recomienda |
| Penalidad | — | −100 si pisa la zona de otro vendedor |

Para prospectos la geografía pesa todavía más (70%), porque no hay historia comercial: lo único que sabemos es que está cerca y que Google le da buen rating.

Estado comercial según días desde la última compra:

- **ACTIVO** — hasta 30 días
- **INACTIVO** — 31 a 90 días
- **PERDIDO** — más de 90 días
- **POTENCIAL** — prospectos

### Etapa 3 — "El criterio humano"

La lista scoreada se le pasa a un modelo de lenguaje junto con: los feedbacks recientes de esos puntos, el estado comercial de cada uno y las **instrucciones libres del asignador** ("esta semana empujar espumantes en Palermo", "priorizar restaurantes con carta de vinos").

El modelo **elige y justifica** dentro del pool que le dieron. No puede inventar clientes ni traer puntos de fuera del radio. Esa restricción es intencional: la IA aporta criterio, no autonomía.

### Etapa 4 — "El control de calidad"

Antes de mostrar nada, el sistema verifica la composición de cada ruta contra las reglas R8 a R14: ¿son exactamente 8? ¿se agotaron los clientes internos antes de usar prospectos? ¿entró un caso de recuperación cuando correspondía? ¿hay duplicados?

Si faltan prospectos, consulta Google Places, descarta coincidencias con clientes y lugares ya usados, guarda los candidatos operativos y completa por score. Si aun así no llega a 8, no guarda nada y devuelve un error explícito.

### Qué ve el asignador del razonamiento

Cada punto muestra una justificación en lenguaje natural y los factores que lo llevaron a entrar (proximidad, score comercial, días sin visita, potencial). No es una caja negra: si el asignador no está de acuerdo, arrastra el punto a otro vendedor o lo saca.

---

## 9. Funcionalidades paso a paso — Terminal Asignador

### 9.1 Ingreso

1. Abrir la plataforma → pantalla de login.
2. Ingresar email y contraseña.
3. El sistema detecta el rol y lleva al dashboard del asignador.

### 9.2 Generar la ruta del día con IA

**Paso 1 — Abrir "Nueva asignación".**
Es la pestaña principal del dashboard.

**Paso 2 — Elegir vendedores.**
Seleccionar los vendedores que salen hoy. Los que no salen se dejan fuera y no consumen candidatos.

**Paso 3 — Aplicar filtros geográficos y comerciales.**
- Provincia / Ciudad / Barrio: acota la zona de trabajo del día.
- Canal: restaurante, vinoteca, bar, etc.
- Etiquetas: segmentaciones propias de la distribuidora.

**Paso 4 — Escribir instrucciones adicionales (opcional pero recomendado).**
Texto libre que se le pasa al modelo. Ejemplos que funcionan bien:
- "Priorizar clientes que compraron espumantes al menos una vez."
- "Evitar Microcentro, hay corte de tránsito."
- "Foco en recuperar inactivos de más de 60 días."

**Paso 5 — Generar.**
El motor corre y devuelve 8 puntos por vendedor seleccionado.

**Paso 6 — Revisar en el mapa.**
Cada vendedor tiene un color fijo. Se ve de un vistazo si las rutas están apretadas y si no se pisan entre sí.

**Paso 7 — Revisar la ficha de cada punto.**
Al hacer clic: razón social, dirección, teléfono, historial de compras, feedbacks previos, estado comercial y la justificación de la IA.

**Paso 8 — Ajustar.**
Dos formas:
- **Kanban:** columnas por vendedor, se arrastra un punto de una columna a otra.
- **Tabla:** edición masiva, ideal para cambiar muchos a la vez.

**Paso 9 — Confirmar la asignación.**
Los puntos pasan a estado *Asignado* y aparecen inmediatamente en el celular de cada vendedor, con notificación.

### 9.3 Asignar por área

Cuando la operación es por zona fija y no por oportunidad:

1. Elegir el modo **Por área** en el selector superior.
2. Seleccionar una o más áreas (barrios/comunas previamente definidas).
3. El sistema trae los clientes de esas áreas y los distribuye entre los vendedores vinculados a cada área.
4. Revisar la distribución propuesta.
5. Confirmar.

Cuándo usarlo: operaciones con territorios rígidos, cobertura sistemática de una zona, campañas barriales.

### 9.4 Asignación manual / Personalizado

Para casos puntuales, correcciones y estrategias específicas:

1. Elegir el modo **Personalizado** en el selector superior.
2. **Buscar** en toda la base: por nombre, CUIT, barrio, ciudad, canal o etiqueta. Busca clientes y prospectos a la vez.
3. Usar las **sugerencias inteligentes** para descubrir candidatos:
   - Clientes **sin vendedor** asignado.
   - Clientes de **baja frecuencia** de compra.
   - Clientes **no visitados hace más de X días**.
4. **Seleccionar** con checkbox: uno por uno o selección masiva del resultado.
5. **Elegir el vendedor** destino.
6. **Asignar en una sola acción.**

Cada reasignación queda auditada (quién la hizo, vendedor anterior, vendedor nuevo, fecha). Este modo convive con el automático y no lo interfiere.

Cuándo usarlo: un cliente clave pidió expresamente a un vendedor; hay que cubrir la cartera de alguien que faltó; se detectó un cliente huérfano; campaña puntual sobre una lista cerrada.

### 9.5 Asignaciones de hoy

Pantalla de control en vivo de la jornada:
- Qué asignó a cada vendedor y en qué estado está cada punto.
- Mapa consolidado del día.
- Edición sobre la marcha: reasignar, quitar o agregar puntos si algo cambió.

### 9.6 Cartera de clientes

**Dashboard de clientes:** KPIs de la cartera (facturación histórica, ticket promedio, recencia, distribución por barrio y por vendedor), con filtros y exploración.

**Edición de clientes:** corregir datos, cambiar vendedor, marcar exclusiones con motivo, geocodificar un cliente puntual que quedó sin coordenadas.

### 9.7 Prospectos

Dashboard de negocios de Google Places todavía no clientes. Filtros por barrio, tipo, rating, si sirve vinos y estado del negocio. Desde acá se los puede sumar al pool de recomendaciones o asignar manualmente.

### 9.8 Áreas

ABM de áreas: se define un nombre, un color, los barrios/comunas que la componen y los vendedores vinculados. Es la base del modo "Por área" y del anclaje geográfico de vendedores sin cartera.

### 9.9 Supervisión de vendedores

Por vendedor y por día:
- Asignados vs. visitados y tasa de cumplimiento.
- Feedbacks cargados.
- Prospectos nuevos levantados en calle.
- Facturación asociada.

Es la pantalla de la reunión de la mañana siguiente.

### 9.10 Usuarios

Alta de vendedores y asignadores, activación/desactivación y cambio de rol. Un vendedor desactivado deja de recibir asignaciones pero conserva su historial.

---

## 10. Funcionalidades paso a paso — Terminal Vendedor

Pensada para el celular, en la calle, con una mano.

### 10.1 Ver la ruta del día

Al entrar, el vendedor ve sus puntos del día en dos vistas:

- **Kanban:** columnas por estado (Asignado → Por visitar → Visitado). Se arrastra la tarjeta al avanzar.
- **Mapa:** todos sus puntos ubicados, para decidir el orden de recorrido.

### 10.2 Abrir un punto

La tarjeta muestra:
- Razón social y nombre de fantasía.
- Dirección y **link directo a Google Maps** para navegar.
- Teléfono (tap para llamar).
- Historial de compras: cuánto, qué y cuándo compró.
- Feedbacks anteriores: qué pasó las últimas veces.
- Por qué está en la ruta (justificación de la IA).

### 10.3 Check-in

Al llegar: botón de check-in. El sistema registra hora y coordenadas.

### 10.4 Registrar el feedback

Al cerrar el punto, se completa un formulario corto y obligatorio:

1. **¿Se hizo la visita?** Sí / No.
2. Si **No**: motivo (cerrado, no estaba el encargado, dirección incorrecta, negocio cerrado definitivamente, etc.).
3. Si **Sí**: tipo de interacción (venta, presentación, seguimiento, reclamo) y comentario libre.
4. Etiqueta de WhatsApp a actualizar, si corresponde.

Este dato es permanente y alimenta el motor: un "negocio cerrado definitivamente" saca al punto del pool para siempre.

### 10.5 Checkout

Cierra la visita, sella la hora y el punto pasa a **Visitado**.

### 10.6 Cargar un prospecto nuevo

Si el vendedor pasa por un local interesante que no está en el sistema:

1. Abrir "Agregar prospecto".
2. Buscar el negocio por nombre en Google Places.
3. El sistema verifica automáticamente que no exista ya como cliente ni como prospecto.
4. Confirmar → queda cargado con coordenadas reales, teléfono, rating y tipo de negocio.

Desde ese momento es candidato de futuras rutas.

### 10.7 Autoasignarse puntos

Si termina la ruta antes de tiempo o le queda tiempo en una zona:

1. Abrir "Autoasignar".
2. El sistema propone puntos cercanos a su ubicación/ruta dentro de su zona.
3. Elegir y sumarlos al día.

### 10.8 Actividades y notificaciones

- **Actividades:** registro de activaciones de calle (degustación, entrega de material, acción con el canal).
- **Notificaciones:** avisos de nuevas asignaciones, cambios de ruta y recordatorios de puntos pendientes.

---

## 11. Ciclo de vida de un punto de venta

```text
   PROSPECTO (Google Places)
        │  alta desde calle o reposición automática ante déficit
        ▼
   CANDIDATO  ──── entra al pool de recomendación por geografía + rating
        │
        ▼
   RECOMENDADO ─── el motor lo propone para un vendedor y un día
        │  el asignador confirma
        ▼
   ASIGNADO ────── aparece en la ruta del vendedor
        │  el vendedor hace check-in
        ▼
   POR VISITAR ─── en curso
        │  checkout + feedback
        ▼
   VISITADO ────── se sella visited_at; limpieza diaria lo archiva
        │
        ├── si compró ────────► CLIENTE (aparece en el próximo informe de ventas)
        └── si "no volver" ───► EXCLUIDO (fuera del pool para siempre)

   CLIENTE
     ├── ACTIVO   (≤ 30 días desde última compra)
     ├── INACTIVO (31–90 días)  ──► candidato prioritario de recuperación
     └── PERDIDO  (> 90 días)   ──► cliente interno; se considera antes que un prospecto
```

---

## 12. Datos: de dónde salen y cómo se cargan

### 12.1 Las tres fuentes

| Fuente | Qué aporta | Frecuencia sugerida |
|---|---|---|
| **Maestro de clientes** (Excel del ERP) | Cartera oficial, ID de cliente, vendedor asignado, contacto, categorías, coordenadas oficiales | Semanal o al cambiar cartera |
| **Informe de ventas** (Excel del ERP) | Transacciones a nivel línea de factura → métricas, recencia, scoring | Semanal |
| **Google Places** | Prospectos con coordenadas, rating, tipo y contacto | Continua (alta desde calle) |

### 12.2 Orden de carga (importante)

1. **Maestro de clientes primero.** Define quién existe, con qué ID y de qué vendedor es.
2. **Informe de ventas después.** Calcula métricas y scoring sobre esos clientes.
3. **Geocodificación al final.** Completa los barrios faltantes.

Si se invierte el orden, el sistema crea clientes con IDs provisorios que después hay que reconciliar.

### 12.3 Qué hace el sistema al cargar el maestro

- Detecta automáticamente el tipo de archivo por sus cabeceras y recorre todas las hojas.
- Normaliza CUIT (incluida la corrección de la notación científica que introduce Excel) y razón social.
- Normaliza geografía: mapea ciudades y partidos a barrios y comunas de CABA y GBA.
- Resuelve el ID del cliente: CUIT → nombre → alta nueva.
- Escribe la cartera oficial: vendedor, contacto, categorías.
- Marca como **SIN_COMPRAS** a los clientes de cartera que todavía no tienen ventas registradas.
- Carga las coordenadas oficiales como ubicación primaria.

### 12.4 Qué hace al cargar ventas

- Deduplica por clave compuesta: se puede recargar el mismo archivo sin duplicar.
- Acepta notas de crédito con monto negativo.
- **No pisa** el vendedor oficial del maestro.
- Lee latitud y longitud del informe y las guarda.
- Recalcula todas las métricas del cliente: facturación histórica, cantidad de órdenes, ticket promedio, días desde la última compra, categorías y scores.

### 12.5 Geocodificación

- **Directa:** clientes con dirección y sin coordenadas → se buscan las coordenadas.
- **Inversa:** clientes con coordenadas y sin barrio → se completa barrio, comuna y provincia desde Google.

Se corre después de cada carga grande. Sin barrio, los filtros geográficos y las áreas no funcionan bien.

### 12.6 Calidad de datos: el punto crítico

El motor es tan bueno como las coordenadas. Recomendación operativa: revisar en el dashboard de clientes el contador de "clientes sin coordenadas" y "clientes sin barrio" después de cada carga, y correr la geocodificación hasta llevarlos cerca de cero.

---

## 13. Indicadores y supervisión

### 13.1 Indicadores de cartera

- Clientes totales, activos, inactivos y perdidos.
- Facturación histórica y ticket promedio.
- Participación de cada cliente en el total.
- Distribución por barrio, canal y vendedor.
- Clientes sin vendedor asignado.
- Clientes sin coordenadas (deuda de datos).

### 13.2 Indicadores de ejecución diaria

- Asignados vs. visitados por vendedor.
- Tasa de cumplimiento de ruta.
- Feedbacks cargados (calidad del reporte).
- Motivos de no-visita agrupados (detecta problemas sistémicos: direcciones malas, horarios equivocados).
- Prospectos nuevos cargados.

### 13.3 Indicadores de crecimiento

- Prospectos convertidos en clientes.
- Clientes recuperados (pasaron de INACTIVO/PERDIDO a ACTIVO).
- Cobertura: % de cartera visitada en los últimos 30 / 60 / 90 días.

### 13.4 La reunión de la mañana en 5 minutos

Rutina sugerida usando la pantalla de supervisión:
1. Cumplimiento de ayer por vendedor.
2. Motivos de no-visita repetidos → ¿problema de dato o de ejecución?
3. Feedbacks con señal de venta → seguimiento.
4. Prospectos nuevos → validar y sumarlos a la cartera de prospección.
5. Generar las rutas de hoy.

---

## 14. Cómo se usa la plataforma (guía operativa)

### 14.1 Puesta en marcha (una sola vez)

1. **Crear usuarios**: un asignador y todos los vendedores, cada uno con su rol.
2. **Cargar el maestro de clientes** desde el ERP.
3. **Cargar el informe de ventas** (idealmente los últimos 12 meses).
4. **Correr la geocodificación** hasta que casi todos los clientes tengan barrio.
5. **Definir las áreas**: agrupar barrios/comunas y vincular vendedores. Esto es clave para los vendedores sin cartera.
6. **Verificar la integración de Google Maps**. La base de prospectos puede comenzar vacía: se abastece cuando una generación detecta que faltan clientes internos.
7. Correr una primera generación de prueba y revisar que las rutas tengan sentido geográfico.

### 14.2 Rutina diaria del asignador

**Antes de las 9:00**
1. Entrar a Supervisión y revisar la ejecución de ayer.
2. Ir a "Nueva asignación".
3. Seleccionar los vendedores que salen hoy.
4. Aplicar filtros de zona si hay foco del día.
5. Escribir las instrucciones adicionales (campaña, producto, criterio de la semana).
6. Generar.
7. Revisar en el mapa que las rutas estén apretadas y no se pisen.
8. Ajustar en el kanban lo que haga falta.
9. Confirmar. Los vendedores reciben la notificación.

**Durante el día**
- Seguir la ejecución en "Asignaciones de hoy".
- Si un vendedor falta o surge una urgencia, reasignar desde ahí o desde el modo Personalizado.

### 14.3 Rutina diaria del vendedor

1. Abrir la app y revisar los 8 puntos del día en el mapa.
2. Definir el orden de recorrido (el mapa ayuda: los puntos están cerca entre sí).
3. En cada punto: check-in → visita → feedback → checkout.
4. Si aparece un local interesante fuera de la lista: cargarlo como prospecto en el momento.
5. Si termina antes: autoasignarse puntos cercanos.
6. Al cierre del día, verificar que no queden puntos sin feedback.

### 14.4 Rutina semanal

- **Lunes:** cargar el maestro actualizado si hubo cambios de cartera; cargar el informe de ventas de la semana anterior; correr geocodificación.
- **Miércoles:** revisar clientes sin vendedor y asignarlos desde el modo Personalizado.
- **Viernes:** revisar prospectos cargados en la semana, validarlos y priorizar los mejores para la semana siguiente.

### 14.5 Rutina mensual

- Revisar cobertura de cartera: quién no fue visitado en 60/90 días.
- Revisar exclusiones: ¿siguen vigentes los "no volver"?
- Revisar áreas: ¿cambió la distribución territorial del equipo?
- Medir conversión de prospectos a clientes.

---

## 15. Preguntas frecuentes y resolución de problemas

**"Un vendedor recibió menos de 8 puntos."**
No debe pasar: la generación guarda 8 o no guarda ninguna recomendación para esa corrida. Si Google Places o la base fallan, se muestra el error para corregirlo y volver a generar.

**"Un vendedor nuevo, sin cartera, ¿qué recibe?"**
Ocho prospectos (modo conquista), elegidos por cercanía al centro de su área asignada y por rating. Por eso es importante que todo vendedor esté vinculado a un área.

**"Se repiten clientes de un día para el otro."**
El score de rotación lo evita, pero si la zona tiene pocos puntos elegibles puede pasar. Solución: ampliar la zona o usar el modo Personalizado para diversificar; el repositorio de prospectos se repone automáticamente cuando hace falta.

**"Dos vendedores están en el mismo barrio."**
La regla de 300 m evita que compartan la misma cuadra, no el mismo barrio. Si querés separación por barrio, usá filtros geográficos distintos por corrida o el modo Por área.

**"Cargué el Excel y aparecen clientes sin barrio."**
Faltó correr la geocodificación inversa. Es el paso 3 del orden de carga.

**"Cargué el Excel dos veces, ¿dupliqué las ventas?"**
No. La deduplicación por clave compuesta lo impide.

**"Si vuelvo a cargar el Excel, ¿pierdo el feedback de los vendedores?"**
No. El feedback, las visitas y las activaciones viven en tablas independientes del pipeline de carga. Ningún ETL las toca.

**"El mapa no carga."**
Es un problema de la clave de Google Maps. El sistema usa la clave administrada del conector; si expira o se desconecta, hay que reconectarla.

**"Un cliente cambió de vendedor pero sigue apareciendo en la ruta del anterior."**
Verificar que el cambio se haya hecho en el maestro (fuente de verdad) o en la edición de cliente. El vendedor del informe de ventas no manda.

**"¿Puedo forzar que un cliente específico entre en la ruta de hoy?"**
Sí: modo Personalizado, buscarlo, seleccionarlo, elegir vendedor, asignar.

**"¿Puedo sacar a un cliente para siempre?"**
Sí: marcarlo como excluido con motivo desde la edición de cliente, o dejar el feedback correspondiente desde la calle.

---

## 16. Buenas prácticas y errores comunes

### Hacer

- Cargar el maestro **antes** que las ventas, siempre.
- Correr geocodificación después de cada carga grande.
- Vincular a todos los vendedores con un área, incluso a los que tienen cartera.
- Usar las instrucciones adicionales: es la forma más barata de bajar estrategia comercial al motor.
- Exigir feedback en el 100% de los puntos. Un sistema sin feedback se degrada en dos semanas.
- Revisar la supervisión todos los días, aunque sea 5 minutos.

### Evitar

- Filtros geográficos ultra-estrechos (un solo barrio chico) con muchos vendedores a la vez.
- Cargar ventas sin maestro: genera IDs provisorios y trabajo de reconciliación.
- Dejar clientes sin coordenadas: son invisibles para el motor.
- Editar la cartera solo en la app y no en el ERP: la próxima carga del maestro va a pisar el cambio.
- Usar el modo Personalizado como método principal: está pensado para excepciones, no para reemplazar el motor.
- Ignorar los motivos de no-visita repetidos: casi siempre esconden un problema de dato.

---

## 17. Glosario

| Término | Significado |
|---|---|
| **AMBA** | Área Metropolitana de Buenos Aires. |
| **Ancla** | Centro geográfico del día para un vendedor. |
| **Asignador** | Rol de planificación y supervisión. |
| **Canal** | Tipo de punto de venta (restaurante, vinoteca, bar, hotel). |
| **Cartera** | Clientes asignados a un vendedor. |
| **Check-in / checkout** | Marca de llegada y salida de una visita, con hora y ubicación. |
| **CUIT** | Identificador fiscal argentino del cliente. |
| **ETL** | Proceso de carga: extracción, transformación y carga de los Excel. |
| **Feedback** | Reporte estructurado del vendedor al cerrar una visita. |
| **Geocodificación** | Convertir una dirección en coordenadas (directa) o coordenadas en barrio (inversa). |
| **Hotspot / clúster** | Concentración de clientes en un radio corto. |
| **Kanban** | Tablero de columnas por estado. |
| **Modo conquista** | Ruta de 8 prospectos para un vendedor sin cartera. |
| **Prospecto** | Negocio candidato que todavía no compra. |
| **Recencia** | Días transcurridos desde la última compra. |
| **Rotación** | Mecanismo que evita repetir el mismo punto en días seguidos. |
| **Score comercial** | Nota 0–5 que combina volumen y recencia. |
| **UTC-3** | Zona horaria de Argentina; rige todos los cortes del sistema. |

---

## 18. Roadmap sugerido

Ideas naturales de evolución, ordenadas por relación valor/esfuerzo:

1. **Orden de recorrido optimizado** dentro de la ruta (hoy el vendedor decide el orden mirando el mapa).
2. **Objetivos por vendedor** y seguimiento de cumplimiento contra cuota.
3. **Alertas proactivas de riesgo**: aviso automático cuando un cliente A cruza los 45 días sin comprar.
4. **Registro de pedido en la visita**, para acortar el ciclo entre visita y facturación.
5. **Integración directa con el ERP** (API en lugar de Excel), que elimina el paso manual de carga.
6. **Reporte semanal automático** por email a la dirección comercial.
7. **Histórico de rutas** con comparación mes contra mes por vendedor y por zona.

---

*Documento funcional y comercial. Para detalle de implementación, esquema de base de datos, edge functions y fórmulas exactas de scoring, ver `DOCUMENTACION_TECNICA.md`.*
