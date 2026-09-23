# Revisión de los cambios de Claude

Base examinada: `main` en `32ba952b6e7cbd35010a4dc8b9d6ef37f1bb5bc2`.
Propuesta recibida: siete commits, hasta `0e40219cb32f28c7ce205e079918983bfabc5d06`,
contenidos tanto en el bundle como en los parches adjuntos. Fecha: 23/09/2026.

## Evaluación

La separación del motor en reglas y un planificador comprobable mejora la
estructura anterior. Se conservan la composición 5-2-1, los filtros, el mapa de
zona, la geocodificación directa y las explicaciones determinísticas cuando
falla la IA. La propuesta necesitaba correcciones antes de publicarse.

| Hallazgo | Consecuencia | Corrección incorporada |
|---|---|---|
| Borrado de visitas previas del mismo vendedor antes de insertar | Pérdida de historial y guardados incompletos si fallaba la inserción | RPC transaccional `guardar_asignaciones`, índices solo sobre pendientes por día, conservación de visitas realizadas y reintentos sin duplicar |
| Otros caminos de asignación conservaban el borrado masivo | Cambiar el vendedor desde la tabla o el calendario podía volver a borrar historia | Recomendaciones, tabla, mapa, edición, calendario y transferencia manual usan el mismo guardado |
| Reasignación por CUIT | Sucursales de un mismo CUIT podían intercambiarse | Uso del `client_id` de la recomendación |
| Estado duplicado en frontend y backend | El centinela 9999 era potencial en pantalla y perdido en el motor | Módulo compartido con validación de fechas y valores ausentes |
| Cuentas cerradas sin reseñas | Podían entrar como prospectos manuales | Exclusión por estado del negocio independientemente del origen |
| Consulta de Google aunque ya había ocho clientes del estado elegido | Consumo innecesario de llamadas | Búsqueda solo ante déficit; presupuesto de consultas y tiempo máximo |
| Último recurso sin límite de distancia | Ocho visitas nominales podían implicar un recorrido impracticable | Límite de 15 km y déficit informado |
| Exclusión de lo asignado basada solo en la fecha de creación | Una visita programada antes para hoy podía volver a recomendarse | Consulta por fecha programada, fecha operativa y visitas realizadas hoy |
| Gate de duplicados limitado a clientes con vendedor y no excluidos | Clientes existentes podían reaparecer como prospectos | Se compara contra toda la cartera, incluido el identificador de Google |
| Inserción de prospectos con carrera entre solicitudes | Una búsqueda podía fallar por una inserción simultánea | Inserción con conflicto ignorado; nunca sobrescribe prospectos existentes |
| Mapa convertía coordenadas nulas a cero y recortaba antes de filtrar | Puntos inválidos o filtros incompletos | Coordenadas válidas y límite visual aplicado después del filtro |
| Feedback más reciente aplicado a todas las visitas de una cuenta | La supervisión podía repetir comentarios en visitas históricas | Asociación por vendedor, cuenta e intervalo entre creación y cierre de la visita |
| Lectura del feedback sin paginar dentro de cada tanda | Pérdida silenciosa de comentarios con más de 1000 resultados | Paginación por tanda y eliminación del recorte de 500 asignaciones en Supervisión |
| Rubros guardados en caché para toda la sesión | Las nuevas importaciones podían no aparecer | Caché con caducidad y recarga; errores de consulta visibles |
| Geocodificación masiva sin autenticar e importación de prospectos sin verificar rol | Ejecución de operaciones privilegiadas y consumo de Google fuera de los permisos previstos | Sesión y perfil activo de asignador o administrador antes de procesar datos |
| Agenda del vendedor reabría visitas realizadas | Pérdida del cierre anterior y consultas ambiguas al conservar más de una visita | Se crea una visita por día sin modificar las anteriores; eliminación masiva limitada a pendientes |
| Dos componentes de asignación obsoletos sin referencias | Conservaban una segunda implementación con borrados masivos | Retirados; los flujos activos utilizan los componentes de tabla |
| `npm ci` fallaba | Instalación y despliegue no reproducibles | Archivo de bloqueo sincronizado y pruebas ejecutables con `npm run check` |

## Validación

Se ejecutaron instalación limpia con `npm ci`, comprobación de tipos, 62 pruebas
del motor, 11 pruebas de base de datos y compilación de producción. Las pruebas
de base ejecutan ambas migraciones sobre PostgreSQL embebido y verifican
historial, rollback del lote, permisos, repetición, agenda futura y auditoría de
transferencia de cartera. Los datos del caso de Micaela son sintéticos, como en
las pruebas recibidas; no son una validación de su cartera real de producción.

En navegador local se comprobó el flujo de filtros, generación, selección y
confirmación de ocho visitas, incluido el envío único al RPC y la ausencia de
borrados previos. Se verificó la pantalla inicial a ancho móvil. Estas pruebas
usan respuestas simuladas de Supabase; no ejecutan operaciones de producción.

El lint global ya fallaba en la base (283 errores, principalmente `any`). Esta
entrega mantiene esa deuda visible; no se desactivaron reglas para hacer pasar
el control. Las verificaciones de tipos, pruebas y compilación son independientes
del lint y sí forman parte de la validación automatizada de esta entrega.

## Decisiones y límites

La regla 5-2-1 y los umbrales móviles 30/90 días son decisiones de producto
conservadas del código recibido. El manual adjunto describe frecuencia por
prioridad de zona y estados por meses; no documenta esa composición diaria.
No se atribuye la regla 5-2-1 al manual ni se cambian esos criterios sin una
definición comercial adicional.

El rubro es un filtro estricto; los estados elegidos son una prioridad con
sustitución avisada. La distancia usa coordenadas en línea recta, no tiempos
reales de caminata o tránsito. El límite de 15 km evita la ampliación ilimitada,
pero no garantiza por sí mismo que toda ruta sea caminable.

Los registros históricos sin fecha de cierre confiable no reciben un comentario
por mera coincidencia de cliente. El origen de prospectos antiguos todavía se
infiere cuando no hay una procedencia explícita; conviene normalizarlo en una
futura migración a partir de las fuentes originales.

La publicación completa requiere acceso verificado a Supabase y Lovable.
Una rama o un commit en GitHub no acredita una migración ni un despliegue.
El orden y la recuperación están definidos en `DESPLIEGUE.md`.
